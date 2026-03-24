import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));

const strictTypeCheckedRules = {
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    {
      prefer: "type-imports",
      fixStyle: "inline-type-imports"
    }
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-confusing-void-expression": "off",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-non-null-assertion": "off",
  "@typescript-eslint/no-unnecessary-condition": "error",
  "@typescript-eslint/no-unnecessary-type-parameters": "off",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unnecessary-type-arguments": "off",
  "@typescript-eslint/require-await": "off",
  "@typescript-eslint/restrict-template-expressions": "off",
  "@typescript-eslint/unbound-method": "off",
  "@typescript-eslint/no-deprecated": "off",
  "@typescript-eslint/strict-boolean-expressions": "off"
};

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "cjs/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts"]
  })),
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: globals.node,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: ROOT_DIR
      }
    },
    rules: {
      ...strictTypeCheckedRules,
      "no-console": "off"
    }
  }
);
