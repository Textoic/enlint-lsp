import type { LintError } from "@textoic/enlint/types";
import {
  TextDocuments,
  TextDocumentSyncKind,
  type CancellationToken,
  type Connection,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  resolveConfig,
  toEnlintConfig,
  type ResolvedConfig,
  type TextoicConfig,
} from "./config.js";
import { codeActionsFor, rangeOf, toDiagnostic } from "./diagnostics.js";
import { withoutIgnoredInstances } from "./issues.js";
import { DocumentLinter } from "./linter.js";
import type { TextFormat } from "./markdown.js";
import type { Parser } from "./parser.js";
import {
  Methods,
  type ClientSettings,
  type LintStats,
  type LintTextParams,
  type LintTextResult,
  type RelintParams,
  type RelintResult,
  type RewriteAllParams,
  type RewriteAllResult,
  type RewriteParams,
  type RewriteResult,
  type SettingsSection,
} from "./protocol.js";
import { rewriteDocument, rewritePassage } from "./rewrite/index.js";
import {
  completionFor,
  type Complete,
  type ProviderSettings,
} from "./rewrite/providers.js";

export type ServerOptions = {
  parser: () => Promise<Parser>;
  projectConfig?: (uri: string) => Promise<TextoicConfig | undefined>;
  completion?: (provider: ProviderSettings) => Complete;
};

export const defaultDebounceMs = 750;

type Timer = ReturnType<typeof setTimeout>;

const formatOf = ({
  languageId,
}: Pick<TextDocument, "languageId">): TextFormat =>
  languageId === "markdown" ? "markdown" : "plaintext";

export class Workspace {
  readonly documents = new TextDocuments(TextDocument);
  settings: ClientSettings = {};
  private readonly linters = new Map<string, DocumentLinter>();
  private readonly published = new Map<string, Diagnostic[]>();
  private readonly timers = new Map<string, Timer>();
  private projectConfigs = new Map<
    string,
    Promise<TextoicConfig | undefined>
  >();
  private readonly reported = new Set<string>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly connection: Connection,
    private readonly options: ServerOptions,
  ) {}

  async configFor(uri: string): Promise<ResolvedConfig> {
    const project = await this.projectConfigOf(uri);
    const resolved = resolveConfig(this.settings.config, project);
    this.report(resolved.problems);
    return resolved;
  }

  async lintNow(document: TextDocument): Promise<number> {
    this.cancel(document.uri);
    const started = Date.now();
    const [parser, config] = await Promise.all([
      this.options.parser(),
      this.configFor(document.uri),
    ]);
    const current = this.documents.get(document.uri);
    if (current?.version !== document.version) {
      return this.published.get(document.uri)?.length ?? 0;
    }

    const text = document.getText();
    const run = this.linterOf(document.uri, parser).lint(
      text,
      toEnlintConfig(config),
      formatOf(document),
    );
    const problems = this.withoutIgnored(document.uri, text, run.problems);
    const diagnostics = problems.map((problem) =>
      toDiagnostic(document, problem, config),
    );
    this.published.set(document.uri, diagnostics);
    await this.connection.sendDiagnostics({
      uri: document.uri,
      version: document.version,
      diagnostics,
    });
    const stats: LintStats = {
      uri: document.uri,
      version: document.version,
      problems: diagnostics.length,
      parsedBlocks: run.parsedBlocks,
      reusedBlocks: run.reusedBlocks,
      durationMs: Date.now() - started,
    };
    await this.connection.sendNotification(Methods.lintStats, stats);
    return diagnostics.length;
  }

  changed(document: TextDocument) {
    if (this.seen.has(document.uri)) {
      this.schedule(document);
      return;
    }

    this.seen.add(document.uri);
    this.lintInBackground(document);
  }

  schedule(document: TextDocument) {
    this.cancel(document.uri);
    const delay = this.settings.debounceMs ?? defaultDebounceMs;
    const timer = setTimeout(() => {
      this.timers.delete(document.uri);
      this.lintInBackground(document);
    }, delay);
    this.timers.set(document.uri, timer);
  }

  lintInBackground(document: TextDocument) {
    this.lintNow(document).catch((cause: unknown) => {
      this.connection.console.error(
        `enlint could not lint ${document.uri}: ${String(cause)}`,
      );
    });
  }

  relintAll() {
    this.documents.all().forEach((document) => this.lintInBackground(document));
  }

  forgetProjectConfigs() {
    this.projectConfigs = new Map();
  }

  close(uri: string) {
    this.cancel(uri);
    this.seen.delete(uri);
    this.linters.delete(uri);
    this.published.delete(uri);
    this.connection
      .sendDiagnostics({ uri, diagnostics: [] })
      .catch(() => undefined);
  }

  diagnosticsOf(uri: string) {
    return this.published.get(uri) ?? [];
  }

  async lintFor(document: Pick<TextDocument, "uri" | "languageId">) {
    const [parser, config] = await Promise.all([
      this.options.parser(),
      this.configFor(document.uri),
    ]);
    const format = formatOf(document);
    return (text: string) =>
      this.withoutIgnored(
        document.uri,
        text,
        new DocumentLinter(parser).lint(text, toEnlintConfig(config), format)
          .problems,
      );
  }

  private withoutIgnored(uri: string, text: string, problems: LintError[]) {
    return withoutIgnoredInstances(
      text,
      problems,
      this.settings.ignoredInstances?.[uri] ?? [],
    );
  }

  completionFor(provider: ProviderSettings): Complete {
    return (this.options.completion ?? completionFor)(provider);
  }

  private linterOf(uri: string, parser: Parser) {
    const existing = this.linters.get(uri);
    if (existing != null) {
      return existing;
    }

    const linter = new DocumentLinter(parser);
    this.linters.set(uri, linter);
    return linter;
  }

  private cancel(uri: string) {
    clearTimeout(this.timers.get(uri));
    this.timers.delete(uri);
  }

  private projectConfigOf(uri: string) {
    const load = this.options.projectConfig;
    if (load == null) {
      return Promise.resolve(undefined);
    }

    const cached = this.projectConfigs.get(uri) ?? this.loadedSafely(load, uri);
    this.projectConfigs.set(uri, cached);
    return cached;
  }

  private loadedSafely(
    load: NonNullable<ServerOptions["projectConfig"]>,
    uri: string,
  ) {
    return load(uri).catch((cause: unknown) => {
      this.report([`could not read the project config: ${String(cause)}`]);
      return undefined;
    });
  }

  private report(problems: string[]) {
    problems
      .filter((problem) => !this.reported.has(problem))
      .forEach((problem) => {
        this.reported.add(problem);
        this.connection.console.warn(`textoic config: ${problem}`);
      });
  }
}

