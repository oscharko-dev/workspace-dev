import assert from "node:assert/strict";
import test from "node:test";
import { resolveComponentApiContract } from "./component-api-resolver.js";
import type { ResolvedStorybookTheme } from "./theme-resolver.js";
import type {
  ComponentMatchReportFigmaFamily,
  ComponentMatchReportResolvedImport,
  StorybookCatalogEntry,
  StorybookCatalogFamily,
  StorybookCatalogJsonValue,
  StorybookCatalogSignalReferences,
  StorybookPublicComponentsArtifact
} from "./types.js";

const createEmptySignalReferences = (): StorybookCatalogSignalReferences => ({
  componentPath: [],
  args: [],
  argTypes: [],
  designLinks: [],
  mdxLinks: [],
  docsImages: [],
  docsText: [],
  themeBundles: [],
  css: []
});

const createFigmaFamily = ({
  familyKey = "fam-1",
  familyName = "TestComponent",
  variantProperties = []
}: {
  familyKey?: string;
  familyName?: string;
  variantProperties?: ComponentMatchReportFigmaFamily["variantProperties"];
} = {}): ComponentMatchReportFigmaFamily => ({
  familyKey,
  familyName,
  nodeCount: 1,
  variantProperties
});

const createResolvedImport = ({
  pkg = "@customer/ui",
  exportName = "CustButton",
  localName = "CustButton",
  propMappings
}: {
  pkg?: string;
  exportName?: string;
  localName?: string;
  propMappings?: Record<string, string>;
} = {}): ComponentMatchReportResolvedImport => ({
  package: pkg,
  exportName,
  localName,
  ...(propMappings ? { propMappings } : {})
});

const createStorybookFamily = ({
  id = "family-1",
  title = "Components/Button",
  name = "Button",
  propKeys = [],
  componentPath
}: {
  id?: string;
  title?: string;
  name?: string;
  propKeys?: string[];
  componentPath?: string;
} = {}): StorybookCatalogFamily => ({
  id,
  title,
  name,
  tier: "primary",
  isDocsOnlyTier: false,
  entryIds: ["entry-1"],
  storyEntryIds: ["entry-1"],
  docsEntryIds: [],
  storyCount: 1,
  propKeys,
  hasDesignReference: false,
  componentPath,
  signalReferences: createEmptySignalReferences(),
  metadata: {
    designUrls: [],
    mdxLinks: { internal: [], external: [] },
    assetKeys: []
  }
});

const createStoryEntry = ({
  id = "entry-1",
  args,
  argTypes
}: {
  id?: string;
  args?: Record<string, StorybookCatalogJsonValue>;
  argTypes?: Record<string, StorybookCatalogJsonValue>;
} = {}): StorybookCatalogEntry => ({
  id,
  title: "Components/Button",
  name: "Default",
  type: "story",
  tier: "primary",
  tags: [],
  importPath: "./src/Button.stories.tsx",
  storiesImports: [],
  docsAttachment: "not_applicable",
  familyId: "family-1",
  familyTitle: "Components/Button",
  isDocsOnlyTier: false,
  signalReferences: createEmptySignalReferences(),
  metadata: {
    ...(args !== undefined ? { args } : {}),
    ...(argTypes !== undefined ? { argTypes } : {}),
    designUrls: [],
    mdxLinks: { internal: [], external: [] },
    assetKeys: []
  }
});

const createComponentsArtifact = (
  components: StorybookPublicComponentsArtifact["components"] = []
): StorybookPublicComponentsArtifact => ({
  artifact: "storybook.components",
  version: 1,
  stats: {
    entryCount: components.length,
    componentCount: components.length,
    componentWithDesignReferenceCount: 0,
    propKeyCount: components.reduce((sum, c) => sum + c.propKeys.length, 0)
  },
  components
});

test("resolveComponentApiContract returns not_applicable when library resolution is not resolved_import", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily(),
    libraryResolution: { status: "mui_fallback_allowed" }
  });
  assert.equal(result.resolvedApi.status, "not_applicable");
  assert.equal(result.resolvedProps.status, "not_applicable");
  assert.equal(result.resolvedProps.codegenCompatible, true);
  assert.deepEqual(result.resolvedApi.allowedProps, []);
  assert.deepEqual(result.resolvedApi.diagnostics, []);
});

