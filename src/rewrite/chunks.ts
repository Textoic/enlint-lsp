import type { LintError } from "@textoic/enlint/types";
import { paragraphsIn, type Span } from "./prompt.js";

export type ChunkLimits = {
  maxWords: number;
  maxChars: number;
  maxProblems: number;
};

export const defaultChunkLimits: ChunkLimits = {
  maxWords: 500,
  maxChars: 3500,
  maxProblems: 40,
};

type Budget = { text: string; problems: LintError[]; limits: ChunkLimits };

type Gap = { from: number; to: number };

type Piece = Span & { flagged: boolean };

type Draft = Span & { flaggedEnd: number };

type Packing = { chunks: Span[]; draft: Draft | null };

const wordsIn = (text: string) => (text.match(/\S+/gu) ?? []).length;

const touching = (problems: LintError[], { start, end }: Span) =>
  problems.filter((problem) => problem.end > start && problem.start < end);

const fits = ({ text, problems, limits }: Budget, span: Span) =>
  span.end - span.start <= limits.maxChars &&
  wordsIn(text.slice(span.start, span.end)) <= limits.maxWords &&
  touching(problems, span).length <= limits.maxProblems;

const splitsAProblem = (problems: LintError[], { from, to }: Gap) =>
  problems.some((problem) => problem.start < to && problem.end > from);

const sentenceGaps = /(?<=[.!?]["'”’)\]]*)\s+/gu;

const wordGaps = /\s+/gu;

const gapsIn = (budget: Budget, span: Span, pattern: RegExp): Gap[] =>
  [...budget.text.slice(span.start, span.end).matchAll(pattern)]
    .map(({ index, 0: found }) => ({
      from: span.start + index,
      to: span.start + index + found.length,
    }))
    .filter(({ from, to }) => from > span.start && to < span.end)
    .filter((gap) => !splitsAProblem(budget.problems, gap));

const lastGapThatFits = (budget: Budget, start: number, gaps: Gap[]) => {
  const later = gaps.filter(({ from }) => from > start);
  return (
    later.filter(({ from }) => fits(budget, { start, end: from })).at(-1) ??
    later.at(0)
  );
};

const packed = (budget: Budget, span: Span, gaps: Gap[]): Span[] => {
  if (fits(budget, span)) {
    return [span];
  }

  const gap = lastGapThatFits(budget, span.start, gaps);
  return gap == null
    ? [span]
    : [
        { start: span.start, end: gap.from },
        ...packed(budget, { start: gap.to, end: span.end }, gaps),
      ];
};

const piecesOf =
  (budget: Budget) =>
  (paragraph: Span): Span[] =>
    packed(budget, paragraph, gapsIn(budget, paragraph, sentenceGaps)).flatMap(
      (sentences) =>
        packed(budget, sentences, gapsIn(budget, sentences, wordGaps)),
    );

const flaggedBy =
  (problems: LintError[]) =>
  (span: Span): Piece => ({
    ...span,
    flagged: touching(problems, span).length > 0,
  });

const closed = ({ start, flaggedEnd }: Draft): Span => ({
  start,
  end: flaggedEnd,
});

const started = (piece: Piece): Draft | null =>
  piece.flagged ? { ...piece, flaggedEnd: piece.end } : null;

const extended = (draft: Draft, piece: Piece): Draft => ({
  start: draft.start,
  end: piece.end,
  flaggedEnd: piece.flagged ? piece.end : draft.flaggedEnd,
});

const packInto =
  (budget: Budget) =>
  ({ chunks, draft }: Packing, piece: Piece): Packing => {
    if (draft == null) {
      return { chunks, draft: started(piece) };
    }

    const longer = extended(draft, piece);
    return fits(budget, longer)
      ? { chunks, draft: longer }
      : { chunks: [...chunks, closed(draft)], draft: started(piece) };
  };

export const chunksWithProblems = (
  text: string,
  problems: LintError[],
  limits: ChunkLimits = defaultChunkLimits,
): Span[] => {
  if (problems.length === 0) {
    return [];
  }

  const budget = { text, problems, limits };
  const { chunks, draft } = paragraphsIn(text)
    .flatMap(piecesOf(budget))
    .map(flaggedBy(problems))
    .reduce<Packing>(packInto(budget), { chunks: [], draft: null });
  return draft == null ? chunks : [...chunks, closed(draft)];
};
