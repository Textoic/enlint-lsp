import prettyStrict from "eslint-config-pretty-strict";
import tseslint from "typescript-eslint";
import local from "./tools/eslint-plugin-local.js";
import { houseRules, testRelaxations } from "./tools/house-rules.js";

export default tseslint.config(
  { ignores: ["dist/**", "eslint.config.js", ".claude/**", ".codex/**"] },
  ...prettyStrict,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.js"],
    plugins: { local },
    rules: houseRules,
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      ...testRelaxations,
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["tools/**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