test("resolveComponentApiContract returns not_applicable with fallbackPolicy forwarded", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily(),
    libraryResolution: { status: "not_applicable" },
    fallbackPolicy: "deny"
  });
  assert.equal(result.resolvedProps.status, "not_applicable");
  assert.equal(result.resolvedProps.fallbackPolicy, "deny");
});

test("resolveComponentApiContract resolves Button family with variant and size props", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      familyName: "Button",
      variantProperties: [
        { property: "variant", values: ["contained", "outlined", "text"] },
        { property: "size", values: ["small", "medium", "large"] },
        { property: "disabled", values: ["true", "false"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "size", "disabled", "color", "children"]
    }),
    storyEntry: createStoryEntry({
      args: { variant: "contained", size: "medium" }
    })
  });

  assert.equal(result.resolvedApi.status, "resolved");
  assert.equal(result.resolvedApi.componentKey, "Button");
  assert.equal(result.resolvedProps.status, "resolved");
  assert.equal(result.resolvedProps.codegenCompatible, true);
  assert.deepEqual(result.resolvedApi.diagnostics, []);

  const variantProp = result.resolvedApi.allowedProps.find((p) => p.name === "variant");
  assert.ok(variantProp);
  assert.equal(variantProp.kind, "enum");
  assert.deepEqual(variantProp.allowedValues, ["contained", "outlined", "text"]);

  const sizeProp = result.resolvedApi.allowedProps.find((p) => p.name === "size");
  assert.ok(sizeProp);
  assert.equal(sizeProp.kind, "enum");

  const disabledProp = result.resolvedApi.allowedProps.find((p) => p.name === "disabled");
  assert.ok(disabledProp);
  assert.equal(disabledProp.kind, "boolean");
  assert.deepEqual(disabledProp.allowedValues, [false, true]);

  assert.equal(result.resolvedApi.children.policy, "supported");
});

test("resolveComponentApiContract emits diagnostic for unsupported prop with deny fallback", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "variant", values: ["filled", "outlined"] },
        { property: "customProp", values: ["a", "b"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "TextField",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "size", "label"]
    }),
    fallbackPolicy: "deny"
  });

  assert.equal(result.resolvedProps.codegenCompatible, false);
  const unsupportedDiag = result.resolvedProps.diagnostics.find(
    (d) => d.code === "component_api_prop_unsupported"
  );
  assert.ok(unsupportedDiag);
  assert.equal(unsupportedDiag.severity, "error");
  assert.ok(unsupportedDiag.message.includes("customProp"));
  assert.equal(result.resolvedProps.omittedProps.length, 1);
  assert.equal(result.resolvedProps.omittedProps[0]?.sourceProp, "customProp");
});

test("resolveComponentApiContract emits warning for unsupported prop with allow fallback", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "unknownProp", values: ["x"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "children"]
    }),
    fallbackPolicy: "allow"
  });

  const diag = result.resolvedProps.diagnostics.find(
    (d) => d.code === "component_api_prop_unsupported"
  );
  assert.ok(diag);
  assert.equal(diag.severity, "warning");
});

test("resolveComponentApiContract detects children unsupported for always-children surface", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "variant", values: ["text"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant"]
    }),
    fallbackPolicy: "deny"
  });

  assert.equal(result.resolvedApi.children.policy, "unsupported");
  assert.equal(result.resolvedProps.codegenCompatible, false);
  const childDiag = result.resolvedProps.diagnostics.find(
    (d) => d.code === "component_api_children_unsupported"
  );
  assert.ok(childDiag);
  assert.equal(childDiag.severity, "error");
});

test("resolveComponentApiContract marks children not_used for never-children surface", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "variant", values: ["outlined"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "TextField",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "label"]
    })
  });

  assert.equal(result.resolvedApi.children.policy, "not_used");
  assert.equal(result.resolvedProps.children.policy, "not_used");
});

