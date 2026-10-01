import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wordDiff } from "../src/diff.js";

describe("wordDiff", () => {
  it("marks the words that went and the words that came", () => {
    assert.deepEqual(
      wordDiff("The room was very dirty.", "The room was filthy."),
      [
        { kind: "same", text: "The room was " },
        { kind: "removed", text: "very dirty." },
        { kind: "added", text: "filthy." },
      ],
    );
  });

  it("keeps an unchanged passage in one piece", () => {
    assert.deepEqual(wordDiff("Same text.", "Same text."), [
      { kind: "same", text: "Same text." },
    ]);
  });
});
