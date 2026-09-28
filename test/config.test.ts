import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ignoredCasesIn,
  resolveConfig,
  severityIn,
  toEnlintConfig,
  withIgnoredCase,
  withoutIgnoredCase,
  withSeverity,
} from "../src/config.js";

describe("resolveConfig", () => {
  it("starts from enlint's defaults", () => {
    const { rules } = resolveConfig();
    assert.equal(rules["no-passive-sentences"]?.severity, "warn");
    assert.equal(rules["no-mixed-dialects"], undefined);
  });

  it("turns every rule on with the all preset", () => {
    const { rules } = resolveConfig({ extends: "all" });
    assert.equal(rules["no-mixed-dialects"]?.severity, "warn");
  });

  it("lets a later layer override severity and merge options", () => {
    const { rules } = resolveConfig(
      {
        rules: {
          "no-high-lexical-density": ["info", { nounPercentage: 45 }],
        },
      },
      {
        rules: {
          "no-high-lexical-density": ["error", { minimumWords: 12 }],
          "no-passive-sentences": "off",
        },
      },
    );
    assert.deepEqual(rules["no-high-lexical-density"], {
      severity: "error",
      options: { nounPercentage: 45, minimumWords: 12 },
      ignore: [],
    });
    assert.equal(rules["no-passive-sentences"], undefined);
  });

  it("unions ignored cases across layers", () => {
    const { rules } = resolveConfig(
      { rules: { "no-bad-words": ["warn", { ignore: ["delve into"] }] } },
      {
        rules: {
          "no-bad-words": ["warn", { ignore: ["utilize", "delve into"] }],
        },
      },
    );
    assert.deepEqual(rules["no-bad-words"]?.ignore, ["delve into", "utilize"]);
  });

  it("reports unknown rules and severities without failing", () => {
    const { problems, rules } = resolveConfig({
      rules: {
        "no-such-rule": "warn",
        "no-similes": "loud" as never,
      },
    });
    assert.equal(problems.length, 2);
    assert.equal(rules["no-similes"]?.severity, "warn");
  });
});

describe("toEnlintConfig", () => {
  it("passes options, ignores and the locale to enlint", () => {
    const config = toEnlintConfig(
      resolveConfig({
        locale: "en-GB",
        rules: {
          "no-high-lexical-density": ["warn", { nounPercentage: 45 }],
          "no-explained-intensifiers": ["warn", { ignore: ["dirty"] }],
          "no-similes": "off",
        },
      }),
    );
    assert.equal(config.locale, "en-GB");
    assert.deepEqual(config["no-high-lexical-density"], { nounPercentage: 45 });
    assert.equal(config["no-explained-intensifiers"], true);
    assert.equal(config["no-similes"], undefined);
    assert.deepEqual(config.ignore, { "no-explained-intensifiers": ["dirty"] });
  });
});

describe("config edits", () => {
  it("adds and removes an ignored case without touching severity", () => {
    const start = { rules: { "no-bad-words": "error" as const } };
    const ignored = withIgnoredCase(start, "no-bad-words", "delve into");
    assert.deepEqual(ignoredCasesIn(ignored, "no-bad-words"), ["delve into"]);
    assert.equal(severityIn(ignored, "no-bad-words"), "error");
    const restored = withoutIgnoredCase(ignored, "no-bad-words", "delve into");
    assert.deepEqual(ignoredCasesIn(restored, "no-bad-words"), []);
  });

  it("changes severity and keeps the options", () => {
    const start = {
      rules: { "no-bad-words": ["warn", { ignore: ["utilize"] }] as never },
    };
    const off = withSeverity(start, "no-bad-words", "off");
    assert.equal(severityIn(off, "no-bad-words"), "off");
    assert.deepEqual(ignoredCasesIn(off, "no-bad-words"), ["utilize"]);
  });

  it("reports no severity for a rule the config does not name", () => {
    assert.equal(severityIn({}, "no-similes"), undefined);
  });
});
