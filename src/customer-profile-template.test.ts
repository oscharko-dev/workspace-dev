import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCustomerProfileConfig } from "./customer-profile.js";
import { applyCustomerProfileToTemplate } from "./customer-profile-template.js";

const createTemplateProfile = ({
  importAliases = { "@customer/ui": "@customer/components" },
  dependencies = { "@customer/components": "^1.2.3" },
  devDependencies = { "@types/customer-components": "^1.0.0" }
}: {
  importAliases?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} = {}) => {
  const parsed = parseCustomerProfileConfig({
    input: {
      version: 1,
      families: [
        {
          id: "Components",
          tierPriority: 10,
          aliases: {
            figma: ["Components"],
            storybook: ["components"],
            code: ["@customer/components"]
          }
        }
      ],
      brandMappings: [
        {
          id: "sparkasse",
          aliases: ["sparkasse"],
          brandTheme: "sparkasse",
          storybookThemes: {
            light: "sparkasse-light",
            dark: "sparkasse-dark"
          }
        }
      ],
      imports: {
        components: {}
      },
      fallbacks: {
        mui: {
          defaultPolicy: "allow"
        }
      },
      template: {
        dependencies,
        devDependencies,
        importAliases
      },
      strictness: {
        match: "warn",
        token: "off",
        import: "error"
      }
    }
  });
  if (!parsed) {
    throw new Error("Failed to create customer profile template fixture.");
  }
  return parsed;
};

const seedTemplateProject = async ({
  generatedProjectDir,
  packageJsonContent,
  tsconfigContent,
  viteConfigContent
}: {
  generatedProjectDir: string;
  packageJsonContent: string;
  tsconfigContent: string;
  viteConfigContent: string;
}): Promise<void> => {
  await writeFile(path.join(generatedProjectDir, "package.json"), packageJsonContent, "utf8");
  await writeFile(path.join(generatedProjectDir, "tsconfig.json"), tsconfigContent, "utf8");
  await writeFile(path.join(generatedProjectDir, "vite.config.ts"), viteConfigContent, "utf8");
};

