import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCustomerProfileConfig } from "./customer-profile.js";
import { applyCustomerProfileToTemplate } from "./customer-profile-template.js";
import { validateGeneratedProjectCustomerProfile } from "./customer-profile-validation.js";

const createCustomerProfile = () => {
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
          brandTheme: "sparkasse"
        }
      ],
      imports: {
        components: {
          Button: {
            family: "Components",
            package: "@customer/components",
            export: "PrimaryButton",
            importAlias: "CustomerButton"
          }
        }
      },
      fallbacks: {
        mui: {
          defaultPolicy: "deny",
          components: {
            Card: "allow"
          }
        }
      },
      template: {
        dependencies: {
          "@customer/components": "^1.2.3"
        },
        importAliases: {
          "@customer/ui": "@customer/components"
        }
      },
      strictness: {
        match: "warn",
        token: "off",
        import: "error"
      }
    }
  });
  if (!parsed) {
    throw new Error("Failed to create customer profile test fixture.");
  }
  return parsed;
};

const createCustomerProfileWithInput = (input: Record<string, unknown>) => {
  const parsed = parseCustomerProfileConfig({ input });
  if (!parsed) {
    throw new Error("Failed to create customer profile test fixture.");
  }
  return parsed;
};

const seedGeneratedProject = async ({
  generatedProjectDir,
  sourceContent
}: {
  generatedProjectDir: string;
  sourceContent: string;
}): Promise<void> => {
  await mkdir(path.join(generatedProjectDir, "src"), { recursive: true });
  await writeFile(
    path.join(generatedProjectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "generated-app",
        private: true,
        dependencies: {},
        devDependencies: {}
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(generatedProjectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          moduleResolution: "bundler",
          strict: true
        },
        include: ["src", "vite.config.ts"]
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(generatedProjectDir, "vite.config.ts"),
    `import { defineConfig } from "vitest/config";

const normalizedBasePath = "./";

export default defineConfig({
  base: normalizedBasePath,
  test: {
    globals: true
  }
});
`,
    "utf8"
  );
  await writeFile(path.join(generatedProjectDir, "src", "App.tsx"), sourceContent, "utf8");
};

test("validateGeneratedProjectCustomerProfile fails when dependencies, aliases, and MUI fallback policy are violated", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-"));
  const customerProfile = createCustomerProfile();

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Button } from "@mui/material";
export const App = () => <Button>Continue</Button>;
`
    });

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "failed");
    assert.equal(summary.import.issueCount >= 3, true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_MUI_FALLBACK"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectCustomerProfile returns warn when import policy is warn and src is absent", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-warn-"));
  const customerProfile = createCustomerProfileWithInput({
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
        brandTheme: "sparkasse"
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
      dependencies: {
        "@customer/components": "^1.2.3"
      },
      importAliases: {}
    },
    strictness: {
      match: "warn",
      token: "off",
      import: "warn"
    }
  });

  try {
    await writeFile(
      path.join(generatedProjectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: {},
          devDependencies: {}
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(path.join(generatedProjectDir, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(path.join(generatedProjectDir, "vite.config.ts"), "export default {};\n", "utf8");

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "warn");
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectCustomerProfile keeps status ok when import policy is off and project shapes are nonstandard", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-off-"));
  const customerProfile = createCustomerProfileWithInput({
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
        brandTheme: "sparkasse"
      }
    ],
    imports: {
      components: {
        Button: {
          family: "Components",
          package: "@customer/components",
          export: "PrimaryButton",
          importAlias: "CustomerButton"
        }
      }
    },
    fallbacks: {
      mui: {
        defaultPolicy: "deny"
      }
    },
    template: {
      dependencies: {
        "@customer/components": "^1.2.3"
      },
      devDependencies: {
        "@types/customer-components": "^1.0.0"
      },
      importAliases: {
        "@customer/ui": "@customer/components"
      }
    },
    strictness: {
      match: "warn",
      token: "off",
      import: "off"
    }
  });

  try {
    await mkdir(path.join(generatedProjectDir, "src", "nested"), { recursive: true });
    await writeFile(
      path.join(generatedProjectDir, "package.json"),
      `${JSON.stringify(
        {
          name: "generated-app",
          private: true,
          dependencies: [],
          devDependencies: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(generatedProjectDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      path.join(generatedProjectDir, "vite.config.ts"),
      `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true
  }
});
`,
      "utf8"
    );
    await writeFile(
      path.join(generatedProjectDir, "src", "nested", "App.js"),
      `import { UnknownThing } from "@customer/ui";
export const App = () => UnknownThing;
`,
      "utf8"
    );
    await writeFile(path.join(generatedProjectDir, "src", "nested", "README.md"), "# ignored\n", "utf8");

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "ok");
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEPENDENCY"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_DEV_DEPENDENCY"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_TEMPLATE_ALIAS"), true);
    assert.equal(summary.import.issues.some((issue) => issue.code === "E_CUSTOMER_PROFILE_IMPORT_EXPORT"), true);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});

test("validateGeneratedProjectCustomerProfile passes after template profile adaptation and explicit allowed fallback", async () => {
  const generatedProjectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-customer-profile-validation-pass-"));
  const customerProfile = createCustomerProfile();

  try {
    await seedGeneratedProject({
      generatedProjectDir,
      sourceContent: `import { Card } from "@mui/material";
import { PrimaryButton as CustomerButton } from "@customer/ui";
export const App = () => (
  <>
    <Card />
    <CustomerButton />
  </>
);
`
    });
    await applyCustomerProfileToTemplate({
      generatedProjectDir,
      customerProfile
    });

    const summary = await validateGeneratedProjectCustomerProfile({
      generatedProjectDir,
      customerProfile
    });

    assert.equal(summary.status, "ok");
    assert.equal(summary.import.issueCount, 0);
  } finally {
    await rm(generatedProjectDir, { recursive: true, force: true });
  }
});
