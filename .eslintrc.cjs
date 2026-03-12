module.exports = {
  root: true,
  env: {
    node: true,
    es2023: true
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["./tsconfig.json"],
    tsconfigRootDir: __dirname,
    sourceType: "module"
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-type-checked"
  ],
  ignorePatterns: ["dist/", "coverage/", "node_modules/", "cjs/"],
  rules: {
    "@typescript-eslint/consistent-type-imports": [
      "error",
      {
        prefer: "type-imports",
        fixStyle: "inline-type-imports"
      }
    ],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "@typescript-eslint/no-unnecessary-condition": "error",
    "@typescript-eslint/strict-boolean-expressions": "off",
    "no-console": "off"
  }
};