test("applyCustomerProfileToTemplate merges dependencies and returns early when aliases are absent", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-template-no-alias-"));
  const customerProfile = createTemplateProfile({
    importAliases: {}
  });

  const originalTsconfig = `${JSON.stringify(
    {
      compilerOptions: {
        strict: true
      }
    },
    null,
    2
  )}\n`;
  const originalVite = `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true
  }
});
`;

  try {
    await seedTemplateProject({
      generatedProjectDir,
      packageJsonContent: `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: [],
          devDependencies: null
        },
        null,
        2
      )}\n`,
      tsconfigContent: originalTsconfig,
      viteConfigContent: originalVite
    });

    await applyCustomerProfileToTemplate({
      generatedProjectDir,
      customerProfile
    });

    const packageJson = JSON.parse(await readFile(path.join(generatedProjectDir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    assert.deepEqual(packageJson.dependencies, {
      "@customer/components": "^1.2.3"
    });
    assert.deepEqual(packageJson.devDependencies, {
      "@types/customer-components": "^1.0.0"
    });
    assert.equal(await readFile(path.join(generatedProjectDir, "tsconfig.json"), "utf8"), originalTsconfig);
    assert.equal(await readFile(path.join(generatedProjectDir, "vite.config.ts"), "utf8"), originalVite);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("applyCustomerProfileToTemplate replaces existing vite resolve aliases and merges tsconfig paths", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-template-replace-"));
  const customerProfile = createTemplateProfile();

  try {
    await seedTemplateProject({
      generatedProjectDir,
      packageJsonContent: `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: {
            react: "^19.0.0"
          },
          devDependencies: {
            vitest: "^4.0.0"
          }
        },
        null,
        2
      )}\n`,
      tsconfigContent: `${JSON.stringify(
        {
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@existing/ui": ["src/existing.ts"]
            }
          }
        },
        null,
        2
      )}\n`,
      viteConfigContent: `import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@existing/ui": "src/existing.ts"
    }
  },
  test: {
    globals: true
  }
});
`
    });

    await applyCustomerProfileToTemplate({
      generatedProjectDir,
      customerProfile
    });

    const tsconfig = JSON.parse(await readFile(path.join(generatedProjectDir, "tsconfig.json"), "utf8")) as {
      compilerOptions: {
        baseUrl: string;
        ignoreDeprecations: string;
        paths: Record<string, string[]>;
      };
    };
    const viteConfig = await readFile(path.join(generatedProjectDir, "vite.config.ts"), "utf8");

    assert.equal(tsconfig.compilerOptions.baseUrl, ".");
    assert.equal(tsconfig.compilerOptions.ignoreDeprecations, "6.0");
    assert.deepEqual(tsconfig.compilerOptions.paths, {
      "@customer/ui": ["@customer/components"],
      "@existing/ui": ["src/existing.ts"]
    });
    assert.equal(viteConfig.includes("\"@existing/ui\": \"src/existing.ts\""), false);
    assert.equal(viteConfig.includes("\"@customer/ui\": \"@customer/components\""), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("applyCustomerProfileToTemplate inserts vite aliases when defineConfig has no base property", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-template-insert-"));
  const customerProfile = createTemplateProfile();

  try {
    await seedTemplateProject({
      generatedProjectDir,
      packageJsonContent: `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: {},
          devDependencies: {}
        },
        null,
        2
      )}\n`,
      tsconfigContent: `${JSON.stringify(
        {
          compilerOptions: {}
        },
        null,
        2
      )}\n`,
      viteConfigContent: `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true
  }
});
`
    });

    await applyCustomerProfileToTemplate({
      generatedProjectDir,
      customerProfile
    });

    const viteConfig = await readFile(path.join(generatedProjectDir, "vite.config.ts"), "utf8");
    assert.equal(viteConfig.includes("resolve: {"), true);
    assert.equal(viteConfig.includes("\"@customer/ui\": \"@customer/components\""), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("applyCustomerProfileToTemplate throws when package.json is not an object", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-template-invalid-package-"));
  const customerProfile = createTemplateProfile();

  try {
    await seedTemplateProject({
      generatedProjectDir,
      packageJsonContent: "[]\n",
      tsconfigContent: "{}\n",
      viteConfigContent: "export default {};\n"
    });

    await assert.rejects(
      () =>
        applyCustomerProfileToTemplate({
          generatedProjectDir,
          customerProfile
        }),
      /Expected package\.json/
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("applyCustomerProfileToTemplate throws when tsconfig.json is not an object", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-template-invalid-tsconfig-"));
  const customerProfile = createTemplateProfile();

  try {
    await seedTemplateProject({
      generatedProjectDir,
      packageJsonContent: `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: {},
          devDependencies: {}
        },
        null,
        2
      )}\n`,
      tsconfigContent: "[]\n",
      viteConfigContent: `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true
  }
});
`
    });

    await assert.rejects(
      () =>
        applyCustomerProfileToTemplate({
          generatedProjectDir,
          customerProfile
        }),
      /Expected tsconfig\.json/
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("#698 applyCustomerProfileToTemplate correctly replaces nested resolve block with brace depth", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-template-nested-resolve-"));
  const customerProfile = createTemplateProfile();

  try {
    await seedTemplateProject({
      generatedProjectDir,
      packageJsonContent: `${JSON.stringify({ name: "generated-app", private: true, dependencies: { react: "^19.0.0" } }, null, 2)}\n`,
      tsconfigContent: `${JSON.stringify({ compilerOptions: { baseUrl: ".", paths: {} } }, null, 2)}\n`,
      viteConfigContent: `import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@old/pkg": "@old/target",
    },
    extensions: [".ts", ".tsx"],
  },
  test: {
    globals: true
  }
});
`
    });

    await applyCustomerProfileToTemplate({
      generatedProjectDir,
      customerProfile
    });

    const viteConfig = await readFile(path.join(generatedProjectDir, "vite.config.ts"), "utf8");
    assert.equal(viteConfig.includes("\"@old/pkg\""), false, "Old alias should be replaced");
    assert.equal(viteConfig.includes("\"@customer/ui\": \"@customer/components\""), true, "New alias should be present");
    assert.equal(viteConfig.includes("globals: true"), true, "Other config should be preserved");
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("applyCustomerProfileToTemplate throws when vite.config.ts does not expose a defineConfig block", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-template-invalid-vite-"));
  const customerProfile = createTemplateProfile();

  try {
    await seedTemplateProject({
      generatedProjectDir,
      packageJsonContent: `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: {},
          devDependencies: {}
        },
        null,
        2
      )}\n`,
      tsconfigContent: `${JSON.stringify(
        {
          compilerOptions: {}
        },
        null,
        2
      )}\n`,
      viteConfigContent: "export const config = {};\n"
    });

    await assert.rejects(
      () =>
        applyCustomerProfileToTemplate({
          generatedProjectDir,
          customerProfile
        }),
      /Could not locate defineConfig block/
    );
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});
