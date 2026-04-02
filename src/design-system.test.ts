import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import {
  __resetTypescriptModuleResolverForTests,
  __setTypescriptModuleResolverForTests,
  applyDesignSystemMappingsToGeneratedTsx,
  getDefaultDesignSystemConfigPath,
  inferDesignSystemConfigFromProject,
  loadDesignSystemConfigFile,
  parseDesignSystemConfig,
  writeDesignSystemConfigFile,
} from "./design-system.js";

afterEach(() => {
  __resetTypescriptModuleResolverForTests();
});

test("parseDesignSystemConfig normalizes valid mappings and filters invalid entries", () => {
  const config = parseDesignSystemConfig({
    input: {
      library: "  @acme/ui  ",
      mappings: {
        Button: {
          import: "  @acme/ui/buttons  ",
          component: "  PrimaryButton  ",
          propMappings: {
            label: "  children  ",
            disabled: "disabled",
            "invalid-prop": "ignored",
            color: 12,
          },
          omittedProps: [" disabled ", "invalid-prop", 42],
          defaultProps: {
            size: "small",
            dense: true,
            ignored: null,
          },
        },
        Card: {
          component: "Display Card",
        },
        TextField: {
          component: "FormField",
          propMappings: {
            label: " inputLabel ",
          },
        },
        "invalid-key": {
          component: "IgnoredComponent",
        },
      },
    },
  });

  assert.deepEqual(config, {
    library: "@acme/ui",
    mappings: {
      Button: {
        import: "@acme/ui/buttons",
        component: "PrimaryButton",
        defaultProps: {
          dense: true,
          size: "small",
        },
        omittedProps: ["disabled"],
        propMappings: {
          disabled: "disabled",
          label: "children",
        },
      },
      TextField: {
        component: "FormField",
        propMappings: {
          label: "inputLabel",
        },
      },
    },
  });
});

test("parseDesignSystemConfig rejects non-record inputs and blank libraries", () => {
  assert.equal(parseDesignSystemConfig({ input: null }), undefined);
  assert.equal(
    parseDesignSystemConfig({
      input: {
        library: "   ",
        mappings: {},
      },
    }),
    undefined,
  );
  assert.equal(
    parseDesignSystemConfig({
      input: {
        library: "@acme/ui",
        mappings: [],
      },
    }),
    undefined,
  );
});

test("loadDesignSystemConfigFile returns undefined for missing, invalid, and malformed config files", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-design-system-load-"),
  );
  const invalidConfigPath = path.join(tempDir, "invalid.json");
  const malformedPath = path.join(tempDir, "malformed.json");
  const missingPath = path.join(tempDir, "missing.json");
  const logs: string[] = [];

  try {
    await writeFile(
      invalidConfigPath,
      JSON.stringify({
        library: "   ",
        mappings: {
          Button: {
            component: "Invalid Component Name",
          },
        },
      }),
      "utf8",
    );
    await writeFile(malformedPath, "{not valid json", "utf8");

    assert.equal(
      await loadDesignSystemConfigFile({
        designSystemFilePath: missingPath,
        onLog: (message) => {
          logs.push(message);
        },
      }),
      undefined,
    );
    assert.equal(
      await loadDesignSystemConfigFile({
        designSystemFilePath: invalidConfigPath,
        onLog: (message) => {
          logs.push(message);
        },
      }),
      undefined,
    );
    assert.equal(
      await loadDesignSystemConfigFile({
        designSystemFilePath: malformedPath,
        onLog: (message) => {
          logs.push(message);
        },
      }),
      undefined,
    );

    assert.equal(
      logs.some((entry) => entry.includes("is invalid; using MUI defaults")),
      true,
    );
    assert.equal(
      logs.some((entry) =>
        entry.includes("Failed to load design system config"),
      ),
      true,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("applyDesignSystemMappingsToGeneratedTsx rewrites mapped imports, aliases collisions, and remaps props", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: `import ExistingButton from "@shared/ExistingButton";
import * as ExistingNamespace from "@shared/icons";
import { Button as MuiButton, Card, TextField } from "@mui/material";

export const Checkout = () => {
  return (
    <>
      <MuiButton disabled>Continue</MuiButton>
      <Card>
        <TextField label="Email" />
      </Card>
    </>
  );
};
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: {
          component: "ExistingButton",
        },
        Card: {
          component: "ExistingButton",
        },
        TextField: {
          component: "FormField",
          import: "@acme/forms",
          propMappings: {
            label: "inputLabel",
          },
        },
      },
    },
  });

  assert.equal(transformed.includes('from "@mui/material"'), false);
  assert.match(
    transformed,
    /import \{ ExistingButton as ExistingButton2 \} from "@acme\/ui";/,
  );
  assert.match(transformed, /import \{ FormField \} from "@acme\/forms";/);
  assert.match(
    transformed,
    /<ExistingButton2 disabled>Continue<\/ExistingButton2>/,
  );
  assert.match(transformed, /<ExistingButton2>/);
  assert.match(transformed, /<FormField inputLabel="Email" \/>/);
  assert.equal(transformed.includes('label="Email"'), false);
});

test("applyDesignSystemMappingsToGeneratedTsx rewrites multiline MUI imports, spreads, aliases, and self-closing tags", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: `import ExistingButton from "@shared/ExistingButton";
import {
  Button as MuiButton,
  Card,
  TextField as MuiTextField,
  type Theme
} from "@mui/material";

const fieldProps = {};
const theme = {} as Theme;

export const Checkout = () => {
  void theme;
  return (
    <>
      <MuiButton disabled>Continue</MuiButton>
      <Card />
      <MuiTextField {...fieldProps} label="Email" />
    </>
  );
};
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: {
          component: "ExistingButton",
        },
        Card: {
          component: "ContentCard",
          import: "@acme/layout",
        },
        TextField: {
          component: "FormField",
          import: "@acme/forms",
          propMappings: {
            label: "inputLabel",
          },
        },
      },
    },
  });

  assert.match(transformed, /import \{ type Theme \} from "@mui\/material";/);
  assert.match(
    transformed,
    /import \{ ExistingButton as ExistingButton2 \} from "@acme\/ui";/,
  );
  assert.match(transformed, /import \{ ContentCard \} from "@acme\/layout";/);
  assert.match(transformed, /import \{ FormField \} from "@acme\/forms";/);
  assert.match(
    transformed,
    /<ExistingButton2 disabled>Continue<\/ExistingButton2>/,
  );
  assert.match(transformed, /<ContentCard \/>/);
  assert.match(
    transformed,
    /<FormField \{\.\.\.fieldProps\} inputLabel="Email" \/>/,
  );
  assert.equal(transformed.includes("Button as MuiButton"), false);
  assert.equal(transformed.includes("TextField as MuiTextField"), false);
});

