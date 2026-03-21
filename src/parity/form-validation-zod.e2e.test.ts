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
  assert.ok(contextContent.includes("const { control, handleSubmit, formState: { isSubmitting }, reset, setError } = useForm<TypedZodValidationFormFormData>({"));
  assert.ok(contextContent.includes("const onSubmit = async (values: TypedZodValidationFormFormData): Promise<void> => {"));
  assert.ok(contextContent.includes("resolver: zodResolver(formSchema),"));
  assert.ok(contextContent.includes('case "password"'));
  assert.ok(contextContent.includes("if (trimmed.length < 8) {"));
  assert.ok(contextContent.includes("Password must be at least 8 characters."));
  assert.equal(contextContent.includes("as unknown as UseFormReturn"), false);
});

// ---------------------------------------------------------------------------
// Cross-field validation E2E tests
// ---------------------------------------------------------------------------

const createCrossFieldValidationScreen = (): any => {
  return {
    id: "cross-field-validation-screen",
    name: "Cross Field Validation Form",
    layoutMode: "VERTICAL" as const,
    gap: 8,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      createSemanticInputNode({
        id: "cf-password",
        name: "Password Input",
        label: "Password *",
        placeholder: "Enter password"
      }),
      createSemanticInputNode({
        id: "cf-confirm-password",
        name: "Confirm Password Input",
        label: "Confirm Password *",
        placeholder: "Confirm your password"
      }),
      createSemanticInputNode({
        id: "cf-start-date",
        name: "Start Date Input",
        label: "Start Date",
        placeholder: "YYYY-MM-DD"
      }),
      createSemanticInputNode({
        id: "cf-end-date",
        name: "End Date Input",
        label: "End Date",
        placeholder: "YYYY-MM-DD"
      }),
      {
        id: "cf-submit",
        name: "Submit",
        nodeType: "FRAME",
        type: "button" as const,
        x: 0,
        y: 300,
        width: 220,
        height: 48,
        fillColor: "#d4001a",
        children: [
          {
            id: "cf-submit-label",
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

// ---------------------------------------------------------------------------
// Validation mode E2E tests
// ---------------------------------------------------------------------------

const createSemanticInputNodeWithError = ({
  id,
  name,
  label,
  placeholder,
  strokeColor
}: {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  strokeColor?: string;
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
    ...(strokeColor ? { strokeColor } : {}),
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

const createShortFormScreen = (): any => ({
  id: "short-form-screen",
  name: "Short Login Form",
  layoutMode: "VERTICAL" as const,
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children: [
    createSemanticInputNode({ id: "sf-email", name: "Email Input", label: "Email *" }),
    createSemanticInputNode({ id: "sf-password", name: "Password Input", label: "Password *" }),
    {
      id: "sf-submit", name: "Submit", nodeType: "FRAME", type: "button" as const,
      x: 0, y: 160, width: 220, height: 48, fillColor: "#1976d2",
      children: [{ id: "sf-submit-label", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Login", fillColor: "#ffffff" }]
    }
  ]
});

const createVisualErrorFormScreen = (): any => ({
  id: "visual-error-form-screen",
  name: "Visual Error Form",
  layoutMode: "VERTICAL" as const,
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children: [
    createSemanticInputNodeWithError({ id: "ve-email", name: "Email Input", label: "Email *", strokeColor: "#d32f2f" }),
    createSemanticInputNode({ id: "ve-password", name: "Password Input", label: "Password *" }),
    {
      id: "ve-submit", name: "Submit", nodeType: "FRAME", type: "button" as const,
      x: 0, y: 160, width: 220, height: 48, fillColor: "#1976d2",
      children: [{ id: "ve-submit-label", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Submit", fillColor: "#ffffff" }]
    }
  ]
});

const createLongFormScreen = (): any => ({
  id: "long-form-screen",
  name: "Long Registration Form",
  layoutMode: "VERTICAL" as const,
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children: [
    createSemanticInputNode({ id: "lf-first", name: "First Name Input", label: "First Name *" }),
    createSemanticInputNode({ id: "lf-last", name: "Last Name Input", label: "Last Name *" }),
    createSemanticInputNode({ id: "lf-email", name: "Email Input", label: "Email *" }),
    createSemanticInputNode({ id: "lf-phone", name: "Phone Input", label: "Phone" }),
    createSemanticInputNode({ id: "lf-address", name: "Address Input", label: "Address" }),
    createSemanticInputNode({ id: "lf-city", name: "City Input", label: "City" }),
    {
      id: "lf-submit", name: "Submit", nodeType: "FRAME", type: "button" as const,
      x: 0, y: 500, width: 220, height: 48, fillColor: "#1976d2",
      children: [{ id: "lf-submit-label", name: "Label", nodeType: "TEXT", type: "text" as const, text: "Register", fillColor: "#ffffff" }]
    }
  ]
});

test("E2E: validation mode — short form (2 fields) defaults to onSubmit (no mode: property)", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const injectedScreen = createShortFormScreen();
  const injectedIr = { ...ir, screens: [...ir.screens, injectedScreen] };

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-valmode-short-"));
  await generateArtifacts({
    projectDir, ir: injectedIr,
    llmCodegenMode: "deterministic", llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  const contextPath = path.join(projectDir, "src", "context", "ShortLoginFormFormContext.tsx");
  const contextContent = await readFile(contextPath, "utf8");

  assert.ok(contextContent.includes("useForm<ShortLoginFormFormData>({"), "Expected useForm call");
  assert.ok(contextContent.includes("resolver: zodResolver(formSchema)"), "Expected zodResolver");
  assert.equal(contextContent.includes('mode:'), false, "Short form should NOT have mode: property (defaults to onSubmit)");
});

test("E2E: validation mode — form with visual error outline emits mode: onTouched", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const injectedScreen = createVisualErrorFormScreen();
  const injectedIr = { ...ir, screens: [...ir.screens, injectedScreen] };

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-valmode-touched-"));
  await generateArtifacts({
    projectDir, ir: injectedIr,
    llmCodegenMode: "deterministic", llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  const contextPath = path.join(projectDir, "src", "context", "VisualErrorFormFormContext.tsx");
  const contextContent = await readFile(contextPath, "utf8");

  assert.ok(contextContent.includes("useForm<VisualErrorFormFormData>({"), "Expected useForm call");
  assert.ok(contextContent.includes('mode: "onTouched"'), "Expected mode: onTouched for form with visual errors");
});

test("E2E: validation mode — long form (6 fields) emits mode: onBlur", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const injectedScreen = createLongFormScreen();
  const injectedIr = { ...ir, screens: [...ir.screens, injectedScreen] };

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-valmode-blur-"));
  await generateArtifacts({
    projectDir, ir: injectedIr,
    llmCodegenMode: "deterministic", llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  const contextPath = path.join(projectDir, "src", "context", "LongRegistrationFormFormContext.tsx");
  const contextContent = await readFile(contextPath, "utf8");

  assert.ok(contextContent.includes("useForm<LongRegistrationFormFormData>({"), "Expected useForm call");
  assert.ok(contextContent.includes('mode: "onBlur"'), "Expected mode: onBlur for long form (6+ fields)");
});

test("E2E: cross-field validation — password match .refine() is emitted in generated context file", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const injectedScreen = createCrossFieldValidationScreen();
  const injectedIr = {
    ...ir,
    screens: [...ir.screens, injectedScreen]
  };

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-cross-field-"));
  await generateArtifacts({
    projectDir,
    ir: injectedIr,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => {
      // no-op
    }
  });

  const generatedContextPath = path.join(projectDir, "src", "context", "CrossFieldValidationFormFormContext.tsx");
  const contextContent = await readFile(generatedContextPath, "utf8");

  // --- password match cross-field rule ---
  assert.ok(
    contextContent.includes(".refine("),
    "Expected .refine() chain on formSchema for cross-field validation"
  );
  assert.ok(
    contextContent.includes("Must match Password."),
    "Expected password match validation message"
  );
  assert.ok(
    contextContent.includes('case "password"'),
    "Expected per-field password validation case to still exist"
  );

  // --- date_after cross-field rule ---
  assert.ok(
    contextContent.includes("Must be after Start Date."),
    "Expected date_after validation message"
  );
  assert.ok(
    contextContent.includes("end > start"),
    "Expected date comparison logic in .refine()"
  );

  // --- structural integrity ---
  assert.ok(
    contextContent.includes("z.object("),
    "Expected z.object() schema"
  );
  assert.ok(
    contextContent.includes("zodResolver(formSchema)"),
    "Expected zodResolver integration"
  );
  assert.ok(
    contextContent.includes("type CrossFieldValidationFormFormData = z.infer<typeof formSchema>;"),
    "Expected z.infer type alias"
  );
});

// ---------------------------------------------------------------------------
// Form submission lifecycle E2E tests
// ---------------------------------------------------------------------------

const createSubmissionLifecycleScreen = (): any => ({
  id: "submission-lifecycle-screen",
  name: "Submission Lifecycle Form",
  layoutMode: "VERTICAL" as const,
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children: [
    createSemanticInputNode({
      id: "sl-email",
      name: "Email Input",
      label: "Email *",
      placeholder: "name@example.com"
    }),
    createSemanticInputNode({
      id: "sl-name",
      name: "Name Input",
      label: "Full Name *"
    }),
    {
      id: "sl-submit",
      name: "Submit",
      nodeType: "FRAME",
      type: "button" as const,
      x: 0,
      y: 180,
      width: 220,
      height: 48,
      fillColor: "#1976d2",
      children: [
        {
          id: "sl-submit-label",
          name: "Label",
          nodeType: "TEXT",
          type: "text" as const,
          text: "Submit",
          fillColor: "#ffffff"
        }
      ]
    }
  ]
});

test("E2E: submission lifecycle — useForm destructures formState, reset, setError; onSubmit is async", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const injectedScreen = createSubmissionLifecycleScreen();
  const injectedIr = { ...ir, screens: [...ir.screens, injectedScreen] };

  const projectDir = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-e2e-submission-lifecycle-"));
  await generateArtifacts({
    projectDir,
    ir: injectedIr,
    llmCodegenMode: "deterministic",
    llmModelName: "deterministic",
    onLog: () => { /* no-op */ }
  });

  const contextPath = path.join(projectDir, "src", "context", "SubmissionLifecycleFormFormContext.tsx");
  const contextContent = await readFile(contextPath, "utf8");

  // --- expanded useForm destructuring ---
  assert.ok(
    contextContent.includes("formState: { isSubmitting }"),
    "Expected formState: { isSubmitting } in useForm destructuring"
  );
  assert.ok(
    contextContent.includes("reset,"),
    "Expected reset in useForm destructuring"
  );
  assert.ok(
    contextContent.includes("setError }"),
    "Expected setError in useForm destructuring"
  );

  // --- async onSubmit ---
  assert.ok(
    contextContent.includes("const onSubmit = async (values: SubmissionLifecycleFormFormData): Promise<void> => {"),
    "Expected async onSubmit with Promise<void> return type"
  );
  assert.ok(
    contextContent.includes("// TODO: Replace with actual API call."),
    "Expected TODO comment in onSubmit"
  );
  assert.ok(
    contextContent.includes('setError("fieldKey"'),
    "Expected setError example comment"
  );

  // --- context interface includes new properties ---
  assert.ok(
    contextContent.includes("isSubmitting: boolean;"),
    "Expected isSubmitting in context interface"
  );
  assert.ok(
    contextContent.includes('reset: UseFormReturn<SubmissionLifecycleFormFormData>["reset"];'),
    "Expected reset in context interface"
  );
  assert.ok(
    contextContent.includes('setError: UseFormReturn<SubmissionLifecycleFormFormData>["setError"];'),
    "Expected setError in context interface"
  );

  // --- provider exposes new values ---
  assert.ok(
    contextContent.includes("isSubmitting,"),
    "Expected isSubmitting in provider value"
  );
  assert.ok(
    contextContent.includes("reset,"),
    "Expected reset in provider value"
  );
  assert.ok(
    contextContent.includes("setError"),
    "Expected setError in provider value"
  );

  // --- submit button disabled binding in screen ---
  const screenPath = path.join(projectDir, toDeterministicScreenPath(injectedScreen.name));
  const screenContent = await readFile(screenPath, "utf8");

  assert.ok(
    screenContent.includes("disabled={isSubmitting"),
    "Expected disabled={isSubmitting} on submit button"
  );
  assert.ok(
    screenContent.includes("isSubmitting"),
    "Expected isSubmitting destructured from context hook"
  );
});
