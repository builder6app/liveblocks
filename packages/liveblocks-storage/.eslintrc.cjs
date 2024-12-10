// const rulesDirPlugin = require("eslint-plugin-rulesdir");
// rulesDirPlugin.RULES_DIR = "./rules";

module.exports = {
  root: true,
  // plugins: ["eslint-plugin-rulesdir"],
  extends: ["@liveblocks/eslint-config"],

  rules: {
    "@typescript-eslint/no-this-alias": "off",
  },

  overrides: [
    {
      files: ["test/**"],

      // Special config for test files
      rules: {
        "no-empty": "off",
      },
    },
  ],
};