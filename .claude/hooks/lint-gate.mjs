import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const lintable = /\.(ts|mts|cts|js|mjs|cjs)$/;
const skipped = /(^|[\\/])(node_modules|dist|public)[\\/]/;

const guidance = {
  "local/no-comments":
    "Delete it. If it records a decision or a finding worth keeping, write it in docs/architecture.md.",
  complexity:
    "Split the function: name each branch condition as its own predicate, or replace the if-chain with a lookup table.",
  "max-depth":
    "Flatten with early returns, or lift the inner block into a named function.",
  "max-statements":
    "The function is doing several jobs. Give each one its own function.",
  "max-lines-per-function":
    "Extract the parts that have names into functions with those names.",
  "max-params": "Group the arguments into one object, or split the function.",
  "max-nested-callbacks": "Name the inner callback and pass it by reference.",
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const targetOf = ({ tool_input: input = {}, tool_response: response = {} }) =>
  response.filePath ?? input.file_path ?? input.notebook_path ?? "";

const load = (name) =>
  import(pathToFileURL(resolve(projectRoot, name)).href).then(
    (module) => module.default ?? module,
  );

const buildLinter = async () => {
  const [local, rules, tseslint] = await Promise.all([
    load("tools/eslint-plugin-local.js"),
    load("tools/house-rules.js"),
    import("typescript-eslint"),
  ]);
  const { parser } = tseslint.default ?? tseslint;
  return new ESLint({
    cwd: projectRoot,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.{ts,mts,cts,js,mjs,cjs}"],
        languageOptions: { parser },
        plugins: { local },
        rules: rules.houseRules,
      },
      {
        files: ["test/**/*.{ts,js}", "**/*.test.{ts,js}"],
        rules: rules.testRelaxations,
      },
    ],
  });
};

const render = (problems, file) =>
  [
    `House rules reject this edit (${problems.length} problem${problems.length === 1 ? "" : "s"}):`,
    ...problems.map(
      ({ line, column, ruleId, message }) =>
        `  ${file}:${line}:${column}  ${message}  [${ruleId}]`,
    ),
    "",
    "How to fix:",
    ...[...new Set(problems.map(({ ruleId }) => guidance[ruleId]))]
      .filter(Boolean)
      .map((text) => `  - ${text}`),
    "",
    "Fix them now. Do not silence them with eslint-disable.",
  ].join("\n");

const main = async () => {
  const file = targetOf(JSON.parse((await readStdin()) || "{}"));
  if (!file || !lintable.test(file)) return 0;
  const inside = relative(projectRoot, resolve(file));
  if (inside.startsWith("..") || skipped.test(inside)) return 0;

  const linter = await buildLinter();
  const source = await readFile(resolve(file), "utf8");
  const results = await linter.lintText(source, { filePath: resolve(file) });
  const problems = results.flatMap(({ messages }) =>
    messages.filter(({ severity }) => severity === 2),
  );
  if (problems.length === 0) return 0;
  process.stderr.write(`${render(problems, inside.split("\\").join("/"))}\n`);
  return 2;
};

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`lint-gate skipped: ${error.message}\n`);
    process.exit(0);
  },
);
