import { defaults, ErrorId } from "@textoic/enlint";
import type { Config, IgnoredCases } from "@textoic/enlint/types";

export type Severity = "off" | "hint" | "info" | "warn" | "error";

export type ActiveSeverity = Exclude<Severity, "off">;

export type RuleOptions = { ignore?: string[] } & Record<string, unknown>;

export type RuleSetting = Severity | [Severity] | [Severity, RuleOptions];

export type Preset = "recommended" | "all";

export type TextoicConfig = {
  extends?: Preset;
  locale?: string;
  rules?: Record<string, RuleSetting>;
};

export type ResolvedRule = {
  severity: ActiveSeverity;
  options: Record<string, unknown>;
  ignore: string[];
};

export type ResolvedConfig = {
  locale: string;
  rules: Partial<Record<ErrorId, ResolvedRule>>;
  problems: string[];
};

type RuleState = {
  severity: Severity;
  options: Record<string, unknown>;
  ignore: string[];
};

const severities: Severity[] = ["off", "hint", "info", "warn", "error"];

export const ruleIds: ErrorId[] = Object.values(ErrorId);

const isRuleId = (id: string): id is ErrorId =>
  (ruleIds as string[]).includes(id);

const isSeverity = (value: unknown): value is Severity =>
  severities.includes(value as Severity);

const presetSeverity: Record<Preset, (id: ErrorId) => Severity> = {
  recommended: (id) => (defaults[id] === true ? "warn" : "off"),
  all: () => "warn",
};

const presetRules = (preset: Preset): Record<string, RuleState> =>
  Object.fromEntries(
    ruleIds.map((id) => [
      id,
      { severity: presetSeverity[preset](id), options: {}, ignore: [] },
    ]),
  );

const settingParts = (setting: RuleSetting): [unknown, RuleOptions] =>
  Array.isArray(setting) ? [setting[0], setting[1] ?? {}] : [setting, {}];

const withoutIgnore = (options: RuleOptions) =>
  Object.fromEntries(
    Object.entries(options).filter(([key]) => key !== "ignore"),
  );

const union = (one: string[], other: string[]) => [
  ...new Set([...one, ...other]),
];

const mergedRule = (previous: RuleState, setting: RuleSetting): RuleState => {
  const [severity, options] = settingParts(setting);
  return {
    severity: severity as Severity,
    options: { ...previous.options, ...withoutIgnore(options) },
    ignore: union(previous.ignore, options.ignore ?? []),
  };
};

const problemWith = (id: string, setting: RuleSetting) => {
  if (!isRuleId(id)) {
    return `Unknown rule "${id}".`;
  }

  const [severity] = settingParts(setting);
  return isSeverity(severity)
    ? undefined
    : `Rule "${id}" has severity ${JSON.stringify(severity)}; use one of ${severities.join(", ")}.`;
};

type Merged = { rules: Record<string, RuleState>; problems: string[] };

const applyLayer = (merged: Merged, layer: TextoicConfig): Merged =>
  Object.entries(layer.rules ?? {}).reduce(
    ({ rules, problems }: Merged, [id, setting]) => {
      const problem = problemWith(id, setting);
      return problem == null
        ? {
            rules: { ...rules, [id]: mergedRule(rules[id], setting) },
            problems,
          }
        : { rules, problems: [...problems, problem] };
    },
    merged,
  );

const presetOf = (layers: TextoicConfig[]): Preset =>
  layers.reduce(
    (preset: Preset, layer) => layer.extends ?? preset,
    "recommended",
  );

const localeOf = (layers: TextoicConfig[]) =>
  layers.reduce(
    (locale: string, layer) => layer.locale ?? locale,
    defaults.locale ?? "en-US",
  );

const isActive = (
  entry: [string, RuleState],
): entry is [ErrorId, RuleState & { severity: ActiveSeverity }] =>
  entry[1].severity !== "off";

export const resolveConfig = (
  ...given: (TextoicConfig | undefined)[]
): ResolvedConfig => {
  const layers = given.filter((layer): layer is TextoicConfig => layer != null);
  const { rules, problems } = layers.reduce(applyLayer, {
    rules: presetRules(presetOf(layers)),
    problems: [],
  });
  return {
    locale: localeOf(layers),
    rules: Object.fromEntries(Object.entries(rules).filter(isActive)),
    problems,
  };
};

const hasOptions = (options: Record<string, unknown>) =>
  Object.keys(options).length > 0;

const ignoredCasesOf = (resolved: ResolvedConfig): IgnoredCases =>
  Object.fromEntries(
    Object.entries(resolved.rules)
      .filter(([, rule]) => rule.ignore.length > 0)
      .map(([id, rule]) => [id, rule.ignore]),
  );

export const toEnlintConfig = (resolved: ResolvedConfig): Config =>
  ({
    locale: resolved.locale,
    ignore: ignoredCasesOf(resolved),
    ...Object.fromEntries(
      Object.entries(resolved.rules).map(([id, rule]) => [
        id,
        hasOptions(rule.options) ? rule.options : true,
      ]),
    ),
  }) as Config;

const ruleSettingOf = (config: TextoicConfig, rule: string): RuleSetting =>
  config.rules?.[rule] ?? "warn";

const withRule = (
  config: TextoicConfig,
  rule: string,
  setting: RuleSetting,
): TextoicConfig => ({
  ...config,
  rules: { ...config.rules, [rule]: setting },
});

export const withSeverity = (
  config: TextoicConfig,
  rule: string,
  severity: Severity,
): TextoicConfig => {
  const [, options] = settingParts(ruleSettingOf(config, rule));
  return withRule(
    config,
    rule,
    hasOptions(options) ? [severity, options] : severity,
  );
};

const severityOrDefault = (config: TextoicConfig, rule: string): Severity => {
  const [severity] = settingParts(ruleSettingOf(config, rule));
  return isSeverity(severity) ? severity : "warn";
};

const editIgnored = (
  config: TextoicConfig,
  rule: string,
  edit: (ignored: string[]) => string[],
): TextoicConfig => {
  const [, options] = settingParts(ruleSettingOf(config, rule));
  const ignore = edit(options.ignore ?? []);
  return withRule(config, rule, [
    severityOrDefault(config, rule),
    { ...options, ignore },
  ]);
};

export const withIgnoredCase = (
  config: TextoicConfig,
  rule: string,
  key: string,
): TextoicConfig =>
  editIgnored(config, rule, (ignored) => union(ignored, [key]));

export const withoutIgnoredCase = (
  config: TextoicConfig,
  rule: string,
  key: string,
): TextoicConfig =>
  editIgnored(config, rule, (ignored) =>
    ignored.filter((entry) => entry !== key),
  );

export const ignoredCasesIn = (config: TextoicConfig, rule: string) =>
  settingParts(ruleSettingOf(config, rule))[1].ignore ?? [];

export const severityIn = (
  config: TextoicConfig,
  rule: string,
): Severity | undefined => {
  const setting = config.rules?.[rule];
  return setting == null ? undefined : severityOrDefault(config, rule);
};
