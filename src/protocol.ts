import type { LintError } from "@textoic/enlint/types";
import type { Range } from "vscode-languageserver";
import type { TextoicConfig } from "./config.js";
import type { ApplyAllMode, Scope } from "./fixes.js";
import type { IgnoredInstance, IgnoredInstances } from "./issues.js";
import type { Rewrite } from "./rewrite/index.js";
import type { ProviderSettings } from "./rewrite/providers.js";

export const Methods = {
  relint: "enlint/relint",
  lintText: "enlint/lintText",
  lintStats: "enlint/lintStats",
  rewrite: "enlint/rewrite",
  rewriteAll: "enlint/rewriteAll",
  rewriteProgress: "enlint/rewriteProgress",
  fixAll: "enlint/fixAll",
} as const;

export const Commands = {
  ignoreCase: "textoic.ignoreCase",
  disableRule: "textoic.disableRule",
  rewrite: "textoic.rewrite",
  rewriteAll: "textoic.rewriteAll",
  ignoreInstance: "textoic.ignoreInstance",
  applyAll: "textoic.applyAll",
} as const;

export const diagnosticSource = "textoic";

export const ruleDocsUrl = (rule: string) =>
  `https://textoic.com/rules#${rule}`;

export type Fix = { range: [number, number]; text: string };

export type DiagnosticData = {
  rule: string;
  case?: string;
  fixes: Fix[];
};

export type ClientSettings = {
  config?: TextoicConfig;
  debounceMs?: number;
  rewrite?: boolean;
  ignoredInstances?: IgnoredInstances;
};

export type SettingsSection = { textoic?: ClientSettings };

export type IgnoreCaseArguments = { rule: string; case: string };

export type DisableRuleArguments = { rule: string };

export type RewriteArguments = { uri: string; range: Range };

export type RelintParams = { uri: string };

export type RelintResult = { ok: boolean; problems: number };

export type LintTextParams = {
  text: string;
  languageId?: string;
  uri?: string;
};

export type LintTextResult = { problems: LintError[] };

export type LintStats = {
  uri: string;
  version: number;
  problems: number;
  parsedBlocks: number;
  reusedBlocks: number;
  durationMs: number;
};

export type RewriteParams = RewriteArguments & { provider: ProviderSettings };

export type RewriteResult = Rewrite & { range: Range };

export type RewriteAllArguments = { uri: string; scope?: Scope };

export type RewriteAllParams = RewriteAllArguments & {
  provider: ProviderSettings;
};

export type RewriteAllResult = { rewrites: RewriteResult[] };

export type RewriteProgressParams = {
  uri: string;
  done: number;
  total: number;
  rewrite?: RewriteResult;
  index?: number;
};

export type FixAllParams = { uri: string; scope?: Scope };

export type FixAllEdit = { range: Range; newText: string };

export type FixAllResult = { edits: FixAllEdit[]; remaining: number };

export type ApplyAllArguments = {
  uri: string;
  scope: Scope;
  label: string;
  mode?: ApplyAllMode;
};

export type IgnoreInstanceArguments = {
  uri: string;
  instance: IgnoredInstance;
};
