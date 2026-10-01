import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LintError } from "@textoic/enlint/types";
import {
  applyFixes,
  countsIn,
  fixEditsFor,
  needsRewrite,
  problemsInScope,
} from "../src/fixes.js";

type Fixed = {
  id: string;
  start: number;
  end: number;
  texts: string[];
  key?: string;
};

const fixed = ({ id, start, end, texts, key }: Fixed): LintError => ({
  id: id as LintError["id"],
  start,
  end,
  message: "m",
  suggestions: texts.map((text) => ({ range: [start, end], text })),
  ...(key == null ? {} : { case: key }),
});

const text = "The room was very dirty and the hall was very dirty.";
const dirtyRoom = fixed({
  id: "no-explained-intensifiers",
  start: 13,
  end: 23,
  texts: ["filthy"],
  key: "dirty",
});
const dirtyHall = fixed({
  id: "no-explained-intensifiers",
  start: 41,
  end: 51,
  texts: ["filthy"],
  key: "dirty",
});
const unfixable: LintError = {
  id: "no-similes" as LintError["id"],
  start: 0,
  end: 8,
  message: "m",
};

describe("problemsInScope", () => {
  it("keeps the problems of a rule, or of one case of it", () => {
    const problems = [dirtyRoom, dirtyHall, unfixable];
    assert.equal(problemsInScope(problems, {}).length, 3);
    assert.equal(
      problemsInScope(problems, { rule: "no-explained-intensifiers" }).length,
      2,
    );
    assert.equal(
      problemsInScope(problems, {
        rule: "no-explained-intensifiers",
        case: "big",
      }).length,
      0,
    );
  });
});

describe("applyFixes", () => {
  it("applies the first suggestion of every problem in the scope", () => {
    const result = applyFixes(text, [dirtyRoom, dirtyHall, unfixable], {
      rule: "no-explained-intensifiers",
      case: "dirty",
    });
    assert.equal(result.text, "The room was filthy and the hall was filthy.");
    assert.equal(result.edits.length, 2);
  });

  it("skips a fix that overlaps one already taken", () => {
    const wide = fixed({
      id: "no-passive-sentences",
      start: 0,
      end: 30,
      texts: ["Rewritten"],
    });
    assert.deepEqual(
      fixEditsFor([dirtyRoom, wide]).map(({ text: insert }) => insert),
      ["Rewritten"],
    );
  });
});

describe("countsIn", () => {
  it("counts the problems in a scope and how many a fix covers", () => {
    assert.deepEqual(countsIn([dirtyRoom, dirtyHall, unfixable], {}), {
      total: 3,
      fixable: 2,
    });
    assert.equal(needsRewrite(unfixable), true);
  });
});
