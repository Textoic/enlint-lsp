import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import type { LintError } from "@textoic/enlint/types";
import {
  cleanedAnswer,
  completionFor,
  listModels,
  passageAround,
  passagesWithProblems,
  rewriteDocument,
  rewritePassage,
  withRewrites,
  styleGuide,
  type Complete,
} from "../src/rewrite/index.js";

const problem = (start: number, end: number): LintError => ({
  id: "no-bad-words",
  start,
  end,
  message: "m",
});

const answering =
  (content: string, truncated = false): Complete =>
  () =>
    Promise.resolve({ content, truncated });

describe("passageAround", () => {
  it("widens a span to its paragraph", () => {
    const text = "First.\n\nSecond one here.\n\nThird.";
    assert.deepEqual(passageAround(text, { start: 10, end: 12 }), {
      start: 8,
      end: 24,
    });
  });

  it("finds paragraphs in a file with Windows line endings", () => {
    const text = "First.\r\n\r\nSecond one here.\r\n\r\nThird.";
    assert.deepEqual(passageAround(text, { start: 12, end: 14 }), {
      start: 10,
      end: 26,
    });
  });

  it("leaves the newline at the end of the file out of the last paragraph", () => {
    const text = "First.\n\nLast one.\n";
    assert.deepEqual(passageAround(text, { start: 10, end: 14 }), {
      start: 8,
      end: 17,
    });
  });
});

describe("cleanedAnswer", () => {
  it("strips a code fence around the answer", () => {
    assert.equal(cleanedAnswer("```md\nHello.\n```"), "Hello.");
  });
});

describe("rewritePassage", () => {
  const text = "Keep this.\n\nFix this sentence.";
  const lintBefore = (input: string) =>
    input === text ? [problem(12, 15)] : [];

  it("accepts a rewrite with fewer problems", async () => {
    const rewrite = await rewritePassage(
      { text, start: 12, end: 15 },
      { complete: answering("Fixed sentence."), lint: lintBefore },
    );
    assert.equal(rewrite.original, "Fix this sentence.");
    assert.equal(rewrite.accepted, true);
    assert.equal(rewrite.start, 12);
  });

  it("rejects an empty answer", async () => {
    const rewrite = await rewritePassage(
      { text, start: 12, end: 15 },
      { complete: answering(""), lint: lintBefore },
    );
    assert.equal(rewrite.reason, "the model returned nothing");
  });

  it("rejects a truncated answer", async () => {
    const rewrite = await rewritePassage(
      { text, start: 12, end: 15 },
      { complete: answering("Fixed", true), lint: lintBefore },
    );
    assert.equal(
      rewrite.reason,
      "the model ran out of room before finishing the passage",
    );
  });

  it("rejects a rewrite with more problems than it started with", async () => {
    const rewrite = await rewritePassage(
      { text, start: 12, end: 15 },
      {
        complete: answering("Worse sentence."),
        lint: (input) =>
          input === text ? [problem(12, 15)] : [problem(0, 5), problem(6, 9)],
      },
    );
    assert.equal(rewrite.accepted, false);
    assert.match(rewrite.reason ?? "", /2 style problems, more than the 1/u);
  });
});

