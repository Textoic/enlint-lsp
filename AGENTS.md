# Working on enlint-lsp

The language server that runs `@textoic/enlint` for the Textoic editors: the
VS Code extension (`textoic-code`), the desktop app (`textoic-desktop`) and the
website (`textoic-web`, in a Web Worker). It owns everything between a text
buffer and enlint's rules: splitting Markdown into blocks, caching parses per
block, resolving the eslint-style config, turning problems into diagnostics and
code actions, and running a verified AI rewrite of a passage.

The rules belong in `enlint` and the parser in `artisan`. Anything a single
client needs (settings screens, secret storage, billing) belongs in that
client. `src/` outside `src/node/` must stay free of Node APIs: the website
runs it in a browser worker, and `tsconfig.src.json` makes a Node import a
compile error.

# The working agreement

These rules bind every agent that touches this repository. They are not advice.
A hook enforces the first two on every edit you make, and it will reject the
edit and hand you the reasons.

## 1. No comments in code

Not one. Not a header, not a `//` at the end of a line, not a JSDoc block. The
only comments the linter allows are machine-readable directives:
`eslint-disable`, `@ts-expect-error`, `prettier-ignore`. Everything else is an
error.

This is not a style preference. A comment is a claim about the code that no
test checks and no compiler verifies, so it rots, and a wrong comment costs
more than no comment. Write code that does not need one instead: name the
variable after what it holds, name the function after what it does, and lift a
condition you were about to explain into a predicate whose name is the
explanation.

```
if (token.xpos === "ADJ" && !token.feats.NumType) {   // not a number word
```

becomes

```
const isNonNumericAdjective = ({ xpos, feats }) =>
  xpos === "ADJ" && !feats.NumType;
```

**Where the prose goes:** `docs/architecture.md`. That file is the one place in
this repository where you may write for a human. Put there anything you would
have put in a comment and could not express in a name:

- why a design went one way when another way looks more obvious
- what you tried that did not work, and the measurement that says so
- an invariant that spans files and cannot live in any one of them
- a constraint imposed from outside that the code cannot state

Write it as you would a lab notebook: dated entries, newest at the top, one
finding each. When you learn something while working, that is where it goes.
Read it before you start; it is the fastest way to avoid repeating an
experiment that already failed.

## 2. Keep functions simple

The linter enforces, per function: cyclomatic complexity at most 10, nesting
depth at most 3, at most 20 statements, at most 60 lines, at most 4 parameters,
and at most 3 nested callbacks. Tests are exempt from the length and nesting
limits, because a `describe` block is not a function in the sense that matters.

When the gate rejects a function, do not spread the same logic across two
functions to get under the number. Ask what the function is actually deciding,
and give each decision a name. The usual moves:

- A long `if (a && b && !c) return x;` chain becomes one named predicate per
  condition, then a flat sequence of guards.
- A `switch` or if-chain that maps a value to a result becomes a lookup object.
- A loop with branching inside becomes a `filter` then a `map`, each named.
- A function that gathers, then decides, then formats, becomes three functions.

Never reach for `eslint-disable` to get past the gate. If you genuinely believe
a limit is wrong for a specific function, leave it failing and say so in your
summary. That is a decision for the person you are working with, not for you.

## 3. Finish with an independent review

When you believe a feature or a fix is done — tests written, tests passing,
lint clean — you are not done. Hand the work to a reviewer that has not been
reading over your shoulder:

```
Agent(subagent_type: "independent-reviewer",
      description: "Review <what you built>",
      prompt: "<the original task> ... <the diff, or the files to read>")
```

Give it the task as it was given to you and the diff you produced. Do not tell
it what you think is safe, and do not tell it where to look; a review you have
steered is not a review.

Then handle what comes back on the merits. Fix what is a real bug. Where you
disagree, say why in your summary — "the reviewer flagged X; it is not a bug
because Y" is a fine answer, and a better one than a silent fix. A review that
returns nothing is a legitimate result; report that too.

## 4. Write the summary in the house style

Every summary of your work follows `docs/STYLE_GUIDELINES.md`. Read it. The
short version: be direct, use the active voice, one idea per sentence, prefer
verbs to nouns, and say the thing instead of gesturing at it.

State what you changed, what you verified and how, and what you left undone.
If tests fail, print the failure. If you skipped part of the task, say which
part and why. Do not open with a restatement of the request, do not close with
an offer to do more, and do not describe your own work as comprehensive,
robust, or production-ready — show the evidence and let the reader judge.

## The loop, in order

1. Read `docs/architecture.md`.
2. Build the thing. The hook checks every edit as you go.
3. Write tests. Run them.
4. Run `npm run lint` and `npm run typecheck`. Both must be clean.
5. Record in `docs/architecture.md` anything you learned that the code cannot say.
6. Send the diff to `independent-reviewer`. Act on what it finds.
7. Summarize, in the house style.