test("applyDesignSystemMappingsToGeneratedTsx remaps only exact JSX attribute names", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: `import { TextField } from "@mui/material";

export const Checkout = () => (
  <TextField label="Email" data-label="keep" aria-label="Accessible" />
);
`,
    config: {
      library: "@acme/ui",
      mappings: {
        TextField: {
          component: "FormField",
          propMappings: {
            label: "children",
          },
        },
      },
    },
  });

  assert.match(
    transformed,
    /<FormField children="Email" data-label="keep" aria-label="Accessible" \/>/,
  );
  assert.equal(transformed.includes("data-children"), false);
  assert.equal(transformed.includes("aria-children"), false);
});

test("applyDesignSystemMappingsToGeneratedTsx drops omitted semantic props and default-valued literals after mapping", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: `import { Button, TextField } from "@mui/material";

export const Checkout = () => (
  <>
    <Button variant="primary" size="small" disabled>
      Continue
    </Button>
    <TextField size="medium" helperText="Keep me" />
  </>
);
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: {
          component: "PrimaryButton",
          propMappings: {
            variant: "appearance",
          },
          omittedProps: ["disabled"],
          defaultProps: {
            size: "small",
          },
        },
        TextField: {
          component: "FormField",
          omittedProps: ["helperText"],
          defaultProps: {
            size: "medium",
          },
        },
      },
    },
  });

  assert.match(transformed, /<PrimaryButton appearance="primary">/);
  assert.equal(transformed.includes(" disabled"), false);
  assert.equal(transformed.includes('size="small"'), false);
  assert.equal(transformed.includes('helperText="Keep me"'), false);
  assert.match(transformed, /<FormField \/>/);
});

test("applyDesignSystemMappingsToGeneratedTsx throws deterministic error when the optional TypeScript peer is unavailable", () => {
  __setTypescriptModuleResolverForTests(() => null);

  assert.throws(() => {
    applyDesignSystemMappingsToGeneratedTsx({
      filePath: "src/screens/Checkout.tsx",
      content: `import { Button } from "@mui/material";
export const Checkout = () => <Button>Continue</Button>;
`,
      config: {
        library: "@acme/ui",
        mappings: {
          Button: {
            component: "PrimaryButton",
          },
        },
      },
    });
  }, /Design-system TSX transform requires the optional 'typescript' peer dependency to be installed\./);
});

test("applyDesignSystemMappingsToGeneratedTsx keeps non-target files unchanged", () => {
  const content = `import { Button } from "@mui/material";
export const SharedButton = () => <Button>Save</Button>;
`;

  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/layouts/SharedButton.tsx",
    content,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: {
          component: "PrimaryButton",
        },
      },
    },
  });

  assert.equal(transformed, content);
});

test("applyDesignSystemMappingsToGeneratedTsx replaces sole MUI import when all specifiers are mapped (#674)", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: `import { Button, Card } from "@mui/material";

export const Checkout = () => (
  <>
    <Button>Click</Button>
    <Card>Content</Card>
  </>
);
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: { component: "PrimaryButton" },
        Card: { component: "ContentCard", import: "@acme/layout" },
      },
    },
  });

  assert.equal(transformed.includes("@mui/material"), false);
  assert.match(transformed, /import \{ ContentCard \} from "@acme\/layout";/);
  assert.match(transformed, /import \{ PrimaryButton \} from "@acme\/ui";/);
  assert.match(transformed, /<PrimaryButton>Click<\/PrimaryButton>/);
  assert.match(transformed, /<ContentCard>Content<\/ContentCard>/);
  assert.equal(
    transformed.indexOf("import"),
    0,
    "Design imports should start at the beginning of the file",
  );
});

