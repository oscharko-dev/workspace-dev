import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactCompiler from "eslint-plugin-react-compiler";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const TEMPLATE_ROOT = fileURLToPath(new URL(".", import.meta.url));

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
  "@typescript-eslint/strict-boolean-expressions": "off"
};

export default tseslint.config(
  {
    ignores: ["dist/**"]
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      sourceType: "module",
      globals: globals.node
    }
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.{ts,tsx}", "vite.config.ts"]
  })),
  {
    files: ["src/**/*.{ts,tsx}", "vite.config.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: ["./tsconfig.json"],
        tsconfigRootDir: TEMPLATE_ROOT
      }
    },
    plugins: {
      "jsx-a11y": jsxA11y,
      "react-compiler": reactCompiler,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...strictTypeCheckedRules,
      ...(reactHooks.configs["recommended-latest"]?.rules ?? reactHooks.configs.recommended.rules),
      ...jsxA11y.configs.recommended.rules,
      "no-undef": "off",
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true }
      ],
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/aria-role": "error"
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**/*"],
    plugins: {
      "react-compiler": reactCompiler
    },
    rules: {
      ...reactCompiler.configs.recommended.rules
    }
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off"
    }
  }
);