test("resolveComponentApiContract resolves Alert family with severity, sx, and children support", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      familyName: "Alert",
      variantProperties: [
        { property: "severity", values: ["error", "warning"] },
        { property: "sx", values: ["{}"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Alert",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["severity", "sx", "children"]
    }),
    storyEntry: createStoryEntry({
      args: {
        severity: "error",
        sx: {
          mt: 2
        }
      }
    })
  });

  assert.equal(result.resolvedApi.status, "resolved");
  assert.equal(result.resolvedApi.componentKey, "Alert");
  assert.equal(result.resolvedApi.children.policy, "supported");
  assert.ok(result.resolvedApi.allowedProps.some((prop) => prop.name === "severity"));
  const sxAllowedProp = result.resolvedApi.allowedProps.find((prop) => prop.name === "sx");
  assert.ok(sxAllowedProp);
  assert.equal(sxAllowedProp.kind, "object");
  assert.equal(sxAllowedProp.allowedValues, undefined);
  const sxResolvedProp = result.resolvedProps.props.find((prop) => prop.sourceProp === "sx");
  assert.ok(sxResolvedProp);
  assert.equal(sxResolvedProp.kind, "object");
  assert.equal(sxResolvedProp.values, undefined);
});

test("resolveComponentApiContract handles slotProps support and unsupported diagnostics", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "slotProps", values: ["{}"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "DatePicker",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["slotProps", "label", "disabled"]
    })
  });

  assert.equal(result.resolvedApi.slots.policy, "supported");
  assert.deepEqual(result.resolvedApi.slots.props, ["slotProps"]);
  const slotProp = result.resolvedProps.props.find((p) => p.sourceProp === "slotProps");
  assert.ok(slotProp);
  assert.equal(slotProp.kind, "object");
});

test("resolveComponentApiContract emits slot unsupported diagnostic", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "slotProps", values: ["{}"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "DatePicker",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["label"]
    }),
    fallbackPolicy: "deny"
  });

  assert.equal(result.resolvedApi.slots.policy, "unsupported");
  assert.equal(result.resolvedProps.codegenCompatible, false);
  const slotDiag = result.resolvedProps.diagnostics.find(
    (d) => d.code === "component_api_slot_unsupported"
  );
  assert.ok(slotDiag);
  assert.equal(slotDiag.severity, "error");
});

test("resolveComponentApiContract suppresses redundant defaults from theme", () => {
  const lightScheme = {
    themeId: "light",
    palette: {
      primary: { main: "#000" },
      secondary: { main: "#fff" },
      background: { default: "#fff", paper: "#fff" },
      text: { primary: "#000", secondary: "#666" },
      divider: "#ccc",
      error: { main: "#f00" },
      warning: { main: "#fa0" },
      info: { main: "#0af" },
      success: { main: "#0f0" }
    },
    spacingBase: 8,
    borderRadius: 4,
    typography: {
      fontFamily: "Roboto",
      base: { fontSizePx: 14, fontWeight: 400, lineHeight: 1.5, letterSpacing: "0em" },
      variants: {}
    },
    components: {
      MuiButton: {
        defaultProps: { variant: "contained", size: "medium" }
      }
    }
  };

  const resolvedStorybookTheme: ResolvedStorybookTheme = {
    customerBrandId: "brand-1",
    brandMappingId: "mapping-1",
    includeThemeModeToggle: false,
    light: lightScheme,
    tokensDocument: {
      customerBrandId: "brand-1",
      brandMappingId: "mapping-1",
      includeThemeModeToggle: false,
      light: lightScheme
    }
  };

  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "variant", values: ["contained"] },
        { property: "size", values: ["medium"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "size", "children"]
    }),
    resolvedStorybookTheme
  });

  assert.equal(result.resolvedProps.status, "resolved");
  assert.equal(result.resolvedProps.omittedDefaults.length, 2);
  const omittedVariant = result.resolvedProps.omittedDefaults.find(
    (d) => d.sourceProp === "variant"
  );
  assert.ok(omittedVariant);
  assert.equal(omittedVariant.value, "contained");
  assert.equal(omittedVariant.source, "storybook_theme_defaultProps");
});

