import type { Plugin } from "prettier";
import type { format as prettierFormat } from "prettier/standalone";
import { detectLanguage } from "../../../lib/shiki-shared";

export type ViewerLanguage = ReturnType<typeof detectLanguage>;
type FormatParser = "typescript" | "json";

export type FormatStatus =
  | { kind: "idle"; message: null }
  | { kind: "formatting"; message: null }
  | { kind: "success"; message: null }
  | { kind: "error"; message: string };

interface PrettierModules {
  format: typeof prettierFormat;
  typescriptPlugin: Plugin;
  babelPlugin: Plugin;
  estreePlugin: Plugin;
}

export const FORMAT_SUCCESS_TIMEOUT_MS = 1500;
export const FORMAT_ERROR_TIMEOUT_MS = 3000;

let prettierModulesPromise: Promise<PrettierModules> | null = null;

async function loadPrettierModules(): Promise<PrettierModules> {
  if (!prettierModulesPromise) {
    prettierModulesPromise = Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/typescript"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree")
    ]).then(([prettier, typescriptPlugin, babelPlugin, estreePlugin]) => ({
      format: prettier.format,
      typescriptPlugin,
      babelPlugin,
      estreePlugin
    }));

    prettierModulesPromise.catch(() => {
      prettierModulesPromise = null;
    });
  }

  return await prettierModulesPromise;
}

function resolveFormatParser(language: ViewerLanguage): FormatParser | null {
  if (language === "tsx" || language === "typescript") {
    return "typescript";
  }
  if (language === "json") {
    return "json";
  }
  return null;
}

export async function formatCodeForViewer({
  code,
  filePath,
  language
}: {
  code: string;
  filePath: string;
  language: ViewerLanguage;
}): Promise<string> {
  const parser = resolveFormatParser(language);
  if (!parser) {
    throw new Error("Formatting is unavailable for this file type.");
  }

  const { format, typescriptPlugin, babelPlugin, estreePlugin } = await loadPrettierModules();
  const plugins = parser === "json"
    ? [babelPlugin, estreePlugin]
    : [typescriptPlugin, estreePlugin];

  const formatted = await format(code, {
    parser,
    plugins,
    filepath: filePath
  });

  return formatted.replace(/\n$/, "");
}
