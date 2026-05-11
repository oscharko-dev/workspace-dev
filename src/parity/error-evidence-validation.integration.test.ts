import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateArtifacts } from "./generator-core.js";
import { buildTypographyScaleFromAliases } from "./typography-tokens.js";

const createIr = () => ({
  version: 2,
  generatedAt: "2026-01-01T00:00:00.000Z",
  figmaFileKey: "test-file",
  sourceName: "issue-788-regression-fixture",
  generationLocale: "en",
  tokens: {
    palette: {
      primary: "#ee0000",
      secondary: "#222222",
      background: "#ffffff",
      surface: "#f7f7f7",
      text: "#222222",
      success: "#16a34a",
      warning: "#d97706",
      error: "#dc2626",
      info: "#0288d1",
      divider: "#2222221f",
      action: {
        active: "#2222228a",
        hover: "#ee00000a",
        selected: "#ee000014",
        disabled: "#22222242",
        disabledBackground: "#2222221f",
        focus: "#ee00001f"
      }
    },
    borderRadius: 12,
    spacingBase: 8,
    fontFamily: "Sparkasse Sans",
    headingSize: 28,
    bodySize: 16,
    typography: buildTypographyScaleFromAliases({
      fontFamily: "Sparkasse Sans",
      headingSize: 28,
      bodySize: 16
    })
  },
  screens: [],
  assets: {},
  warnings: [],
  customerProfile: undefined
});

const createSemanticInputNode = ({
  id,
  name,
  label,
  placeholder
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
}): any => ({
  id,
  name,
  nodeType: "FRAME",
  type: "input" as const,
  layoutMode: "VERTICAL" as const,
  gap: 4,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  width: 320,
  height: 72,
  children: [
    {
      id: `${id}-label`,
      name: "Label",
      nodeType: "TEXT",
      type: "text" as const,
      text: label,
      y: 0
    },
    ...(placeholder
      ? [
          {
            id: `${id}-placeholder`,
            name: "Placeholder",
            nodeType: "TEXT",
            type: "text" as const,
            text: placeholder,
            textRole: "placeholder" as const,
            y: 24
          }
        ]
      : [])
  ]
});

const createSubmitButton = (id: string): any => ({
  id,
  name: "Submit",
  nodeType: "FRAME",
  type: "button" as const,
  width: 220,
  height: 48,
  fillColor: "#d4001a",
  children: [
    {
      id: `${id}-label`,
      name: "Label",
      nodeType: "TEXT",
      type: "text" as const,
      text: "Continue",
      fillColor: "#ffffff"
    }
  ]
});

const cloneScreen = ({ screen, id }: { screen: any; id: string }): any => ({
  ...screen,
  id
});

const assertMarkersInOrder = ({ content, markers }: { content: string; markers: string[] }): void => {
  let previousIndex = -1;
  for (const marker of markers) {
    const index = content.indexOf(marker);
    assert.ok(index >= 0, `Expected marker '${marker}' to be present.`);
    assert.ok(index > previousIndex, `Expected marker '${marker}' after previous markers.`);
    previousIndex = index;
  }
};

const readOnlyGeneratedContext = async ({
  ir,
  formHandlingMode
}: {
  ir: any;
  formHandlingMode?: "legacy_use_state";
}): Promise<string> => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-issue-788-"));
  const result = await generateArtifacts({
    projectDir,
    ir,
    ...(formHandlingMode ? { formHandlingMode } : {}),
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {}
  });
  const contextPath = result.generatedPaths.find((generatedPath) => generatedPath.startsWith("src/context/"));
  assert.ok(contextPath, `Expected one generated context file, found: ${JSON.stringify(result.generatedPaths, null, 2)}`);
  return await readFile(path.join(projectDir, contextPath ?? ""), "utf8");
};

