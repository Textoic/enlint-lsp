import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LintError } from "@textoic/enlint/types";
import {
  groupedByRule,
  instanceOf,
  overlapping,
  sentenceAround,
  withInstance,
  withoutIgnoredInstances,
  withoutInstance,
} from "../src/issues.js";

const problem = (
  id: LintError["id"],
  start: number,
  end: number,
): LintError => ({
  id,
  start,
  end,
  message: "m",
});

const text =
  "The room was very dirty. The food was very dirty too.\n\nA new   paragraph with very dirty words.";

describe("sentenceAround", () => {
  it("takes the sentence around a span, with whitespace squeezed", () => {
    assert.equal(
      sentenceAround(text, { start: 38, end: 48 }),
      "The food was very dirty too.",
    );
    assert.equal(
      sentenceAround(text, { start: 78, end: 88 }),
      "A new paragraph with very dirty words.",
    );
  });
});

describe("ignored instances", () => {
  const first = problem("no-explained-intensifiers", 13, 23);
  const second = problem("no-explained-intensifiers", 38, 48);

  it("hides only the instance that was ignored", () => {
    const ignored = [instanceOf(text, second)];
    assert.deepEqual(withoutIgnoredInstances(text, [first, second], ignored), [
      first,
    ]);
  });

  it("keeps hiding the instance after edits elsewhere and drops it once its sentence changes", () => {
    const ignored = [instanceOf(text, second)];
    const edited = `Intro.\n\n${text}`;
    const moved = problem("no-explained-intensifiers", 46, 56);
    assert.deepEqual(withoutIgnoredInstances(edited, [moved], ignored), []);
    const rewritten = text.replace("too.", "as well.");
    assert.deepEqual(withoutIgnoredInstances(rewritten, [second], ignored), [
      second,
    ]);
  });

  it("adds an instance once and removes it again", () => {
    const instance = instanceOf(text, first);
    const once = withInstance(withInstance([], instance), instance);
    assert.equal(once.length, 1);
    assert.deepEqual(withoutInstance(once, instance), []);
  });
});

describe("groupedByRule", () => {
  it("sorts groups from most to fewest issues, then by name", () => {
    const issues = [
      { rule: "b", n: 1 },
      { rule: "a", n: 2 },
      { rule: "c", n: 3 },
      { rule: "c", n: 4 },
    ];
    assert.deepEqual(
      groupedByRule(issues).map(({ rule, issues: members }) => [
        rule,
        members.length,
      ]),
      [
        ["c", 2],
        ["a", 1],
        ["b", 1],
      ],
    );
  });
});

describe("overlapping", () => {
  it("keeps issues that touch the visible range", () => {
    const issues = [
      { start: 0, end: 5 },
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ];
    assert.deepEqual(overlapping(issues, { start: 15, end: 30 }), [
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ]);
  });
});
