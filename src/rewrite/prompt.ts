import type { LintError } from "@textoic/enlint/types";
import type { ChatMessage } from "./providers.js";

export type Span = { start: number; end: number };

const paragraphBreaksIn = (text: string) =>
  [...text.matchAll(/\r?\n[ \t]*\r?\n/gu)].map(({ index, 0: found }) => ({
    from: index,
    to: index + found.length,
  }));

const paragraphStartBefore = (text: string, at: number) =>
  paragraphBreaksIn(text)
    .filter(({ to }) => to <= at)
    .at(-1)?.to ?? 0;

const paragraphEndAfter = (text: string, at: number) =>
  paragraphBreaksIn(text).find(({ from }) => from >= at)?.from ??
  Math.max(at, text.trimEnd().length);

export const passageAround = (text: string, { start, end }: Span): Span => {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(text.length, Math.max(start, end));
  return {
    start: paragraphStartBefore(text, from),
    end: paragraphEndAfter(text, to),
  };
};

const exactReplacements = (problem: LintError) =>
  (problem.suggestions ?? [])
    .filter(
      ({ range: [from, to] }) => from === problem.start && to === problem.end,
    )
    .map(({ text }) => text)
    .filter((text) => text !== "");

const describe = (passage: string, problem: LintError, offset: number) => {
  const span = passage
    .slice(problem.start - offset, problem.end - offset)
    .replace(/\s+/gu, " ");
  const swaps = exactReplacements(problem);
  const offered =
    swaps.length > 0
      ? `\n  Replacements the rule offers: ${swaps.join(", ")}`
      : "";
  return `- "${span}": ${problem.message}${offered}`;
};

const systemPrompt = (guide: string) =>
  `You are an English style editor. You are given a passage, the style guide you edit by, and the problems a linter found in it. Fix every listed problem, and bring the surrounding sentence in line with the guide while you are there. Change as little as you can: every word the problems do not reach comes through untouched and in the same order. Keep the meaning, tense, register and the Markdown formatting. Return only the edited passage: no preamble, no notes, no quotation marks or code fences around it.

The style guide:

${guide}`;

const problemList = (passage: string, problems: LintError[], offset: number) =>
  problems.length === 0
    ? "None listed. Apply the style guide and change nothing else."
    : problems.map((problem) => describe(passage, problem, offset)).join("\n");

export type RewritePrompt = {
  guide: string;
  passage: string;
  problems: LintError[];
  offset: number;
};

export const rewriteMessages = ({
  guide,
  passage,
  problems,
  offset,
}: RewritePrompt): ChatMessage[] => [
  { role: "system", content: systemPrompt(guide) },
  {
    role: "user",
    content: `The passage to edit:\n\n${passage}\n\nProblems the linter found:\n${problemList(passage, problems, offset)}\n\nReturn the edited passage and nothing else.`,
  },
];

export const outputTokensFor = (passage: string) =>
  Math.min(4000, Math.ceil(passage.length / 2) + 200);

export const cleanedAnswer = (answer: string) => {
  const trimmed = answer.trim();
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/u.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).replace(/^\n+|\s+$/gu, "");
};
