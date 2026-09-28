import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blocks } from "../src/markdown.js";

describe("blocks", () => {
  it("splits Markdown at blank lines and list items and keeps offsets", () => {
    const text = "# Title\n\nFirst line\nsecond line\n- item";
    const found = blocks(text);
    assert.deepEqual(
      found.map(({ at }) => at),
      [0, 9, 32],
    );
    assert.equal(found[1].text, "First line\nsecond line");
    assert.equal(found[0].text.trim(), "Title");
  });

  it("masks code and keeps link text", () => {
    const [block] = blocks("See [the docs](https://x.y) and `code`.");
    assert.equal(block.text.length, 39);
    assert.ok(block.text.includes("the docs"));
    assert.ok(!block.text.includes("code"));
    assert.ok(!block.text.includes("https"));
  });

  it("leaves plain text unmasked", () => {
    const [block] = blocks("Use *stars* as they are.", "plaintext");
    assert.equal(block.text, "Use *stars* as they are.");
  });

  it("treats a heading as ordinary text in plain text", () => {
    assert.equal(blocks("# not a heading\nsame block", "plaintext").length, 1);
  });
});