test("applyDesignSystemMappingsToGeneratedTsx handles two separate MUI import declarations (#674)", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: `import React from "react";
import { type Theme, Button } from "@mui/material";
import { Card } from "@mui/material";

const t = {} as Theme;
export const Checkout = () => (
  <>
    <Button>Click</Button>
    <Card />
  </>
);
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: { component: "PrimaryButton" },
        Card: { component: "ContentCard" },
      },
    },
  });

  assert.match(transformed, /import \{ type Theme \} from "@mui\/material";/);
  assert.equal(
    (transformed.match(/@mui\/material/g) ?? []).length,
    1,
    "Only the type-only residual MUI import should remain",
  );
  assert.match(
    transformed,
    /import \{ ContentCard, PrimaryButton \} from "@acme\/ui";/,
  );
  assert.match(transformed, /<PrimaryButton>Click<\/PrimaryButton>/);
  assert.match(transformed, /<ContentCard \/>/);
});

test("applyDesignSystemMappingsToGeneratedTsx transforms pattern component files (#674)", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/components/PromoPattern1.tsx",
    content: `import { Button } from "@mui/material";

export const PromoPattern1 = () => <Button>Buy</Button>;
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: { component: "PrimaryButton" },
      },
    },
  });

  assert.match(transformed, /import \{ PrimaryButton \} from "@acme\/ui";/);
  assert.match(transformed, /<PrimaryButton>Buy<\/PrimaryButton>/);
  assert.equal(transformed.includes("@mui/material"), false);
});

