import type { LintError } from "@textoic/enlint/types";
import {
  cleanedAnswer,
  outputTokensFor,
  passageAround,
  rewriteMessages,
  type Span,
} from "./prompt.js";
import type { Complete, Completion } from "./providers.js";
import { styleGuide } from "./style-guide.js";

export * from "./document.js";
export * from "./prompt.js";
export * from "./providers.js";
export { styleGuide };

export type RewriteRequest = Span & { text: string };

export type Rewrite = Span & {
  original: string;
  replacement: string;
  before: LintError[];
  after: LintError[];
  accepted: boolean;
  reason?: string;
  costUsd?: number;
};

export type Lint = (text: string) => LintError[] | Promise<LintError[]>;

export type RewriteDependencies = {
  complete: Complete;
  lint: Lint;
  guide?: string;
  signal?: AbortSignal;
};

const wordsIn = (text: string) => (text.match(/\S+/gu) ?? []).length;

export type Verdict = {
  replacement: string;
  completion: Completion;
  wordsBefore: number;
  before: LintError[];
  after: LintError[];
};

const isOutOfProportion = ({ replacement, wordsBefore }: Verdict) => {
  const wordsAfter = wordsIn(replacement);
  return (
    wordsBefore >= 12 &&
    (wordsAfter < wordsBefore / 2 || wordsAfter > wordsBefore * 2)
  );
};

type Rejection = [
  applies: (verdict: Verdict) => boolean,
  because: (verdict: Verdict) => string,
];

const rejections: Rejection[] = [
  [({ replacement }) => replacement === "", () => "the model returned nothing"],
  [
    ({ completion }) => completion.truncated,
    () => "the model ran out of room before finishing the passage",
  ],
  [
    isOutOfProportion,
    ({ replacement, wordsBefore }) =>
      `the model returned ${wordsIn(replacement)} words for a passage of ${wordsBefore}`,
  ],
  [
    ({ before, after }) => after.length > before.length,
    ({ before, after }) =>
      `the rewrite has ${after.length} style problems, more than the ${before.length} it started with`,
  ],
];

export const rejectionOf = (verdict: Verdict): string | undefined =>
  rejections.find(([applies]) => applies(verdict))?.[1](verdict);

const within =
  ({ start, end }: Span) =>
  (problem: LintError) =>
    problem.start >= start && problem.end <= end;

const judged = (span: Span, original: string, verdict: Verdict): Rewrite => {
  const reason = rejectionOf(verdict);
  const { replacement, before, after, completion } = verdict;
  return {
    ...span,
    original,
    replacement,
    before,
    after,
    accepted: reason == null,
    ...(reason == null ? {} : { reason }),
    ...(completion.costUsd == null ? {} : { costUsd: completion.costUsd }),
  };
};

export const problemsWithin = (span: Span, problems: LintError[]) =>
  problems.filter(within(span));

export const rewriteSpan = async (
  text: string,
  span: Span,
  before: LintError[],
  { complete, lint, guide = styleGuide, signal }: RewriteDependencies,
): Promise<Rewrite> => {
  const original = text.slice(span.start, span.end);
  const completion = await complete({
    messages: rewriteMessages({
      guide,
      passage: original,
      problems: before,
      offset: span.start,
    }),
    maxOutputTokens: outputTokensFor(original),
    temperature: 0.3,
    signal,
  });
  const replacement = cleanedAnswer(completion.content);
  const after = replacement === "" ? [] : await lint(replacement);
  const wordsBefore = wordsIn(original);
  return judged(span, original, {
    replacement,
    completion,
    wordsBefore,
    before,
    after,
  });
};

export const rewritePassage = async (
  request: RewriteRequest,
  dependencies: RewriteDependencies,
): Promise<Rewrite> => {
  const span = passageAround(request.text, request);
  const problems = await dependencies.lint(request.text);
  return rewriteSpan(
    request.text,
    span,
    problemsWithin(span, problems),
    dependencies,
  );
};
