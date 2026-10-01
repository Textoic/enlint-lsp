import type { LintError } from "@textoic/enlint/types";
import {
  CodeAction,
  CodeActionKind,
  Command,
  DiagnosticSeverity,
  TextEdit,
  type Diagnostic,
  type Range,
} from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ActiveSeverity, ResolvedConfig } from "./config.js";
import type { Scope } from "./fixes.js";
import { instanceOf } from "./issues.js";
import {
  Commands,
  diagnosticSource,
  ruleDocsUrl,
  type DiagnosticData,
  type Fix,
} from "./protocol.js";

const severities: Record<ActiveSeverity, DiagnosticSeverity> = {
  hint: DiagnosticSeverity.Hint,
  info: DiagnosticSeverity.Information,
  warn: DiagnosticSeverity.Warning,
  error: DiagnosticSeverity.Error,
};

export const rangeOf = (
  document: TextDocument,
  start: number,
  end: number,
): Range => ({
  start: document.positionAt(start),
  end: document.positionAt(Math.max(start, end)),
});

const dataOf = (problem: LintError): DiagnosticData => ({
  rule: problem.id,
  ...(problem.case == null ? {} : { case: problem.case }),
  fixes: (problem.suggestions ?? []).map(({ range, text }) => ({
    range,
    text,
  })),
});

export const toDiagnostic = (
  document: TextDocument,
  problem: LintError,
  config: ResolvedConfig,
): Diagnostic => ({
  range: rangeOf(document, problem.start, problem.end),
  message: problem.message,
  severity: severities[config.rules[problem.id]?.severity ?? "warn"],
  source: diagnosticSource,
  code: problem.id,
  codeDescription: { href: ruleDocsUrl(problem.id) },
  data: dataOf(problem),
});

const isBefore = (one: Range["start"], other: Range["start"]): boolean =>
  one.line < other.line ||
  (one.line === other.line && one.character < other.character);

const overlaps = (one: Range, other: Range) =>
  !isBefore(one.end, other.start) && !isBefore(other.end, one.start);

const fixTitle = (document: TextDocument, edit: TextEdit, rule: string) => {
  const replaced = document.getText(edit.range).trim();
  const label =
    edit.newText === ""
      ? `Delete "${replaced}"`
      : `Replace with "${edit.newText.trim()}"`;
  return `${label} (${rule})`;
};

const quickFix =
  (document: TextDocument, diagnostic: Diagnostic, rule: string) =>
  (fix: Fix, index: number): CodeAction => {
    const edit = TextEdit.replace(
      rangeOf(document, fix.range[0], fix.range[1]),
      fix.text,
    );
    const action = CodeAction.create(
      fixTitle(document, edit, rule),
      { changes: { [document.uri]: [edit] } },
      CodeActionKind.QuickFix,
    );
    return { ...action, diagnostics: [diagnostic], isPreferred: index === 0 };
  };

const commandAction = (
  title: string,
  command: string,
  argument: unknown,
): CodeAction =>
  CodeAction.create(
    title,
    Command.create(title, command, argument),
    CodeActionKind.QuickFix,
  );

const ignoreCaseAction = ({ rule, case: key }: DiagnosticData) =>
  key == null
    ? []
    : [
        commandAction(`Ignore "${key}" everywhere`, Commands.ignoreCase, {
          rule,
          case: key,
        }),
      ];

const rewriteAction = (uri: string, diagnostic: Diagnostic) =>
  commandAction("Rewrite this passage with AI", Commands.rewrite, {
    uri,
    range: diagnostic.range,
  });

const ignoreInstanceAction = (
  document: TextDocument,
  diagnostic: Diagnostic,
  rule: string,
) =>
  commandAction("Ignore this instance", Commands.ignoreInstance, {
    uri: document.uri,
    instance: instanceOf(document.getText(), {
      id: rule,
      start: document.offsetAt(diagnostic.range.start),
      end: document.offsetAt(diagnostic.range.end),
    }),
  });

export type ActionOptions = { rewrite: boolean };

type Level = { title: string; scope: Scope; label: string };

const matching = (all: DiagnosticData[], scope: Scope) =>
  all.filter(
    (data) =>
      (scope.rule == null || data.rule === scope.rule) &&
      (scope.case == null || data.case === scope.case),
  ).length;

const levelsOf = ({ rule, case: key }: DiagnosticData): Level[] => [
  ...(key == null
    ? []
    : [
        {
          title: `Apply all "${key}"`,
          scope: { rule, case: key },
          label: `"${key}"`,
        },
      ]),
  { title: `Apply all ${rule}`, scope: { rule }, label: rule },
  { title: "Apply all issues in this file", scope: {}, label: "this file" },
];

const applyAllActions = (
  uri: string,
  data: DiagnosticData,
  all: DiagnosticData[],
) =>
  levelsOf(data)
    .map((level) => ({ ...level, count: matching(all, level.scope) }))
    .filter(({ count }) => count > 1)
    .map(({ title, scope, label, count }) =>
      commandAction(`${title} (${count})…`, Commands.applyAll, {
        uri,
        scope,
        label,
      }),
    );

const actionsFor = (
  document: TextDocument,
  diagnostic: Diagnostic,
  { rewrite }: ActionOptions,
  all: DiagnosticData[],
): CodeAction[] => {
  const data = diagnostic.data as DiagnosticData;
  return [
    ...data.fixes.map(quickFix(document, diagnostic, data.rule)),
    ...(rewrite ? [rewriteAction(document.uri, diagnostic)] : []),
    ...applyAllActions(document.uri, data, all),
    ignoreInstanceAction(document, diagnostic, data.rule),
    ...ignoreCaseAction(data),
    commandAction(`Turn off ${data.rule}`, Commands.disableRule, {
      rule: data.rule,
    }),
  ];
};

const isOurs = (diagnostic: Diagnostic) =>
  diagnostic.source === diagnosticSource && diagnostic.data != null;

const firstOfEachTitle = (
  action: CodeAction,
  index: number,
  all: CodeAction[],
) => all.findIndex(({ title }) => title === action.title) === index;

export const codeActionsFor = (
  document: TextDocument,
  diagnostics: Diagnostic[],
  range: Range,
  options: ActionOptions,
): CodeAction[] => {
  const ours = diagnostics.filter(isOurs);
  const all = ours.map((diagnostic) => diagnostic.data as DiagnosticData);
  return ours
    .filter((diagnostic) => overlaps(diagnostic.range, range))
    .flatMap((diagnostic) => actionsFor(document, diagnostic, options, all))
    .filter(firstOfEachTitle);
};