describe("providers", () => {
  it("sends the key and reads the cost from OpenRouter", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return Promise.resolve(
        Response.json({
          choices: [{ message: { content: "<think>x</think>Done." } }],
          usage: { cost: 0.002, prompt_tokens: 10, completion_tokens: 2 },
        }),
      );
    };
    const complete = completionFor(
      { kind: "openrouter", model: "m", apiKey: "sk" },
      fakeFetch as typeof fetch,
    );
    const answer = await complete({ messages: [], maxOutputTokens: 10 });
    assert.equal(answer.content, "Done.");
    assert.equal(answer.costUsd, 0.002);
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(
      (calls[0].init.headers as Record<string, string>).authorization,
      "Bearer sk",
    );
  });

  it("refuses OpenRouter without a key", () => {
    assert.throws(() =>
      completionFor({ kind: "openrouter", model: "m", apiKey: " " }),
    );
  });

  it("asks Ollama to answer without thinking and passes the abort signal", async () => {
    const sent: {
      body: Record<string, unknown>;
      signal?: AbortSignal | null;
    }[] = [];
    const fakeFetch = (_url: string, init?: RequestInit) => {
      sent.push({
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
        signal: init?.signal,
      });
      return Promise.resolve(
        Response.json({ message: { content: "Done." }, done_reason: "stop" }),
      );
    };
    const controller = new AbortController();
    const complete = completionFor(
      { kind: "ollama", model: "qwen" },
      fakeFetch as typeof fetch,
    );
    const answer = await complete({
      messages: [],
      maxOutputTokens: 10,
      signal: controller.signal,
    });
    assert.equal(answer.content, "Done.");
    assert.equal(sent[0].body.think, false);
    assert.equal(sent[0].body.stream, false);
    assert.equal(sent[0].signal, controller.signal);
  });

  it("lets an aborted request fail as an abort, not as an unreachable host", async () => {
    const fakeFetch = () =>
      Promise.reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    const complete = completionFor(
      { kind: "ollama", model: "qwen" },
      fakeFetch as typeof fetch,
    );
    await assert.rejects(complete({ messages: [], maxOutputTokens: 10 }), {
      name: "AbortError",
    });
  });

  it("lists Ollama models from its tags", async () => {
    const fakeFetch = () =>
      Promise.resolve(
        Response.json({ models: [{ name: "b" }, { name: "a" }] }),
      );
    assert.deepEqual(
      await listModels({ kind: "ollama" }, fakeFetch as typeof fetch),
      ["a", "b"],
    );
  });
});

describe("style guide", () => {
  it("matches assets/style-guide.md", async () => {
    const source = await readFile(
      new URL("../assets/style-guide.md", import.meta.url),
      "utf8",
    );
    assert.equal(styleGuide, source);
  });
});

describe("passagesWithProblems", () => {
  it("returns each paragraph with a problem once, in order", () => {
    const text = "One bad.\n\nClean.\n\nTwo bad, three bad.";
    assert.deepEqual(
      passagesWithProblems(text, [
        problem(30, 33),
        problem(4, 7),
        problem(20, 23),
      ]),
      [
        { start: 0, end: 8 },
        { start: 18, end: 37 },
      ],
    );
  });
});

describe("withRewrites", () => {
  it("replaces every passage at its original offsets", () => {
    const text = "One bad.\n\nClean.\n\nTwo bad.";
    assert.equal(
      withRewrites(text, [
        { start: 0, end: 8, replacement: "One good, and longer." },
        { start: 18, end: 26, replacement: "Two." },
      ]),
      "One good, and longer.\n\nClean.\n\nTwo.",
    );
  });
});

describe("rewriteDocument", () => {
  const text = "One bad.\n\nClean.\n\nTwo bad.";
  const lintText = (input: string) =>
    input === text ? [problem(4, 7), problem(22, 25)] : [];
  const failsOnTwo: Complete = ({ messages }) =>
    (messages.at(-1)?.content ?? "").includes("Two")
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ content: "One good.", truncated: false });

  it("rewrites each paragraph, reports progress and explains a failure", async () => {
    const progress: string[] = [];
    const rewrites = await rewriteDocument(text, {
      complete: failsOnTwo,
      lint: lintText,
      concurrency: 2,
      onProgress: ({ done, total }) => progress.push(`${done}/${total}`),
    });
    assert.deepEqual(
      rewrites.map(({ start, end, accepted }) => [start, end, accepted]),
      [
        [0, 8, true],
        [18, 26, false],
      ],
    );
    assert.equal(rewrites[0]?.replacement, "One good.");
    assert.equal(rewrites[1]?.reason, "the request failed: offline");
    assert.deepEqual(progress, ["0/2", "1/2", "2/2"]);
  });

  it("stops when the signal aborts", async () => {
    const controller = new AbortController();
    const abortOnFirst: Complete = () => {
      controller.abort();
      return Promise.reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    };
    await assert.rejects(
      rewriteDocument(text, {
        complete: abortOnFirst,
        lint: lintText,
        signal: controller.signal,
      }),
    );
  });
});
