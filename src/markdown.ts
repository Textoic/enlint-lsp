const blank = (text: string) => text.replace(/[^\n]/gu, " ");

const label = (match: string, text: string) => {
  const at = match.indexOf(text);
  return (
    blank(match.slice(0, at)) + text + blank(match.slice(at + text.length))
  );
};

type Replacer = (match: string, ...groups: string[]) => string;

const masks: [RegExp, Replacer][] = [
  [/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?=\n|$)/u, blank],
  [/^[ \t]*(`{3,}|~{3,})[\s\S]*?(?:\n[ \t]*\1[^\n]*|$(?![\s\S]))/gmu, blank],
  [/<!--[\s\S]*?-->/gu, blank],
  [/<\/?[a-zA-Z][^>\n]*>/gu, blank],
  [/`[^`\n]*`/gu, blank],
  [/^[ \t]*\[[^\]\n]+\]:[^\n]*$/gmu, blank],
  [/!?\[([^\]\n]*)\]\([^)\n]*\)/gu, label],
  [/!?\[([^\]\n]*)\]\[[^\]\n]*\]/gu, label],
  [/<[a-z][\w+.-]*:\/\/[^>\s]*>/giu, blank],
  [/\b[a-z][\w+.-]*:\/\/\S+|\bwww\.\S+/giu, blank],
  [/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gmu, blank],
  [/[ \t]#+[ \t]*$/gmu, blank],
  [/^[ \t]*[-=|:*_ \t]{3,}$/gmu, blank],
  [/[[\]|]/gu, blank],
  [/\*+|~~+/gu, blank],
  [/(?<!\w)_+|_+(?!\w)/gu, blank],
];

export const maskMarkdown = (text: string): string =>
  masks.reduce(
    (masked, [pattern, replace]) => masked.replace(pattern, replace),
    text,
  );

export type Block = { at: number; text: string };

const startsItsOwnBlock =
  /^[ \t]*(?:#{1,6}[ \t]|>|[-*+][ \t]|\d+[.)][ \t]|\||={2,}|-{2,}|`{3,}|~{3,})/u;

type Line = { at: number; raw: string; masked: string };

export type TextFormat = "markdown" | "plaintext";

const maskFor: Record<TextFormat, (text: string) => string> = {
  markdown: maskMarkdown,
  plaintext: (text) => text,
};

const linesOf = (text: string, format: TextFormat): Line[] => {
  const masked = maskFor[format](text).split("\n");
  let at = 0;
  return text.split("\n").map((raw, index) => {
    const line = { at, raw, masked: masked[index] };
    at += raw.length + 1;
    return line;
  });
};

const isBlank = ({ raw }: Line) => raw.trim() === "";

const endsMarkdownBlock = (line: Line) =>
  isBlank(line) || startsItsOwnBlock.test(line.raw);

const blockEnd: Record<TextFormat, (line: Line) => boolean> = {
  markdown: endsMarkdownBlock,
  plaintext: isBlank,
};

type Grouping = { done: Block[]; open: Block | null };

const closed = ({ done, open }: Grouping): Block[] =>
  open != null && open.text.trim() !== "" ? [...done, open] : done;

const extended = (open: Block | null, line: Line): Block =>
  open == null
    ? { at: line.at, text: line.masked }
    : { at: open.at, text: `${open.text}\n${line.masked}` };

const groupBy =
  (endsBlock: (line: Line) => boolean) =>
  (grouping: Grouping, line: Line): Grouping => {
    const done = endsBlock(line) ? closed(grouping) : grouping.done;
    const open = endsBlock(line) ? null : grouping.open;
    return { done, open: isBlank(line) ? open : extended(open, line) };
  };

export const blocks = (
  text: string,
  format: TextFormat = "markdown",
): Block[] =>
  closed(
    linesOf(text, format).reduce(groupBy(blockEnd[format]), {
      done: [],
      open: null,
    }),
  );
