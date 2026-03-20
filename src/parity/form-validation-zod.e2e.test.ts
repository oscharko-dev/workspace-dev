import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import { generateArtifacts, toDeterministicScreenPath } from "./generator-core.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping Zod form validation E2E tests"
    : undefined;

let cachedFigmaFile: unknown;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  if (cachedFigmaFile) {
    return cachedFigmaFile;
  }
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}?geometry=paths`, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN
    }
  });
  assert.equal(response.ok, true, `Figma API responded with status ${response.status}`);
  cachedFigmaFile = await response.json();
  return cachedFigmaFile;
};

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
}): any => {
  return {
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
  };
};

const createTypedZodValidationScreen = (): any => {
  return {
    id: "typed-zod-validation-screen",
    name: "Typed Zod Validation Form",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({
        id: "typed-zod-email",
        name: "Email Input",
        label: "Email *",
        placeholder: "name@example.com"
      }),
      createSemanticInputNode({
        id: "typed-zod-password",
        name: "Password Input",
        label: "Password",
        placeholder: "Enter password"
      }),
      {
        id: "typed-zod-submit",
        name: "Submit",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 180,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "typed-zod-submit-label",
            name: "Label",
            nodeType: "TEXT",
            type: "text" as const,
            text: "Submit",
            fillColor: "#ffffff"
          }
        ]
      }
    ]
  };
};

test("E2E: generated RHF form context uses z.infer typing and password min-length schema validation", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);
  assert.ok(ir.screens.length > 0, "Expected at least one screen from the live Figma board");

  const injectedScreen = createTypedZodValidationScreen();
  const injectedIr = {
    ...ir,
    screens: [...ir.screens, injectedScreen]
  };

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-zod-forms-"));
  await generateArtifacts({
    projectDir,
    ir: injectedIr,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const generatedScreenPath = path.join(projectDir, toDeterministicScreenPath(injectedScreen.name));
  const generatedContextPath = path.join(projectDir, "src", "context", "TypedZodValidationFormFormContext.tsx");
  const screenContent = await readFile(generatedScreenPath, "utf8");
  const contextContent = await readFile(generatedContextPath, "utf8");

  assert.ok(screenContent.includes('component="form" onSubmit={handleSubmit(onSubmit)} noValidate'));
  assert.ok(screenContent.includes("<Controller"));

  assert.ok(contextContent.includes("type TypedZodValidationFormFormData = z.infer<typeof formSchema>;"));
  assert.ok(contextContent.includes("const { control, handleSubmit } = useForm<TypedZodValidationFormFormData>({"));
  assert.ok(contextContent.includes("const onSubmit = (values: TypedZodValidationFormFormData): void => {"));
  assert.ok(contextContent.includes("resolver: zodResolver(formSchema),"));
  assert.ok(contextContent.includes('case "password"'));
  assert.ok(contextContent.includes("if (trimmed.length < 8) {"));
  assert.ok(contextContent.includes("Password must be at least 8 characters."));
  assert.equal(contextContent.includes("as unknown as UseFormReturn"), false);
});