test("resolveComponentApiContract applies propMappings to map source to target", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "inputSize", values: ["small", "large"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "TextField",
      import: createResolvedImport({
        propMappings: { inputSize: "size" }
      })
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["size", "label"]
    })
  });

  assert.equal(result.resolvedProps.status, "resolved");
  assert.ok(
    result.resolvedProps.props.length > 0,
    `Expected props but got: ${JSON.stringify(result.resolvedProps, null, 2)}`
  );
  const mappedProp = result.resolvedProps.props.find((p) => p.sourceProp === "inputSize");
  assert.ok(
    mappedProp,
    `Expected prop 'inputSize' but found: ${JSON.stringify(result.resolvedProps.props)}`
  );
  assert.equal(mappedProp.targetProp, "size");
});

test("resolveComponentApiContract emits diagnostic for prop mapping collision", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "Type", values: ["outlined"] },
        { property: "Kind", values: ["filled"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "TextField",
      import: createResolvedImport({
        propMappings: {
          Type: "variant",
          Kind: "variant"
        }
      })
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "children"]
    })
  });

  const collisionDiag = result.resolvedProps.diagnostics.find(
    (d) => d.code === "component_api_prop_mapping_collision"
  );
  assert.ok(collisionDiag, "Expected a prop mapping collision diagnostic");
  assert.equal(collisionDiag.severity, "warning");
  assert.equal(collisionDiag.targetProp, "variant");
});

test("resolveComponentApiContract treats single-value string variant as enum with allowedValues", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "variant", values: ["text"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "children"]
    })
  });

  const variantProp = result.resolvedApi.allowedProps.find(
    (p) => p.name === "variant"
  );
  assert.ok(variantProp);
  assert.equal(variantProp.kind, "enum");
  assert.deepEqual(variantProp.allowedValues, ["text"]);
});

test("resolveComponentApiContract normalizes Figma 'type' variant key to 'variant'", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "type", values: ["filled", "outlined"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "TextField",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "label"]
    })
  });

  assert.equal(result.resolvedProps.status, "resolved");
  const variantProp = result.resolvedProps.props.find((p) => p.sourceProp === "variant");
  assert.ok(variantProp, "Figma 'type' should normalize to 'variant'");
  assert.equal(variantProp.targetProp, "variant");
  assert.equal(variantProp.kind, "enum");
});

test("resolveComponentApiContract resolves all dominant board families", () => {
  const families = ["Alert", "TextField", "Select", "DatePicker", "Accordion", "Button", "Icon", "Typography"] as const;

  for (const family of families) {
    const result = resolveComponentApiContract({
      figmaFamily: createFigmaFamily({
        familyName: family,
        variantProperties: [{ property: "variant", values: ["default"] }]
      }),
      libraryResolution: {
        status: "resolved_import",
        componentKey: family,
        import: createResolvedImport()
      },
      storybookFamily: createStorybookFamily({
        propKeys: ["variant", "children"]
      })
    });

    assert.equal(result.resolvedApi.status, "resolved", `${family} should resolve`);
    assert.ok(result.resolvedApi.componentKey === family, `${family} componentKey should match`);
  }
});

test("resolveComponentApiContract merges argType options into allowed values", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "color", values: ["primary"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["color", "children"]
    }),
    storyEntry: createStoryEntry({
      args: { color: "primary" },
      argTypes: {
        color: { options: ["primary", "secondary", "error", "info"] }
      }
    })
  });

  const colorProp = result.resolvedApi.allowedProps.find((p) => p.name === "color");
  assert.ok(colorProp);
  assert.equal(colorProp.kind, "enum");
  assert.ok(colorProp.allowedValues);
  assert.ok(colorProp.allowedValues.includes("primary"));
  assert.ok(colorProp.allowedValues.includes("secondary"));
  assert.ok(colorProp.allowedValues.includes("error"));
  assert.ok(colorProp.allowedValues.includes("info"));
});

test("resolveComponentApiContract normalizes mixed-format argType enum options", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "color", values: ["Primary"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["color", "children"]
    }),
    storyEntry: createStoryEntry({
      args: { color: "Secondary Action" },
      argTypes: {
        color: { options: ["Primary", "Secondary Action", "accent_value"] }
      }
    })
  });

  const colorProp = result.resolvedApi.allowedProps.find((p) => p.name === "color");
  assert.ok(colorProp);
  assert.equal(colorProp.kind, "enum");
  assert.deepEqual(colorProp.allowedValues, ["accent-value", "primary", "secondary-action"]);
});