test("generateArtifacts unions required and typed evidence into RHF form contexts", async () => {
  const ir = createIr();
  const defaultScreen = {
    id: "evidence-default",
    name: "Evidence Form",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({
        id: "email-field",
        name: "Email Field",
        label: "Email",
        placeholder: "name@example.com"
      }),
      createSubmitButton("evidence-submit")
    ]
  };
  ir.screens = [
    defaultScreen,
    cloneScreen({ screen: defaultScreen, id: "evidence-required" }),
    cloneScreen({ screen: defaultScreen, id: "evidence-invalid-email" })
  ];
  ir.screenVariantFamilies = [
    {
      familyId: "evidence-family",
      canonicalScreenId: "evidence-default",
      memberScreenIds: ["evidence-default", "evidence-required", "evidence-invalid-email"],
      axes: ["validation-state"],
      scenarios: [
        {
          screenId: "evidence-default",
          contentScreenId: "evidence-default",
          initialState: { validationState: "default" }
        },
        {
          screenId: "evidence-required",
          contentScreenId: "evidence-default",
          initialState: { validationState: "error" },
          fieldErrorEvidenceByFieldKey: {
            email_field_email_field: {
              message: "Email is required",
              visualError: true
            }
          }
        },
        {
          screenId: "evidence-invalid-email",
          contentScreenId: "evidence-default",
          initialState: { validationState: "error" },
          fieldErrorEvidenceByFieldKey: {
            email_field_email_field: {
              message: "Invalid email address",
              visualError: true
            }
          }
        }
      ]
    }
  ];

  const contextContent = await readOnlyGeneratedContext({ ir });
  assert.ok(contextContent.includes('"required": true'));
  assert.ok(contextContent.includes('"validationType": "email"'));
  assert.ok(contextContent.includes('"message": "Email is required"'));
  assert.equal(contextContent.includes('^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$'), false);
  assertMarkersInOrder({
    content: contextContent,
    markers: [
      "const rules = spec.validationRules ?? [];",
      "const requiredRule = rules.find(",
      "if (trimmed.length === 0) {",
      "if (requiredRule) {",
      "if (spec.required) {"
    ]
  });
});

test("generateArtifacts keeps date evidence on the semantic date path", async () => {
  const ir = createIr();
  const defaultScreen = {
    id: "date-default",
    name: "Date Evidence Form",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({
        id: "date-field",
        name: "Date Field",
        label: "Date",
        placeholder: "YYYY-MM-DD"
      }),
      createSubmitButton("date-submit")
    ]
  };
  ir.screens = [
    defaultScreen,
    cloneScreen({ screen: defaultScreen, id: "date-error" })
  ];
  ir.screenVariantFamilies = [
    {
      familyId: "date-evidence-family",
      canonicalScreenId: "date-default",
      memberScreenIds: ["date-default", "date-error"],
      axes: ["validation-state"],
      scenarios: [
        {
          screenId: "date-default",
          contentScreenId: "date-default",
          initialState: { validationState: "default" }
        },
        {
          screenId: "date-error",
          contentScreenId: "date-default",
          initialState: { validationState: "error" },
          fieldErrorEvidenceByFieldKey: {
            date_field_date_field: {
              message: "Ungültiges Datum",
              visualError: true
            }
          }
        }
      ]
    }
  ];

  const contextContent = await readOnlyGeneratedContext({ ir });
  assert.ok(contextContent.includes('"validationType": "date"'));
  assert.equal(contextContent.includes("^\\\\d{2}\\\\.\\\\d{2}\\\\.\\\\d{4}$"), false);
});

test("generateArtifacts enforces evidence-derived required rules in legacy form contexts", async () => {
  const ir = createIr();
  const defaultScreen = {
    id: "legacy-default",
    name: "Legacy Evidence Form",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({
        id: "email-field",
        name: "Email Field",
        label: "Email",
        placeholder: "name@example.com"
      }),
      createSubmitButton("legacy-submit")
    ]
  };
  ir.screens = [
    defaultScreen,
    cloneScreen({ screen: defaultScreen, id: "legacy-error" })
  ];
  ir.screenVariantFamilies = [
    {
      familyId: "legacy-evidence-family",
      canonicalScreenId: "legacy-default",
      memberScreenIds: ["legacy-default", "legacy-error"],
      axes: ["validation-state"],
      scenarios: [
        {
          screenId: "legacy-default",
          contentScreenId: "legacy-default",
          initialState: { validationState: "default" }
        },
        {
          screenId: "legacy-error",
          contentScreenId: "legacy-default",
          initialState: { validationState: "error" },
          fieldErrorEvidenceByFieldKey: {
            email_field_email_field: {
              message: "Email is required",
              visualError: true
            }
          }
        }
      ]
    }
  ];

  const contextContent = await readOnlyGeneratedContext({
    ir,
    formHandlingMode: "legacy_use_state"
  });
  assert.ok(contextContent.includes("const fieldValidationRules: Record<string, Array<{ type: string; value: number | string; message: string }>> = {"));
  assert.ok(contextContent.includes('"message": "Email is required"'));
  assertMarkersInOrder({
    content: contextContent,
    markers: [
      "const rules = fieldValidationRules[fieldKey];",
      "const requiredRule = rules?.find(",
      "if (trimmed.length === 0) {",
      "if (requiredRule) {",
      "if (requiredFields[fieldKey]) {"
    ]
  });
});