test("applyDesignSystemMappingsToGeneratedTsx transforms AppShell component files", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/components/AppShell1.tsx",
    content: `import { Button, Container } from "@mui/material";

export default function AppShell1() {
  return (
    <Container>
      <Button>Open</Button>
    </Container>
  );
}
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: { component: "PrimaryButton" }
      }
    }
  });

  assert.match(transformed, /import \{ PrimaryButton \} from "@acme\/ui";/);
  assert.match(transformed, /import \{ Container \} from "@mui\/material";/);
  assert.match(transformed, /<PrimaryButton>Open<\/PrimaryButton>/);
});

test("applyDesignSystemMappingsToGeneratedTsx skips namespace and default MUI imports (#674)", () => {
  const namespaceContent = `import * as MUI from "@mui/material";
export const Checkout = () => <MUI.Button>Click</MUI.Button>;
`;
  const namespaceResult = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: namespaceContent,
    config: {
      library: "@acme/ui",
      mappings: { Button: { component: "PrimaryButton" } },
    },
  });
  assert.equal(
    namespaceResult,
    namespaceContent,
    "Namespace imports from MUI should be left unchanged",
  );
});

test("applyDesignSystemMappingsToGeneratedTsx deduplicates design local for same-component aliases (#674)", () => {
  const transformed = applyDesignSystemMappingsToGeneratedTsx({
    filePath: "src/screens/Checkout.tsx",
    content: `import { Button as Btn1, Button as Btn2 } from "@mui/material";

export const Checkout = () => (
  <>
    <Btn1>Save</Btn1>
    <Btn2>Cancel</Btn2>
  </>
);
`,
    config: {
      library: "@acme/ui",
      mappings: {
        Button: { component: "PrimaryButton" },
      },
    },
  });

  assert.equal(transformed.includes("@mui/material"), false);
  assert.match(transformed, /<PrimaryButton>Save<\/PrimaryButton>/);
  assert.match(
    transformed,
    /<PrimaryButton>Cancel<\/PrimaryButton>/,
    "Both aliases of the same component resolve to the same design local",
  );
  assert.match(transformed, /import \{ PrimaryButton \} from "@acme\/ui";/);
});

test("inferDesignSystemConfigFromProject infers the dominant library, ignores excluded directories, and derives MUI bases", async () => {
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-design-system-scan-"),
  );

  try {
    await mkdir(path.join(projectRoot, "src", "screens"), { recursive: true });
    await mkdir(path.join(projectRoot, "src", "components"), {
      recursive: true,
    });
    await mkdir(path.join(projectRoot, "dist"), { recursive: true });
    await mkdir(path.join(projectRoot, "node_modules", "ignored"), {
      recursive: true,
    });
    await mkdir(path.join(projectRoot, ".workspace-dev"), { recursive: true });

    await writeFile(
      path.join(projectRoot, "src", "screens", "Checkout.tsx"),
      `import type { Theme } from "@acme/ui";
import { Button, AccountCard, LoginInput } from "@acme/ui";
import { Banner } from "@other/ui";

export const Checkout = () => {
  return (
    <>
      <Button />
      <AccountCard />
      <LoginInput />
      <Banner />
    </>
  );
};
`,
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "src", "components", "PromoPattern1.tsx"),
      `import React from "react";
import { TextField as SignupInput, PrimaryButton } from "@acme/ui";
import { LocalOnly } from "../local";

export const PromoPattern1 = () => (
  <>
    <SignupInput />
    <PrimaryButton />
  </>
);
`,
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "dist", "ignored.tsx"),
      `import { DistButton } from "@ignored/ui";
export const Ignored = () => <DistButton />;
`,
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, "node_modules", "ignored", "index.tsx"),
      `import { PackageButton } from "@ignored/ui";
export const Package = () => <PackageButton />;
`,
      "utf8",
    );
    await writeFile(
      path.join(projectRoot, ".workspace-dev", "ignored.tsx"),
      `import { WorkspaceButton } from "@ignored/ui";
export const Workspace = () => <WorkspaceButton />;
`,
      "utf8",
    );

    const result = await inferDesignSystemConfigFromProject({
      projectRoot,
    });

    assert.equal(result.selectedLibrary, "@acme/ui");
    assert.equal(result.scannedFiles, 2);
    assert.deepEqual(result.config, {
      library: "@acme/ui",
      mappings: {
        Button: {
          component: "Button",
        },
        Card: {
          component: "AccountCard",
        },
        TextField: {
          component: "TextField",
        },
      },
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("inferDesignSystemConfigFromProject honors a library override", async () => {
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-design-system-override-"),
  );

  try {
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "src", "Example.tsx"),
      `import { Button } from "@acme/ui";
export const Example = () => <Button />;
`,
      "utf8",
    );

    const result = await inferDesignSystemConfigFromProject({
      projectRoot,
      libraryOverride: "  @custom/ui  ",
    });

    assert.equal(result.selectedLibrary, "@custom/ui");
    assert.deepEqual(result.config, {
      library: "@custom/ui",
      mappings: {},
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("writeDesignSystemConfigFile writes sorted output and respects force", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-design-system-write-"),
  );
  const outputFilePath = path.join(tempDir, "nested", "design-system.json");

  try {
    await writeDesignSystemConfigFile({
      outputFilePath,
      force: false,
      config: {
        library: "@acme/ui",
        mappings: {
          TextField: {
            component: "FormField",
            propMappings: {
              helperText: "supportingText",
              label: "inputLabel",
            },
          },
          Button: {
            component: "PrimaryButton",
            import: "@acme/ui/buttons",
          },
        },
      },
    });

    const initialContent = await readFile(outputFilePath, "utf8");
    assert.equal(
      initialContent,
      `{
  "library": "@acme/ui",
  "mappings": {
    "Button": {
      "import": "@acme/ui/buttons",
      "component": "PrimaryButton"
    },
    "TextField": {
      "component": "FormField",
      "propMappings": {
        "helperText": "supportingText",
        "label": "inputLabel"
      }
    }
  }
}
`,
    );

    await assert.rejects(async () => {
      await writeDesignSystemConfigFile({
        outputFilePath,
        force: false,
        config: {
          library: "@acme/ui",
          mappings: {},
        },
      });
    }, /Use --force to overwrite/);

    await writeDesignSystemConfigFile({
      outputFilePath,
      force: true,
      config: {
        library: "@acme/updated",
        mappings: {},
      },
    });

    assert.equal(
      await readFile(outputFilePath, "utf8"),
      `{\n  "library": "@acme/updated",\n  "mappings": {}\n}\n`,
    );
    assert.equal(
      getDefaultDesignSystemConfigPath({ outputRoot: tempDir }),
      path.join(tempDir, "design-system.json"),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
