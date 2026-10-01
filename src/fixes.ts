import type { LintError } from "@textoic/enlint/types";

export type Scope = { rule?: string; case?: string };

export type ApplyAllMode = "fixes" | "fixesAndRewrites";

export type FixEdit = { start: number; end: number; text: string };

export type FixedText = { text: string; edits: FixEdit[] };

const sameRule = (scope: Scope, problem: LintError) =>
  scope.rule == null || problem.id === scope.rule;

const sameCase = (scope: Scope, problem: LintError) =>
  scope.case == null || problem.case === scope.case;

export const inScope = (scope: Scope) => (problem: LintError) =>
  sameRule(scope, problem) && sameCase(scope, problem);

export const problemsInScope = (problems: LintError[], scope: Scope) =>
  problems.filter(inScope(scope));

export const hasFix = (problem: LintError) =>
  (problem.suggestions ?? []).length > 0;

export const needsRewrite = (problem: LintError) => !hasFix(problem);

const firstFixOf = (problem: LintError): FixEdit | undefined => {
  const [suggestion] = problem.suggestions ?? [];
  return suggestion == null
    ? undefined
    : {
        start: suggestion.range[0],
        end: suggestion.range[1],
        text: suggestion.text,
      };
};

const byStart = (one: FixEdit, other: FixEdit) =>
  one.start - other.start || one.end - other.end;

const clearOf = (kept: FixEdit[], edit: FixEdit) => {
  const last = kept.at(-1);
  return last == null || edit.start >= last.end;
};

export const fixEditsFor = (problems: LintError[]): FixEdit[] =>
  problems
    .map(firstFixOf)
    .filter((edit): edit is FixEdit => edit != null)
    .sort(byStart)
    .reduce<FixEdit[]>(
      (kept, edit) => (clearOf(kept, edit) ? [...kept, edit] : kept),
      [],
    );

export const withFixEdits = (text: string, edits: FixEdit[]) =>
  [...edits]
    .sort((one, other) => other.start - one.start)
    .reduce(
      (result, { start, end, text: insert }) =>
        `${result.slice(0, start)}${insert}${result.slice(end)}`,
      text,
    );

export const applyFixes = (
  text: string,
  problems: LintError[],
  scope: Scope = {},
): FixedText => {
  const edits = fixEditsFor(problemsInScope(problems, scope));
  return { text: withFixEdits(text, edits), edits };
};

export type ScopeCounts = { total: number; fixable: number };

export const countsIn = (problems: LintError[], scope: Scope): ScopeCounts => {
  const matching = problemsInScope(problems, scope);
  return {
    total: matching.length,
    fixable: fixEditsFor(matching).length,
  };
};
