# enlint-lsp

The language server behind the Textoic editors. It lints English prose with
[enlint](https://github.com/Textoic/enlint) as you type, offers the rules'
replacements as quick fixes, lets you ignore a single case of a rule or turn a
rule off, and rewrites a flagged passage with a model you choose, then checks
the rewrite with the same rules before offering it.

One server serves every client:

| Client                                                         | Transport                   |
| -------------------------------------------------------------- | --------------------------- |
| [textoic-code](https://github.com/Textoic/textoic-code) (VS Code) | stdio, `enlint-lsp --stdio` |
| [textoic-desktop](https://github.com/Textoic/textoic-desktop)   | stdio or in-process         |
| [textoic.com](https://textoic.com)                              | a Web Worker in the browser |

```sh
npm install @textoic/enlint-lsp
npx enlint-lsp --stdio
```

## Configuration

Configuration works like eslint's: a preset, then rules by id, each with a
severity and optional options. Layers merge in order, so a later layer
overrides severity and options, and ignored cases add up across layers.

```json
{
  "extends": "recommended",
  "locale": "en-US",
  "rules": {
    "no-passive-sentences": "off",
    "no-mixed-dialects": "warn",
    "no-high-lexical-density": ["info", { "nounPercentage": 45 }],
    "no-explained-intensifiers": ["warn", { "ignore": ["dirty"] }],
    "no-bad-words": ["warn", { "ignore": ["delve into"] }]
  }
}
```

| Key       | Values                                                                      |
| --------- | --------------------------------------------------------------------------- |
| `extends` | `recommended` (enlint's defaults, the default) or `all` (every rule on)     |
| `locale`  | `en-US` or `en-GB`; `no-mixed-dialects` flags the other spelling            |
| `rules`   | severity `off`, `hint`, `info`, `warn` or `error`, or `[severity, options]` |

`ignore` works on the three rules with cases: `no-bad-words` (the expression,
as listed in [enlint's catalog](https://github.com/Textoic/enlint#the-rule-catalog)),
`no-explained-intensifiers` (the word after "very") and `no-explained-antonyms`
(the word after "not"). Every other key in the options object goes to the rule.

The server builds each document's config from two layers:

1. **Client settings.** The editor sends `{ config, debounceMs, rewrite }` as
   `initializationOptions` and again under `textoic` in
   `workspace/didChangeConfiguration`. VS Code stores them in user settings;
   the desktop app in its settings file; the website in the browser.
2. **Project config.** The Node server reads the nearest `textoic.config.json`
   or `.textoicrc.json` above the document, and drops its cache when the client
   reports `workspace/didChangeWatchedFiles`.

Unknown rules and bad severities are logged to the client's output and
otherwise skipped, so a typo never stops linting.

## Protocol

Standard LSP: `textDocument/publishDiagnostics` and `textDocument/codeAction`.
The server lints a document as soon as it opens and again `debounceMs`
(750 by default) after the last change. Only the Markdown blocks whose text
changed are parsed again.

Each diagnostic carries the rule id as `code`, a link to the rule on
textoic.com as `codeDescription`, and `data: { rule, case?, fixes }`.

Code actions on a diagnostic, in order:

1. one quick fix per replacement the rule offers,
2. `textoic.rewrite` with `{ uri, range }`, when the client set `rewrite: true`,
3. `textoic.ignoreCase` with `{ rule, case }`, for a problem with a case,
4. `textoic.disableRule` with `{ rule }`.

The three commands are the client's to implement: only the client knows where
its settings live. It then sends the new settings back through
`workspace/didChangeConfiguration`, and the server lints again.

Custom methods:

| Method            | Direction | Params                        | Result                                           |
| ----------------- | --------- | ----------------------------- | ------------------------------------------------ |
| `enlint/relint`   | request   | `{ uri }`                     | `{ ok, problems }`                               |
| `enlint/lintText` | request  | `{ text, languageId?, uri? }` | `{ problems }`, with the config for `uri`         |
| `enlint/rewrite`  | request   | `{ uri, range, provider }`    | the rewrite, its `range`, and whether it passed |
| `enlint/lintStats`| notify    | `{ uri, version, problems, parsedBlocks, reusedBlocks, durationMs }` | |

`provider` is `{ kind: "ollama", model, baseUrl? }` or
`{ kind: "openrouter", model, apiKey }`. The server widens the range to its
paragraph, sends the paragraph, the problems in it and the style guide to the
model, and lints the answer. It marks the rewrite as rejected, with a reason,
when the answer is empty, cut off, less than half or more than twice the
length, or has more problems than the original.

## Using it as a library

```ts
import { resolveConfig, toEnlintConfig, lintText } from "@textoic/enlint-lsp";
import { loadParser } from "@textoic/enlint-lsp/node";

const parse = await loadParser();
const config = toEnlintConfig(resolveConfig({ rules: { "no-similes": "off" } }));
lintText(parse, "The report was written by the committee.", config);
```

In a browser, start the server inside a worker and point it at artisan's data
files, which the page serves as static assets:

```ts
import { startWorkerServer } from "@textoic/enlint-lsp/browser";

startWorkerServer({ dictionary: "/artisan/dictionary.json", weights: "/artisan/weights.json" });
```

`@textoic/enlint-lsp/rewrite` exports the rewrite pipeline on its own, and
`@textoic/enlint-lsp/config` the config helpers (`withIgnoredCase`,
`withSeverity`, ...) that clients use to edit settings.

## Development

```sh
npm install
npm test        # node:test, with the real artisan parser
npm run lint
npm run typecheck
```

Read [AGENTS.md](AGENTS.md) before changing anything, and
[docs/architecture.md](docs/architecture.md) for the decisions behind the code.
