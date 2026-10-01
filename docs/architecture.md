# Architecture and findings: enlint-lsp

This file is the only place in this repository where prose about the code is
allowed to live. The linter rejects comments in source files, so everything a
comment would have said belongs here. Newest entries at the top, dated, one
finding each.

## Log

### 2026-09-30, rewrite all works in chunks of about 500 words, and "apply all" fixes first

One model call per paragraph failed two ways. textoic.com caps a passage at
4,000 characters, so a pasted document with no blank lines, or one long
paragraph, stopped the whole run. And a document of short paragraphs cost one
call each. `rewriteDocument` now packs flagged paragraphs into chunks of at
most 500 words, 3,500 characters and 40 problems (textoic.com accepts 50). 500 words is where models still return
the whole passage and follow the guide; it is a starting point to tune, not a
measurement. Clean paragraphs between two flagged ones join the chunk when
they fit, because the prompt already tells the model to leave untouched words
alone. An oversized paragraph splits at sentence ends, and a sentence that is
still too long at spaces, but a split never lands inside a problem, since a
problem cut in two would be sent to neither half.

"Apply all" exists at three levels (a case, a rule, the file) and in two
modes. The rules' own fixes are exact, so they apply at once without a
preview: `enlint/fixAll` takes the first suggestion of each problem and drops
one that overlaps a fix already taken. What a rewrite will say is unknown
until the model answers, so the second mode applies the fixes first and then
runs `rewriteAll` on the same scope, which by then only holds the problems no
rule could fix. The results come back one chunk at a time for the client to
preview.

### 2026-09-29, an ignored instance is its rule, its words and its sentence

"Ignore this instance" has to survive edits elsewhere in the document, so
offsets will not do. The instance is `{ rule, quote, context }`, where
`context` is the sentence around the problem with whitespace squeezed. The
same words in another sentence, or the same sentence under another rule,
still show. Editing the sentence brings the problem back, which is the honest
outcome: the writer ignored that sentence, not whatever replaced it. The
filter runs on published diagnostics and inside `lintFor`, so rewrites and
`enlint/lintText` for that URI respect it too. Clients own the storage; the
server only sees the list for each URI in the settings.

### 2026-09-29, rewrite all issues is one paragraph rewrite per paragraph

`rewriteDocument` lints the text once, widens each problem to its paragraph,
merges paragraphs that touch, and runs the single-passage rewrite on each with
the problems already found, so the document is not linted again per
paragraph. Each paragraph is judged on its own: one bad answer should not
throw away the good ones, so a failed model call becomes a rejected rewrite
with the error as its reason. An abort still rejects the whole run. Sending
the whole document to the model in one call was the other option; it makes
the answer hard to verify per paragraph and runs into output limits on long
documents.

Ollama runs one paragraph at a time because a local model serves one request
at a time anyway; OpenRouter runs three.

### 2026-09-29, a paragraph ends at a blank line in any line ending

`passageAround` looked for `

`, which a CRLF file never contains, so on
Windows a rewrite covered the whole file from the start to the end. It now
splits on `
?
[ ]\*
?
`. The last paragraph ends before trailing
whitespace, so a rewrite keeps the file's final newline.

### 2026-09-29, Ollama requests turn thinking off, and a cancelled rewrite aborts the model call

qwen3.8:27b thinks before it answers. With `stream: false` and a
`num_predict` of 225 tokens for a one-sentence passage, the thinking used the
whole budget: Ollama answered in 11 s with empty content and
`done_reason: "length"`, and every rewrite came back rejected as empty. The
request now sends `think: false`. The same prompt then answered in 0.8 s with
the rewrite. granite4.1:3b, which has no thinking mode, accepts the flag.

`enlint/rewrite` honours LSP cancellation. The handler turns the request's
cancellation token into an `AbortSignal` that reaches `fetch`, so cancelling
the editor's progress notification stops a slow local model. An aborted fetch
keeps its `AbortError` instead of becoming "Cannot reach the host".

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