const settingsFrom = (value: unknown): ClientSettings =>
  (value as SettingsSection | undefined)?.textoic ?? {};

const initialize =
  (workspace: Workspace) =>
  (params: InitializeParams): InitializeResult => {
    workspace.settings = {
      ...workspace.settings,
      ...(params.initializationOptions as ClientSettings | undefined),
    };
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        codeActionProvider: { codeActionKinds: ["quickfix"] },
      },
      serverInfo: { name: "enlint-lsp", version: "0.1.0" },
    };
  };

const relint =
  (workspace: Workspace) =>
  async ({ uri }: RelintParams): Promise<RelintResult> => {
    const document = workspace.documents.get(uri);
    return document == null
      ? { ok: false, problems: 0 }
      : { ok: true, problems: await workspace.lintNow(document) };
  };

const lintText =
  (workspace: Workspace) =>
  async ({
    text,
    languageId = "markdown",
    uri = "inmemory://lint-text",
  }: LintTextParams): Promise<LintTextResult> => {
    const lint = await workspace.lintFor({ uri, languageId });
    return { problems: lint(text) };
  };

const abortedWith = (token: CancellationToken) => {
  const controller = new AbortController();
  token.onCancellationRequested(() => {
    controller.abort();
  });
  return controller.signal;
};

const rewrite =
  (workspace: Workspace) =>
  async (
    { uri, range, provider }: RewriteParams,
    token: CancellationToken,
  ): Promise<RewriteResult> => {
    const document = workspace.documents.get(uri);
    if (document == null) {
      throw new Error(`${uri} is not open.`);
    }

    const text = document.getText();
    const result = await rewritePassage(
      {
        text,
        start: document.offsetAt(range.start),
        end: document.offsetAt(range.end),
      },
      {
        complete: workspace.completionFor(provider),
        lint: await workspace.lintFor(document),
        signal: abortedWith(token),
      },
    );
    return { ...result, range: rangeOf(document, result.start, result.end) };
  };

const concurrencyFor: Record<ProviderSettings["kind"], number> = {
  ollama: 1,
  openrouter: 3,
};

const rewriteAll =
  (workspace: Workspace, connection: Connection) =>
  async (
    { uri, provider }: RewriteAllParams,
    token: CancellationToken,
  ): Promise<RewriteAllResult> => {
    const document = workspace.documents.get(uri);
    if (document == null) {
      throw new Error(`${uri} is not open.`);
    }

    const rewrites = await rewriteDocument(document.getText(), {
      complete: workspace.completionFor(provider),
      lint: await workspace.lintFor(document),
      signal: abortedWith(token),
      concurrency: concurrencyFor[provider.kind],
      onProgress: ({ done, total }) => {
        connection
          .sendNotification(Methods.rewriteProgress, { uri, done, total })
          .catch(() => undefined);
      },
    });
    return {
      rewrites: rewrites.map((result) => ({
        ...result,
        range: rangeOf(document, result.start, result.end),
      })),
    };
  };

const listenToDocuments = (workspace: Workspace, connection: Connection) => {
  const { documents } = workspace;
  documents.onDidChangeContent(({ document }) => {
    workspace.changed(document);
  });
  documents.onDidClose(({ document }) => {
    workspace.close(document.uri);
  });
  documents.listen(connection);
};

const listenToConfiguration = (
  workspace: Workspace,
  connection: Connection,
) => {
  connection.onDidChangeConfiguration(({ settings }) => {
    workspace.settings = settingsFrom(settings);
    workspace.relintAll();
  });
  connection.onDidChangeWatchedFiles(() => {
    workspace.forgetProjectConfigs();
    workspace.relintAll();
  });
};

export const attachLanguageServer = (
  connection: Connection,
  options: ServerOptions,
) => {
  const workspace = new Workspace(connection, options);
  connection.onInitialize(initialize(workspace));
  connection.onCodeAction(({ textDocument, range }) => {
    const document = workspace.documents.get(textDocument.uri);
    return document == null
      ? []
      : codeActionsFor(document, workspace.diagnosticsOf(document.uri), range, {
          rewrite: workspace.settings.rewrite === true,
        });
  });
  connection.onRequest(Methods.relint, relint(workspace));
  connection.onRequest(Methods.lintText, lintText(workspace));
  connection.onRequest(Methods.rewrite, rewrite(workspace));
  connection.onRequest(Methods.rewriteAll, rewriteAll(workspace, connection));
  listenToConfiguration(workspace, connection);
  listenToDocuments(workspace, connection);
  return workspace;
};