test("resolveComponentApiContract normalizes argType enum options consistently", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "color", values: ["Primary"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["color", "children"]
    }),
    storyEntry: createStoryEntry({
      args: { color: "SECONDARY" },
      argTypes: {
        color: { options: ["Primary", "secondary", "Error State", "error_state"] }
      }
    })
  });

  const colorProp = result.resolvedApi.allowedProps.find((p) => p.name === "color");
  assert.ok(colorProp);
  assert.equal(colorProp.kind, "enum");
  assert.deepEqual(colorProp.allowedValues, ["error-state", "primary", "secondary"]);
});

test("resolveComponentApiContract finds public component via componentsArtifact", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "variant", values: ["text"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      title: "Components/Button",
      name: "Button",
      componentPath: "./src/Button.tsx"
    }),
    componentsArtifact: createComponentsArtifact([
      {
        id: "pub-btn",
        name: "Button",
        title: "Components/Button",
        componentPath: "./src/Button.tsx",
        propKeys: ["variant", "size", "color", "disabled", "children"],
        storyCount: 3,
        hasDesignReference: true
      }
    ])
  });

  assert.equal(result.resolvedApi.status, "resolved");
  const allowedNames = result.resolvedApi.allowedProps.map((p) => p.name);
  assert.ok(allowedNames.includes("variant"));
  assert.ok(allowedNames.includes("size"));
  assert.ok(allowedNames.includes("color"));
  assert.ok(allowedNames.includes("disabled"));
});

test("resolveComponentApiContract produces deterministically sorted output", () => {
  const input = {
    figmaFamily: createFigmaFamily({
      variantProperties: [
        { property: "size", values: ["large", "small", "medium"] },
        { property: "variant", values: ["outlined", "contained"] },
        { property: "disabled", values: ["false", "true"] }
      ]
    }),
    libraryResolution: {
      status: "resolved_import" as const,
      componentKey: "Button",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant", "size", "disabled", "children"]
    })
  };

  const result1 = resolveComponentApiContract(input);
  const result2 = resolveComponentApiContract(input);

  assert.deepEqual(
    JSON.stringify(result1),
    JSON.stringify(result2),
    "Successive calls with the same input must produce byte-identical output"
  );

  const propNames = result1.resolvedApi.allowedProps.map((p) => p.name);
  const sortedPropNames = [...propNames].sort();
  assert.deepEqual(propNames, sortedPropNames, "allowedProps must be sorted by name");

  const resolvedPropNames = result1.resolvedProps.props.map((p) => p.sourceProp);
  const sortedResolvedPropNames = [...resolvedPropNames].sort();
  assert.deepEqual(resolvedPropNames, sortedResolvedPropNames, "resolvedProps.props must be sorted by sourceProp");
});

test("resolveComponentApiContract handles unknown component key with optional childrenMode", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "variant", values: ["default"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "CustomWidget",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["variant"]
    })
  });

  assert.equal(result.resolvedApi.status, "resolved");
  assert.equal(result.resolvedApi.children.policy, "unknown");
});

test("resolveComponentApiContract Icon family uses never childrenMode", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "fontSize", values: ["small", "large"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Icon",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["fontSize", "color"]
    })
  });

  assert.equal(result.resolvedApi.children.policy, "not_used");
});

test("resolveComponentApiContract Accordion family sets children always", () => {
  const result = resolveComponentApiContract({
    figmaFamily: createFigmaFamily({
      variantProperties: [{ property: "expanded", values: ["true", "false"] }]
    }),
    libraryResolution: {
      status: "resolved_import",
      componentKey: "Accordion",
      import: createResolvedImport()
    },
    storybookFamily: createStorybookFamily({
      propKeys: ["expanded", "children"]
    })
  });

  assert.equal(result.resolvedApi.children.policy, "supported");
  const expandedProp = result.resolvedApi.allowedProps.find((p) => p.name === "expanded");
  assert.ok(expandedProp);
  assert.equal(expandedProp.kind, "boolean");
});
