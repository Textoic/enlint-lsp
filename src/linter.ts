import lint from "@textoic/enlint";
import type { Config, LintError, ParsedToken } from "@textoic/enlint/types";
import { blocks, type Block, type TextFormat } from "./markdown.js";
import type { Parser } from "./parser.js";

type Parsed = ParsedToken[][];

export type LintRun = {
  problems: LintError[];
  parsedBlocks: number;
  reusedBlocks: number;
};

const shifted = (sentences: Parsed, by: number): Parsed =>
  sentences.map((tokens) =>
    tokens.map((token) => ({
      ...token,
      misc: { ...token.misc, at: token.misc.at + by },
    })),
  );

export class DocumentLinter {
  private readonly parse: Parser;
  private cache = new Map<string, Parsed>();

  constructor(parse: Parser) {
    this.parse = parse;
  }

  lint(text: string, config: Config, format: TextFormat = "markdown"): LintRun {
    const found = blocks(text, format);
    const next = new Map<string, Parsed>();
    const sentences = found.flatMap((block) =>
      shifted(this.parsedBlock(block, next), block.at),
    );
    const reusedBlocks = found.filter(({ text: blockText }) =>
      this.cache.has(blockText),
    ).length;
    this.cache = next;
    return {
      problems: lint(sentences, config),
      parsedBlocks: found.length - reusedBlocks,
      reusedBlocks,
    };
  }

  private parsedBlock({ text }: Block, next: Map<string, Parsed>): Parsed {
    const parsed = this.cache.get(text) ?? next.get(text) ?? this.parse(text);
    next.set(text, parsed);
    return parsed;
  }
}

export const lintText = (
  parse: Parser,
  text: string,
  config: Config,
  format: TextFormat = "markdown",
): LintError[] => new DocumentLinter(parse).lint(text, config, format).problems;
