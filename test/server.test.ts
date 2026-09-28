import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";
import {
  createConnection,
  type CodeAction,
  type Diagnostic,
  type PublishDiagnosticsParams,
} from "vscode-languageserver/node";
import {
  attachLanguageServer,
  Commands,
  Methods,
  type ClientSettings,
  type LintStats,
  type LintTextResult,
  type RewriteResult,
} from "../src/index.js";
import { loadParser, projectConfigFor } from "../src/node/index.js";
import type { Complete } from "../src/rewrite/providers.js";

const parser = loadParser();

type Client = {
  connection: MessageConnection;
  published: PublishDiagnosticsParams[];
  stats: LintStats[];
};

const pause = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });

const until = async (
  check: () => boolean,
  deadline = Date.now() + 20_000,
): Promise<void> => {
  if (check()) {
    return;
  }

  if (Date.now() > deadline) {
    throw new Error("timed out");
  }

  await pause();
  await until(check, deadline);
};

const fakeCompletion =
  (answer: string): Complete =>
  () =>
    Promise.resolve({ content: answer, truncated: false, costUsd: 0.001 });

const start = async (
  settings: ClientSettings,
  answer = "The committee wrote the report.",
): Promise<Client> => {
  const up = new PassThrough();
  const down = new PassThrough();
  const server = createConnection(
    new StreamMessageReader(up),
    new StreamMessageWriter(down),
  );
  attachLanguageServer(server, {
    parser: () => parser,
    projectConfig: projectConfigFor,
    completion: () => fakeCompletion(answer),
  });
  server.listen();
  const connection = createMessageConnection(
    new StreamMessageReader(down),
    new StreamMessageWriter(up),
  );
  const client: Client = { connection, published: [], stats: [] };
  connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: PublishDiagnosticsParams) => {
      client.published.push(params);
    },
  );
  connection.onNotification(Methods.lintStats, (params: LintStats) => {
    client.stats.push(params);
  });
  connection.listen();
  await connection.sendRequest("initialize", {
    processId: null,
    rootUri: null,
    capabilities: {},
    initializationOptions: settings,
  });
  await connection.sendNotification("initialized", {});
  return client;
};

const open = async (client: Client, uri: string, text: string) => {
  const count = client.published.length;
  await client.connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "markdown", version: 1, text },
  });
  await until(() => client.published.length > count);
  return client.published[client.published.length - 1].diagnostics;
};

const codesIn = (diagnostics: Diagnostic[]) =>
  diagnostics.map(({ code }) => code);

const PASSIVE = "The report was written by the committee.";

const titlesOf = (actions: CodeAction[]) => actions.map(({ title }) => title);

