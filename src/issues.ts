import type { LintError } from "@textoic/enlint/types";

export type IgnoredInstance = { rule: string; quote: string; context: string };

export type IgnoredInstances = Record<string, IgnoredInstance[]>;

type Located = { start: number; end: number };

const sentenceBreaks = /[.!?]\s|\n\s*\n/gu;

const sentenceBreak = /[.!?]\s|\n\s*\n/u;

const sentenceStartBefore = (text: string, at: number) =>
  [...text.slice(0, at).matchAll(sentenceBreaks)]
    .map(({ index, 0: found }) => index + found.length)
    .at(-1) ?? 0;

const sentenceEndAfter = (text: string, at: number) => {
  const found = text.slice(at).search(sentenceBreak);
  return found === -1 ? text.length : at + found + 1;
};

const squeezed = (text: string) => text.replace(/\s+/gu, " ").trim();

export const sentenceAround = (text: string, { start, end }: Located) =>
  squeezed(
    text.slice(sentenceStartBefore(text, start), sentenceEndAfter(text, end)),
  );

export const instanceOf = (
  text: string,
  problem: Located & { id: string },
): IgnoredInstance => ({
  rule: problem.id,
  quote: squeezed(text.slice(problem.start, problem.end)),
  context: sentenceAround(text, problem),
});

export const sameInstance = (one: IgnoredInstance, other: IgnoredInstance) =>
  one.rule === other.rule &&
  one.quote === other.quote &&
  one.context === other.context;

export const withoutIgnoredInstances = (
  text: string,
  problems: LintError[],
  ignored: IgnoredInstance[],
): LintError[] =>
  ignored.length === 0
    ? problems
    : problems.filter((problem) => {
        const instance = instanceOf(text, problem);
        return !ignored.some((each) => sameInstance(each, instance));
      });

export const withInstance = (
  ignored: IgnoredInstance[],
  instance: IgnoredInstance,
) =>
  ignored.some((each) => sameInstance(each, instance))
    ? ignored
    : [...ignored, instance];

export const withoutInstance = (
  ignored: IgnoredInstance[],
  instance: IgnoredInstance,
) => ignored.filter((each) => !sameInstance(each, instance));

export type IssueGroup<T> = { rule: string; issues: T[] };

const membersByRule = <T extends { rule: string }>(issues: T[]) =>
  issues.reduce((groups, issue) => {
    groups.set(issue.rule, [...(groups.get(issue.rule) ?? []), issue]);
    return groups;
  }, new Map<string, T[]>());

export const groupedByRule = <T extends { rule: string }>(
  issues: T[],
  nameOf: (rule: string) => string = (rule) => rule,
): IssueGroup<T>[] =>
  [...membersByRule(issues)]
    .map(([rule, members]) => ({ rule, issues: members }))
    .sort(
      (one, other) =>
        other.issues.length - one.issues.length ||
        nameOf(one.rule).localeCompare(nameOf(other.rule)),
    );

export const overlapping = <T extends Located>(
  issues: T[],
  { start, end }: Located,
) => issues.filter((issue) => issue.end >= start && issue.start <= end);
