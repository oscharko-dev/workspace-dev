#!/usr/bin/env node
/**
 * Fix import/export issues after decomposition.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve("src/parity");

function readFile(name) {
  return readFileSync(path.join(SRC, name), "utf-8");
}

function writeFile(name, content) {
  writeFileSync(path.join(SRC, name), content);
  console.log(`  ✓ ${name}`);
}

// ═══════════════════════════════════════════════════════════════════
// Fix generator-render.ts
// ═══════════════════════════════════════════════════════════════════
console.log("Fixing generator-render.ts...");
let render = readFile("generator-render.ts");

// Fix imports: remove unused, add missing
render = render.replace(
  `import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";`,
  `import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";`
);

// Remove unused imports
render = render.replace(`import { ensureTsxName } from "./path-utils.js";\n`, '');
render = render.replace(`import type { ScreenArtifactIdentity } from "./generator-artifacts.js";\n`, '');
render = render.replace(
  `import { buildScreenArtifactIdentities, toComponentName } from "./generator-artifacts.js";`,
  `import { buildScreenArtifactIdentities } from "./generator-artifacts.js";`
);

render = render.replace(
  `export type { ScreenArtifactIdentity } from "./generator-artifacts.js";`,
  ''
);

// Add missing imports from generator-templates
render = render.replace(
  `  collectRenderedItems\n} from "./generator-templates.js";`,
  `  normalizeFontFamily,
  toLetterSpacingEm
} from "./generator-templates.js";`
);

// Remove unused template imports
render = render.replace(/  renderElement,\n/g, '');
render = render.replace(/  renderFallbackIconExpression,\n/g, '');
render = render.replace(/  indentBlock,\n/g, '');
render = render.replace(/  normalizeHexColor,\n/g, '');
render = render.replace(/  toRgbaColor,\n/g, '');

// Remove unused imports from contracts
render = render.replace(
  `import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";\n`,
  `import type { WorkspaceFormHandlingMode } from "../contracts/index.js";\n`
);

// Remove unused a11y import
render = render.replace(
  `import {
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  inferHeadingComponentByNodeId
} from "./generator-a11y.js";`,
  `import {
  resolveElementA11yLabel,
  inferHeadingComponentByNodeId
} from "./generator-a11y.js";`
);

// Remove unused AccessibilityWarning import
render = render.replace(`import type { AccessibilityWarning } from "./generator-a11y.js";\n`, '');

// Make private functions/types that are needed by other modules public
// hasSubtreeName
render = render.replace(/\nconst hasSubtreeName = /g, '\nexport const hasSubtreeName = ');
// collectSubtreeNames
render = render.replace(/\nconst collectSubtreeNames = /g, '\nexport const collectSubtreeNames = ');
// collectIconNodes
render = render.replace(/\nconst collectIconNodes = /g, '\nexport const collectIconNodes = ');
// toDeterministicImagePlaceholderSrc
render = render.replace(/\nconst toDeterministicImagePlaceholderSrc = /g, '\nexport const toDeterministicImagePlaceholderSrc = ');
// isPlainRecord
render = render.replace(/\nconst isPlainRecord = /g, '\nexport const isPlainRecord = ');
// clusterAxisValues
render = render.replace(/\nconst clusterAxisValues = /g, '\nexport const clusterAxisValues = ');
// toNearestClusterIndex
render = render.replace(/\nconst toNearestClusterIndex = /g, '\nexport const toNearestClusterIndex = ');
// toSequentialDeltas
render = render.replace(/\nconst toSequentialDeltas = /g, '\nexport const toSequentialDeltas = ');

// Make interface types that need export actually exported
render = render.replace(/\ninterface IconImportSpec/g, '\nexport interface IconImportSpec');
render = render.replace(/\ninterface IconFallbackMapEntry/g, '\nexport interface IconFallbackMapEntry');
render = render.replace(/\ninterface IconFallbackMap/g, '\nexport interface IconFallbackMap');
render = render.replace(/\ninterface CompiledIconFallbackEntry/g, '\nexport interface CompiledIconFallbackEntry');
render = render.replace(/\ninterface MappedImportSpec/g, '\nexport interface MappedImportSpec');
render = render.replace(/\ninterface ExtractedComponentImportSpec/g, '\nexport interface ExtractedComponentImportSpec');

// Fix: RenderContext references types from other modules
// Need to import InteractiveFieldModel, InteractiveAccordionModel, InteractiveTabsModel, InteractiveDialogModel, PatternExtractionInvocation
render = render.replace(
  `import type { ThemeComponentDefaults, ThemeSxSampleCollector } from "./generator-design-system.js";`,
  `import type { ThemeComponentDefaults, ThemeSxSampleCollector } from "./generator-design-system.js";
import type { InteractiveFieldModel, ValidationFieldType } from "./generator-forms.js";
import type { InteractiveAccordionModel, InteractiveTabsModel, InteractiveDialogModel } from "./generator-interactive.js";
import type { PatternExtractionInvocation } from "./generator-patterns.js";`
);

// Export type aliases that are used by other modules
// ResolvedFormHandlingMode
render = render.replace(
  `export type ResolvedFormHandlingMode = WorkspaceFormHandlingMode;`,
  `export type ResolvedFormHandlingMode = WorkspaceFormHandlingMode;\nexport type { ValidationFieldType } from "./generator-forms.js";`
);

// Remove accumulateSimplificationStats (it's duplicated in orchestrator)
render = render.replace(
  /\nconst accumulateSimplificationStats[\s\S]*?^};/m,
  ''
);

// Remove dedupeMappingWarnings (duplicated)
render = render.replace(
  /\nconst dedupeMappingWarnings[\s\S]*?^};/m,
  ''
);

// Fix: toStateKey needs export - it's extracted but used by other modules
// Search for "export const toStateKey" - it should already be exported
// The issue is toStateKey might be in a section that includes ensureTabsStateModel which was removed
// Let me check if toStateKey is present
if (!render.includes('export const toStateKey')) {
  // toStateKey was in lines 2652-2657, which may have been included in the wrong range
  // Let's check if it exists
  if (render.includes('const toStateKey')) {
    render = render.replace('const toStateKey', 'export const toStateKey');
  }
}

// normalizeInputSemanticText is in generator-forms.ts, remove the re-export placeholder
// and instead directly import in files that need it
// Actually keep the re-export since generator-a11y.ts imports from generator-core which re-exports from render

// Fix: remove the call to normalizeInputSemanticText - it's in forms, but sorting needs it
// The function is simple, let's import it properly
render = render.replace(
  `// Re-export normalizeInputSemanticText since generator-a11y.ts imports it from generator-core.ts
// It was moved to generator-forms.ts but we re-export here for backward compat
export { normalizeInputSemanticText } from "./generator-forms.js";`,
  `export { normalizeInputSemanticText } from "./generator-forms.js";`
);

// Add normalizeInputSemanticText import from forms for internal use
render = render.replace(
  `import type { InteractiveFieldModel, ValidationFieldType } from "./generator-forms.js";`,
  `import { normalizeInputSemanticText } from "./generator-forms.js";
import type { InteractiveFieldModel, ValidationFieldType } from "./generator-forms.js";`
);

writeFile("generator-render.ts", render);

// ═══════════════════════════════════════════════════════════════════
// Fix generator-forms.ts
// ═══════════════════════════════════════════════════════════════════
console.log("Fixing generator-forms.ts...");
let forms = readFile("generator-forms.ts");

// Fix imports
forms = forms.replace(
  `import {
  firstText,
  firstTextColor,
  firstVectorColor,
  normalizeHexColor,
  toRgbaColor,
  isLikelyErrorRedColor,
  normalizeFontFamily,
  collectTextNodes,
  collectVectorPaths
} from "./generator-templates.js";`,
  `import {
  firstTextColor,
  firstVectorColor,
  toRgbaColor,
  isLikelyErrorRedColor,
  normalizeFontFamily,
  collectTextNodes,
  collectVectorPaths
} from "./generator-templates.js";`
);

forms = forms.replace(
  `import {
  hasSubtreeName,
  collectSubtreeNames,
  collectIconNodes,
  toStateKey,
  findFirstByName
} from "./generator-render.js";`,
  `import {
  hasSubtreeName,
  collectSubtreeNames,
  collectIconNodes,
  toStateKey,
  findFirstByName
} from "./generator-render.js";`
);

// Remove unused VirtualParent import
forms = forms.replace(
  `import type {
  RenderContext,
  VirtualParent,
  SemanticIconModel
} from "./generator-render.js";`,
  `import type {
  RenderContext,
  SemanticIconModel
} from "./generator-render.js";`
);

// ValidationFieldType is defined locally - it was extracted from generator-core.ts line 194
// But it was in the render section. Let's check where it ended up.
// Actually, it's not in the forms file because the extraction script extracted lines 2229-2260,
// but ValidationFieldType is at line 194. The extraction was off.
// Add it at the top of the types section
const validationTypeBlock = `export type ValidationFieldType =
  | "email"
  | "password"
  | "tel"
  | "number"
  | "date"
  | "url"
  | "search"
  | "iban"
  | "plz"
  | "credit_card";
export type ResolvedFormHandlingMode = import("../contracts/index.js").WorkspaceFormHandlingMode;

export interface FormContextFileSpec {
  file: import("./types.js").GeneratedFile;
  providerName: string;
  hookName: string;
  importPath: string;
}

`;

// Find the first type/interface in forms and prepend
forms = forms.replace(
  /^(type TextFieldInputType)/m,
  `${validationTypeBlock}$1`
);

// Fix InteractiveAccordionModel - it's in generator-interactive.ts, import it
forms = forms.replace(
  `import type {
  RenderContext,
  SemanticIconModel
} from "./generator-render.js";`,
  `import type {
  RenderContext,
  SemanticIconModel
} from "./generator-render.js";
import type { InteractiveAccordionModel } from "./generator-interactive.js";`
);

// Remove ACCORDION_NAME_HINTS since it was in the wrong module (it's in interactive)
forms = forms.replace(/\nconst ACCORDION_NAME_HINTS[\s\S]*?;/m, '');
// hasAnySubtreeName is used in isLikelyInputContainer, keep it but also used for ACCORDION
// Actually hasAnySubtreeName is used locally in forms too (isLikelyInputContainer uses it)
// So keep it in forms

// registerInteractiveAccordion is in forms but should be in interactive
// Move it - but it was already extracted to interactive. Let me check if it's duplicated.
// The script extracted lines 3959-3980 to interactive AND forms extracted 3819-3879 which includes
// registerInteractiveField. registerInteractiveAccordion was extracted to both.
// Remove it from forms.
if (forms.includes('export const registerInteractiveAccordion')) {
  const accMatch = forms.indexOf('export const registerInteractiveAccordion');
  const accEnd = forms.indexOf('};', accMatch);
  if (accEnd > accMatch) {
    // Remove registerInteractiveAccordion from forms
    forms = forms.substring(0, accMatch) + forms.substring(accEnd + 3);
  }
}

writeFile("generator-forms.ts", forms);

// ═══════════════════════════════════════════════════════════════════
// Fix generator-interactive.ts
// ═══════════════════════════════════════════════════════════════════
console.log("Fixing generator-interactive.ts...");
let interactive = readFile("generator-interactive.ts");

// Fix imports
interactive = interactive.replace(
  `import {
  firstText,
  normalizeHexColor,
  collectTextNodes,
  toRgbaColor
} from "./generator-templates.js";`,
  `import {
  firstText,
  firstTextColor,
  normalizeHexColor,
  collectTextNodes,
  toRgbaColor,
  literal,
  renderFallbackIconExpression,
  collectRenderedItems
} from "./generator-templates.js";`
);

interactive = interactive.replace(
  `import {
  hasSubtreeName,
  hasVisualStyle,
  isIconLikeNode,
  toStateKey,
  findFirstByName,
  approximatelyEqualNumber,
  sortChildren,
  collectSubtreeNames,
  clusterAxisValues,
  toNearestClusterIndex,
  resolveIconColor,
  hasMeaningfulTextDescendants
} from "./generator-render.js";`,
  `import {
  hasSubtreeName,
  hasVisualStyle,
  isIconLikeNode,
  isSemanticIconWrapper,
  pickBestIconNode,
  findFirstByName,
  approximatelyEqualNumber,
  sortChildren,
  collectSubtreeNames,
  collectIconNodes,
  toSequentialDeltas,
  registerMuiImports,
  resolveIconColor,
  hasMeaningfulTextDescendants,
  toStateKey
} from "./generator-render.js";`
);

interactive = interactive.replace(
  `import type {
  RenderContext,
  VirtualParent,
  SemanticIconModel
} from "./generator-render.js";`,
  `import type {
  RenderContext,
  VirtualParent
} from "./generator-render.js";`
);

interactive = interactive.replace(
  `import {
  resolveElementA11yLabel,
  hasInteractiveDescendants
} from "./generator-a11y.js";`,
  `import {
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  A11Y_NAVIGATION_HINTS
} from "./generator-a11y.js";`
);

// Add missing import for resolvePrototypeNavigationBinding from navigation
interactive = interactive.replace(
  `import type { DetectedTabInterfacePattern, DetectedDialogOverlayPattern, DialogActionModel, RenderedItem } from "./generator-templates.js";`,
  `import type { DetectedTabInterfacePattern, DetectedDialogOverlayPattern, DialogActionModel, RenderedItem } from "./generator-templates.js";
import { resolvePrototypeNavigationBinding, toRouterLinkProps } from "./generator-navigation.js";`
);

// Remove unused imports
interactive = interactive.replace(
  `import { normalizeInputSemanticText } from "./generator-forms.js";\n`,
  ``
);

// hasAnySubtreeName and ACCORDION_NAME_HINTS need to be available
// hasAnySubtreeName is used in isLikelyAccordionContainer. Let me check the original:
// Line 3145: isLikelyAccordionContainer calls hasAnySubtreeName and ACCORDION_NAME_HINTS
// hasAnySubtreeName was at line 2947, ACCORDION_NAME_HINTS at line 2945
// They were extracted to forms... but accordion is interactive.
// Add them here:
interactive = interactive.replace(
  `export const isLikelyAccordionContainer`,
  `const ACCORDION_NAME_HINTS = ["accordion", "accordionsummarycontent", "collapsewrapper"];

const hasAnySubtreeName = (element: ScreenElementIR, patterns: string[]): boolean => {
  return patterns.some((pattern) => hasSubtreeName(element, pattern));
};

export const isLikelyAccordionContainer`
);

// Fix: toStateKey is both in render and interactive (duplicate declaration)
// Remove the one in interactive, import it from render
// The interactive file has ensureTabsStateModel etc which call toStateKey
// but toStateKey was already extracted to render
// Check if interactive has its own export const toStateKey
if (interactive.match(/^export const toStateKey/m)) {
  // Remove the duplicate toStateKey definition from interactive
  const tsIdx = interactive.indexOf('export const toStateKey');
  const tsEnd = interactive.indexOf('};', tsIdx);
  if (tsEnd > tsIdx) {
    interactive = interactive.substring(0, tsIdx) + interactive.substring(tsEnd + 3);
  }
}

writeFile("generator-interactive.ts", interactive);

// ═══════════════════════════════════════════════════════════════════
// Fix generator-navigation.ts
// ═══════════════════════════════════════════════════════════════════
console.log("Fixing generator-navigation.ts...");
let navigation = readFile("generator-navigation.ts");

navigation = navigation.replace(
  `import type { ScreenElementIR } from "./types.js";
import type { RenderContext } from "./generator-render.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";`,
  `import type { ScreenElementIR } from "./types.js";
import type { RenderContext } from "./generator-render.js";
import { literal } from "./generator-templates.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";`
);

// Remove unused import
navigation = navigation.replace(
  `import { buildScreenArtifactIdentities } from "./generator-artifacts.js";`,
  ``
);

writeFile("generator-navigation.ts", navigation);

// ═══════════════════════════════════════════════════════════════════
// Fix generator-patterns.ts
// ═══════════════════════════════════════════════════════════════════
console.log("Fixing generator-patterns.ts...");
let patterns = readFile("generator-patterns.ts");

// Fix imports
patterns = patterns.replace(
  `import {
  literal,
  indentBlock,
  renderElement,
  collectRenderedItems
} from "./generator-templates.js";`,
  `import {
  literal,
  indentBlock,
  renderElement
} from "./generator-templates.js";`
);

patterns = patterns.replace(
  `import {
  sortChildren,
  resolveElementA11yLabel,
  resolveTypographyVariantByNodeId,
  normalizeIconImports,
  registerIconImport,
  toDeterministicImagePlaceholderSrc,
  isPlainRecord
} from "./generator-render.js";`,
  `import {
  sortChildren,
  resolveTypographyVariantByNodeId,
  normalizeIconImports,
  toDeterministicImagePlaceholderSrc
} from "./generator-render.js";`
);

patterns = patterns.replace(
  `import {
  inferHeadingComponentByNodeId
} from "./generator-a11y.js";`,
  `import {
  inferHeadingComponentByNodeId,
  resolveElementA11yLabel
} from "./generator-a11y.js";`
);

patterns = patterns.replace(
  `import type {
  VirtualParent,
  RenderContext,
  IconFallbackResolver,
  PatternExtractionInvocation,
  ExtractedComponentImportSpec,
  MappedImportSpec,
  IconImportSpec
} from "./generator-render.js";`,
  `import type {
  VirtualParent,
  RenderContext,
  IconFallbackResolver
} from "./generator-render.js";`
);

// SX_ATTRIBUTE_PREFIX and findSxBodyEndIndex are in generator-sx.ts
patterns = patterns.replace(
  `import { extractSharedSxConstantsFromScreenContent } from "./generator-sx.js";`,
  `import { extractSharedSxConstantsFromScreenContent, SX_ATTRIBUTE_PREFIX, findSxBodyEndIndex } from "./generator-sx.js";`
);

writeFile("generator-patterns.ts", patterns);

// ═══════════════════════════════════════════════════════════════════
// Fix generator-sx.ts - export SX_ATTRIBUTE_PREFIX and findSxBodyEndIndex
// ═══════════════════════════════════════════════════════════════════
console.log("Fixing generator-sx.ts...");
let sx = readFile("generator-sx.ts");

sx = sx.replace('const SHARED_SX_MIN_OCCURRENCES', 'export const SHARED_SX_MIN_OCCURRENCES');
sx = sx.replace('const SHARED_SX_IDENTIFIER_PREFIX', 'export const SHARED_SX_IDENTIFIER_PREFIX');
sx = sx.replace('const SX_ATTRIBUTE_PREFIX', 'export const SX_ATTRIBUTE_PREFIX');
sx = sx.replace('\nconst findSxBodyEndIndex', '\nexport const findSxBodyEndIndex');

writeFile("generator-sx.ts", sx);

// ═══════════════════════════════════════════════════════════════════
// Fix generator-core.ts (orchestrator)
// ═══════════════════════════════════════════════════════════════════
console.log("Fixing generator-core.ts...");
let core = readFile("generator-core.ts");

// Remove unused imports
core = core.replace(`import { readFile, mkdir, writeFile } from "node:fs/promises";\n`, `import { mkdir, writeFile } from "node:fs/promises";\n`);
core = core.replace(/,\n  DesignTokens,\n  DesignTokenTypographyVariantName,/g, ',');
core = core.replace(/,\n  ScreenElementIR,\n  ScreenIR\n/g, '\n');
core = core.replace(
  `import {
  buildScreenArtifactIdentities,
  toComponentName,
  toDeterministicScreenPath
} from "./generator-artifacts.js";`,
  `import { buildScreenArtifactIdentities } from "./generator-artifacts.js";`
);
core = core.replace(`import type { ThemeComponentDefaults, ThemeSxSampleCollector } from "./generator-design-system.js";\n`, `import type { ThemeComponentDefaults } from "./generator-design-system.js";\n`);

// Remove duplicate getErrorMessage (the one from extractLines)
// Find the duplicate that starts with "const getErrorMessage = (error: unknown): string =>"
// and "export interface" after it
// Actually let me just remove the manually written one and keep the extracted one
core = core.replace(
  `const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

interface GenerateArtifactsInput {`,
  `interface GenerateArtifactsInput {`
);

// Remove the second getErrorMessage from extracted code
// It appears in the extracted block too
core = core.replace(
  /\nconst getErrorMessage = \(error: unknown\): string => \{\n  return error instanceof Error \? error\.message : String\(error\);\n\};/,
  ''
);

// Fix ResolvedFormHandlingMode references - import from forms
core = core.replace(
  `import type { IconFallbackResolver, RenderContext, ResolvedFormHandlingModeType as ResolvedFormHandlingModeType } from "./generator-render.js";`,
  `import type { IconFallbackResolver } from "./generator-render.js";
import type { ResolvedFormHandlingMode } from "./generator-forms.js";`
);

// Fix unused import
core = core.replace(
  `import type { GeneratorContext } from "./generator-context.js";\n`,
  ''
);

// Fix the internal imports section
core = core.replace(
  `// ── Internal imports from sub-modules used by the orchestrator ────────────
import {
  createEmptySimplificationStats,
  flattenElements,
  ICON_FALLBACK_FILE_NAME,
  loadIconFallbackResolver,
  isPlainRecord
} from "./generator-render.js";
import type { IconFallbackResolver, RenderContext, ResolvedFormHandlingModeType as ResolvedFormHandlingModeType } from "./generator-render.js";`,
  `// ── Internal imports from sub-modules used by the orchestrator ────────────
import {
  createEmptySimplificationStats,
  flattenElements,
  ICON_FALLBACK_FILE_NAME,
  loadIconFallbackResolver,
  isPlainRecord
} from "./generator-render.js";
import type { IconFallbackResolver } from "./generator-render.js";
import type { ResolvedFormHandlingMode } from "./generator-forms.js";`
);

// Remove unused AccessibilityWarning import (already imported via re-export)
core = core.replace(`import type { AccessibilityWarning } from "./generator-a11y.js";\n`, '');

writeFile("generator-core.ts", core);

console.log("\n✅ Fixes applied!");
