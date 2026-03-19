import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  {
    ignores: ["dist"]
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "*.config.js"],
    languageOptions: {
      sourceType: "module",
      globals: globals.node
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module"
      },
      globals: globals.browser
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "jsx-a11y": jsxA11y,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...(reactHooks.configs["recommended-latest"]?.rules ?? reactHooks.configs.recommended.rules),
      ...jsxA11y.configs.recommended.rules,
      "no-undef": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true }
      ],
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/aria-role": "error"
    }
  }
];
