import type { LintError } from "@textoic/enlint/types";
import {
  problemsWithin,
  rewriteSpan,
  type Rewrite,
  type RewriteDependencies,
} from "./index.js";
import { problemsInScope, type Scope } from "../fixes.js";
import {
  chunksWithProblems,
  defaultChunkLimits,
  type ChunkLimits,
} from "./chunks.js";
import { passageAround, type Span } from "./prompt.js";

export type RewriteProgress = { done: number; total: number };

export type DocumentRewriteDependencies = RewriteDependencies & {
  concurrency?: number;
  onProgress?: (progress: RewriteProgress) => void;
  onRewrite?: (
    rewrite: Rewrite,
    index: number,
    progress: RewriteProgress,
  ) => void;
  scope?: Scope;
  limits?: ChunkLimits;
};

const byStart = (one: Span, other: Span) => one.start - other.start;

const touches = (earlier: Span, later: Span) => later.start <= earlier.end;

const mergedInto = (spans: Span[], span: Span): Span[] => {
  const last = spans.at(-1);
  return last != null && touches(last, span)
    ? [
        ...spans.slice(0, -1),
        { start: last.start, end: Math.max(last.end, span.end) },
      ]
    : [...spans, span];
};

export const passagesWithProblems = (
  text: string,
  problems: LintError[],
): Span[] =>
  problems
    .map((problem) => passageAround(text, problem))
    .sort(byStart)
    .reduce<Span[]>(mergedInto, []);

const inParallel = async <T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    if (next >= items.length) {
      return;
    }

    const index = next;
    next += 1;
    results[index] = await run(items[index]);
    await worker();
  };
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
};

const isAbort = (cause: unknown) =>
  (cause as { name?: string } | null)?.name === "AbortError";

const failedRewrite = (
  text: string,
  span: Span,
  before: LintError[],
  cause: unknown,
): Rewrite => ({
  ...span,
  original: text.slice(span.start, span.end),
  replacement: "",
  before,
  after: [],
  accepted: false,
  reason: `the request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
});

const rewriteOrExplain =
  (text: string, problems: LintError[], dependencies: RewriteDependencies) =>
  async (span: Span): Promise<Rewrite> => {
    dependencies.signal?.throwIfAborted();
    const before = problemsWithin(span, problems);
    try {
      return await rewriteSpan(text, span, before, dependencies);
    } catch (cause) {
      if (isAbort(cause) || dependencies.signal?.aborted === true) {
        throw cause;
      }

      return failedRewrite(text, span, before, cause);
    }
  };

export const rewriteDocument = async (
  text: string,
  {
    concurrency = 1,
    onProgress,
    onRewrite,
    scope = {},
    limits = defaultChunkLimits,
    ...dependencies
  }: DocumentRewriteDependencies,
): Promise<Rewrite[]> => {
  const problems = problemsInScope(await dependencies.lint(text), scope);
  const spans = chunksWithProblems(text, problems, limits);
  const rewrite = rewriteOrExplain(text, problems, dependencies);
  let done = 0;
  onProgress?.({ done, total: spans.length });
  return inParallel(
    spans.map((span, index) => ({ span, index })),
    concurrency,
    async ({ span, index }) => {
      const result = await rewrite(span);
      done += 1;
      onRewrite?.(result, index, { done, total: spans.length });
      onProgress?.({ done, total: spans.length });
      return result;
    },
  );
};

export type Replacement = Span & { replacement: string };

export const withRewrites = (text: string, rewrites: Replacement[]) =>
  [...rewrites]
    .sort((one, other) => other.start - one.start)
    .reduce(
      (result, { start, end, replacement }) =>
        `${result.slice(0, start)}${replacement}${result.slice(end)}`,
      text,
    );
