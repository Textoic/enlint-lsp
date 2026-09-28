const machineReadable =
  /^\s*(eslint|globals?|exported|prettier-ignore|istanbul|c8|v8|@ts-|<reference)/;

const lineStartOf = (text, index) => {
  let start = index;
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) {
    start -= 1;
  }
  return start;
};

const endOfLineAfter = (text, index) => {
  if (text[index] === "\r" && text[index + 1] === "\n") {
    return index + 2;
  }
  return text[index] === "\n" ? index + 1 : index;
};

const removalRange = (text, [start, end]) => {
  const from = lineStartOf(text, start);
  const ownsTheLine = from === 0 || text[from - 1] === "\n";
  return ownsTheLine ? [from, endOfLineAfter(text, end)] : [from, end];
};

const noComments = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Ban prose comments; rationale belongs in architecture.md",
    },
    fixable: "whitespace",
    schema: [],
    messages: {
      banned:
        "No comments in code. Move the reasoning to docs/architecture.md and let the names carry the rest.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      Program() {
        const text = source.getText();
        source
          .getAllComments()
          .filter(
            ({ type, value }) =>
              type !== "Shebang" && !machineReadable.test(value),
          )
          .forEach((comment) =>
            context.report({
              loc: comment.loc,
              messageId: "banned",
              fix: (fixer) =>
                fixer.removeRange(removalRange(text, comment.range)),
            }),
          );
      },
    };
  },
};

export default { rules: { "no-comments": noComments } };
