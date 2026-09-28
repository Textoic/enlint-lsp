export const houseRules = {
  "local/no-comments": "error",
  complexity: ["error", { max: 10 }],
  "max-depth": ["error", 3],
  "max-nested-callbacks": ["error", 3],
  "max-params": ["error", 4],
  "max-statements": ["error", 20],
  "max-lines-per-function": [
    "error",
    { max: 60, skipBlankLines: true, skipComments: true },
  ],
};

export const testRelaxations = {
  "max-lines-per-function": "off",
  "max-nested-callbacks": "off",
  "max-statements": "off",
};