describe("language server", () => {
  let client: Client;

  before(async () => {
    client = await start({ debounceMs: 100, rewrite: true });
  });

  after(() => {
    client.connection.dispose();
  });

  it("publishes diagnostics on open and re-lints only the edited block", async () => {
    const uri = "file:///virtual/doc.md";
    const text = `# Title\n\nPlain sentence here.\n\n${PASSIVE}`;
    const diagnostics = await open(client, uri, text);
    const passive = diagnostics.find(
      ({ code }) => code === "no-passive-sentences",
    );
    assert.ok(passive);
    assert.equal(passive.range.start.line, 4);
    assert.equal(passive.source, "textoic");
    assert.equal(
      passive.codeDescription?.href,
      "https://textoic.com/rules#no-passive-sentences",
    );

    await client.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 2 },
      contentChanges: [
        {
          range: {
            start: { line: 4, character: 0 },
            end: { line: 4, character: PASSIVE.length },
          },
          text: "The committee wrote the report.",
        },
      ],
    });
    await until(() => client.stats.some(({ version }) => version === 2));
    const latest = client.published[client.published.length - 1];
    assert.equal(latest.version, 2);
    assert.ok(!codesIn(latest.diagnostics).includes("no-passive-sentences"));
    const stats = client.stats.find(({ version }) => version === 2);
    assert.equal(stats?.parsedBlocks, 1);
    assert.equal(stats?.reusedBlocks, 2);
  });

  it("offers fixes, a rewrite, an ignore for the case and a rule switch", async () => {
    const uri = "file:///virtual/actions.md";
    const diagnostics = await open(client, uri, "The room was very dirty.");
    const [intensifier] = diagnostics;
    assert.equal(intensifier.code, "no-explained-intensifiers");
    const actions: CodeAction[] = await client.connection.sendRequest(
      "textDocument/codeAction",
      {
        textDocument: { uri },
        range: intensifier.range,
        context: { diagnostics: [intensifier] },
      },
    );
    assert.deepEqual(titlesOf(actions), [
      'Replace with "filthy" (no-explained-intensifiers)',
      "Rewrite this passage with AI",
      'Ignore "dirty" everywhere',
      "Turn off no-explained-intensifiers",
    ]);
    const ignore = actions[2].command;
    assert.equal(ignore?.command, Commands.ignoreCase);
    assert.deepEqual(ignore?.arguments, [
      { rule: "no-explained-intensifiers", case: "dirty" },
    ]);
  });

  it("drops an ignored case once the client sends new settings", async () => {
    const uri = "file:///virtual/ignored.md";
    const text = "The room was very dirty and the food was very bad.";
    const before = await open(client, uri, text);
    assert.equal(before.length, 2);
    const count = client.published.length;
    await client.connection.sendNotification(
      "workspace/didChangeConfiguration",
      {
        settings: {
          textoic: {
            debounceMs: 100,
            rewrite: true,
            config: {
              rules: {
                "no-explained-intensifiers": ["warn", { ignore: ["dirty"] }],
              },
            },
          },
        },
      },
    );
    await until(() =>
      client.published.slice(count).some((published) => published.uri === uri),
    );
    const latest = client.published
      .filter((published) => published.uri === uri)
      .pop();
    assert.equal(latest?.diagnostics.length, 1);
    assert.equal(latest?.diagnostics[0].range.start.character, 41);
  });

  it("lints text that no document holds, with the client's config", async () => {
    const { problems }: LintTextResult = await client.connection.sendRequest(
      Methods.lintText,
      { text: "The room was very dirty and the food was very bad." },
    );
    assert.deepEqual(
      problems.map(({ case: key }) => key),
      ["bad"],
    );
  });

  it("rewrites a passage and verifies it with the linter", async () => {
    const uri = "file:///virtual/rewrite.md";
    const diagnostics = await open(client, uri, `Intro.\n\n${PASSIVE}`);
    const passive = diagnostics.find(
      ({ code }) => code === "no-passive-sentences",
    );
    assert.ok(passive);
    const result: RewriteResult = await client.connection.sendRequest(
      Methods.rewrite,
      {
        uri,
        range: passive.range,
        provider: { kind: "ollama", model: "fake" },
      },
    );
    assert.equal(result.original, PASSIVE);
    assert.equal(result.replacement, "The committee wrote the report.");
    assert.equal(result.accepted, true);
    assert.equal(result.costUsd, 0.001);
    assert.deepEqual(result.range, {
      start: { line: 2, character: 0 },
      end: { line: 2, character: PASSIVE.length },
    });
  });
});

describe("project config", () => {
  it("reads textoic.config.json from the document's folder or above", async () => {
    const root = await mkdtemp(join(tmpdir(), "enlint-lsp-"));
    await writeFile(
      join(root, "textoic.config.json"),
      JSON.stringify({ rules: { "no-passive-sentences": "off" } }),
    );
    const client = await start({ debounceMs: 100 });
    const uri = pathToFileURL(join(root, "notes.md")).href;
    const diagnostics = await open(client, uri, PASSIVE);
    assert.ok(!codesIn(diagnostics).includes("no-passive-sentences"));
    client.connection.dispose();
  });
});
