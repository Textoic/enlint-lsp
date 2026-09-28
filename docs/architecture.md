# Architecture and findings: enlint-lsp

This file is the only place in this repository where prose about the code is
allowed to live. The linter rejects comments in source files, so everything a
comment would have said belongs here. Newest entries at the top, dated, one
finding each.

## Log

### 2026-09-27, the server was lifted out of the textoic app, and its core runs in a browser

The first language server lived in `textoic/packages/lsp` and took its linter
from `@textoic/core`, which reads files, holds sessions and calls models. The
VS Code extension and the website need the linting without the rest, so the
server moved here with its incremental linter and Markdown masking. The desktop
app now depends on this package.

`src/` compiles with `lib: ["es2022", "webworker"]` and no Node types;
`src/node/` compiles separately with Node types. The server imports
`vscode-languageserver`'s root entry, which is the transport-neutral common
API. `src/node` and `src/browser.ts` pick the transport. That split is what
lets textoic.com run the same server in a Web Worker.

### 2026-09-27, the idle delay dropped from four seconds to 750 ms

The desktop app waited four seconds after the last keystroke before linting.
An editor extension that behaves like eslint has to feel immediate, and a
re-lint after an edit re-parses only the blocks whose text changed, so a
typical keystroke costs one paragraph's parse. Clients set `debounceMs`; the
desktop app keeps its own setting.

### 2026-09-27, a document is linted at once on first sight and debounced after

`TextDocuments` fires `onDidChangeContent` for the open as well as for every
edit. Handling `onDidOpen` separately linted every new document twice. The
server now keeps a set of the documents it has seen: the first content event
lints at once, and later ones reset the debounce timer.

### 2026-09-27, the client owns settings, and the server only reads them

Ignoring a case or turning off a rule has to write somewhere: VS Code user
settings, the desktop app's settings file, or the browser. The server cannot
know which, so its code actions carry commands (`textoic.ignoreCase`,
`textoic.disableRule`) that each client implements and follows with a
`workspace/didChangeConfiguration`. Project files are the exception: the Node
server reads `textoic.config.json` itself, like eslint, because every Node
client would otherwise have to find it the same way.

### 2026-09-27, ignored cases union across layers; severity and options override

A user who ignores "delve into" in their editor and works in a repository that
ignores "utilize" expects both to be quiet. Severity and options follow eslint:
the later layer wins. `withIgnoredCase` writes `["warn", { ignore }]` when the
layer has no setting for the rule yet. All three case rules are on in both
presets, so that never switches a rule on by accident, but a client layer that
ignores a case can re-enable a rule a lower layer switched off.

### 2026-09-27, a project config that fails to load is reported, not fatal

On Windows `fileURLToPath` throws for `file:///virtual/doc.md`, which has no
drive letter, and the first test run timed out because the exception aborted
every lint. The server now catches any failure to load a project config, logs
it once, and lints with the client's settings alone.

### 2026-09-27, the rewrite pipeline takes its model and linter as arguments

`rewritePassage` receives `complete` and `lint` rather than building them, so
tests and clients can supply their own. textoic.com splits the pipeline: its
backend builds the prompt with `rewriteMessages` and calls OpenRouter with the
site's key, and the browser lints the answer and judges it with
`rejectionOf`. All three editors therefore judge a rewrite the same way. The style guide is a TypeScript string generated from
`assets/style-guide.md`, because a browser bundle cannot read a file; a test
fails when the two differ.
