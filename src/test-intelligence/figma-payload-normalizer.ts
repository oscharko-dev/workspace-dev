/**
 * Figma REST file → IntentDerivationFigmaInput normalizer (Issue #1733).
 *
 * Pure, deterministic, depth-bounded. Walks the REST node tree iteratively
 * (no recursion → no stack risk on pathological depth), promotes FRAME /
 * COMPONENT / COMPONENT_SET / SECTION / INSTANCE roots with a non-trivial
 * bounding box to "screens", and projects their inner TEXT / button-shaped
 * INSTANCE / RECTANGLE-with-text descendants into the IR's node list.
 *
 * Outputs are sorted by `(screenId, nodeId)` so the resulting
 * `IntentDerivationFigmaInput` is byte-stable across runs and across input
 * payload key reordering.
 */

import type { IntentDerivationFigmaInput } from "./intent-derivation.js";
import type { FigmaRestNode } from "./figma-rest-adapter.js";

/** Public input to the normalizer. */
export interface NormalizeFigmaInput {
  fileKey: string;
  document: FigmaRestNode;
}

/** Maximum nodes the iterative walker visits to bound traversal cost. */
const MAX_VISIT_NODES = 50_000;
/** Minimum bounding box dimensions for a node to be promoted to a screen. */
const MIN_SCREEN_DIMENSION = 280;

const SCREEN_NODE_TYPES = new Set<string>([
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "SECTION",
]);
const TEXT_NODE_TYPES = new Set<string>(["TEXT"]);
const INPUT_HINT_RE =
  /\b(input|field|email|password|search|phone|otp|amount|iban|bic|account|name|date|select|dropdown|combo|textfield|textinput|investition|kredit|laufzeit|zinssatz|tilgung)\b/iu;
const BUTTON_HINT_RE =
  /\b(button|cta|submit|next|weiter|speichern|save|ok|bestätigen|confirm|abbrechen|cancel|zurück|back|navigate|link)\b/iu;

interface VisitFrame {
  node: FigmaRestNode;
  depth: number;
}

/**
 * Pure normalization. Identical inputs → identical outputs (sorted by id).
 */
export const normalizeFigmaFileToIntentInput = (
  input: NormalizeFigmaInput,
): IntentDerivationFigmaInput => {
  const screens = collectScreens(input.document);
  return {
    source: { kind: "figma_rest" },
    screens,
  };
};

const collectScreens = (
  document: FigmaRestNode,
): IntentDerivationFigmaInput["screens"] => {
  const screens: IntentDerivationFigmaInput["screens"] = [];
  const seen = new Set<string>();

  // Special-case: when the document root itself is screen-shaped (the
  // node-scoped fetch path returns the requested FRAME as the root), treat
  // it as the only screen. Otherwise walk the tree iteratively.
  if (isScreenShaped(document)) {
    pushScreen(document, screens, seen);
    return sortScreens(screens);
  }

  const stack: VisitFrame[] = [{ node: document, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    visited += 1;
    if (visited > MAX_VISIT_NODES) break;
    const { node, depth } = frame;
    if (node.visible === false) continue;
    if (isScreenShaped(node)) {
      pushScreen(node, screens, seen);
      // Do not descend into screen children for further screens — the
      // top-level screen pulls its own internal nodes during projection.
      continue;
    }
    if (depth > 64) continue;
    const children = node.children;
    if (Array.isArray(children)) {
      // Push in reverse so iteration order matches the source order even
      // though we pop from the back.
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (child !== undefined) {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    }
  }
  return sortScreens(screens);
};

const pushScreen = (
  screenRoot: FigmaRestNode,
  screens: IntentDerivationFigmaInput["screens"],
  seen: Set<string>,
): void => {
  if (seen.has(screenRoot.id)) return;
  seen.add(screenRoot.id);
  const nodes = projectScreenNodes(screenRoot);
  screens.push({
    screenId: screenRoot.id,
    screenName: screenRoot.name ?? screenRoot.id,
    nodes,
  });
};

const isScreenShaped = (node: FigmaRestNode): boolean => {
  if (!SCREEN_NODE_TYPES.has(node.type)) return false;
  const box = node.absoluteBoundingBox;
  if (box === undefined) {
    // SECTION / COMPONENT_SET often have no bounding box themselves —
    // accept them as logical screen containers.
    return node.type === "SECTION" || node.type === "COMPONENT_SET";
  }
  const width = typeof box.width === "number" ? box.width : 0;
  const height = typeof box.height === "number" ? box.height : 0;
  return width >= MIN_SCREEN_DIMENSION && height >= MIN_SCREEN_DIMENSION;
};

const projectScreenNodes = (
  screenRoot: FigmaRestNode,
): IntentDerivationFigmaInput["screens"][number]["nodes"] => {
  const projected: IntentDerivationFigmaInput["screens"][number]["nodes"] = [];
  const stack: VisitFrame[] = [{ node: screenRoot, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    visited += 1;
    if (visited > MAX_VISIT_NODES) break;
    const { node, depth } = frame;
    if (node === screenRoot) {
      // Skip the screen container itself, but recurse into children.
    } else if (node.visible !== false) {
      const projection = projectNode(node);
      if (projection !== undefined) {
        projected.push(projection);
      }
    }
    if (depth > 64) continue;
    const children = node.children;
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (child !== undefined) {
          stack.push({ node: child, depth: depth + 1 });
        }
      }
    }
  }
  return projected.sort((a, b) =>
    a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
  );
};

const projectNode = (
  node: FigmaRestNode,
):
  | IntentDerivationFigmaInput["screens"][number]["nodes"][number]
  | undefined => {
  const name = node.name ?? "";
  if (TEXT_NODE_TYPES.has(node.type)) {
    const text = typeof node.characters === "string" ? node.characters : name;
    if (INPUT_HINT_RE.test(name)) {
      return {
        nodeId: node.id,
        nodeName: name,
        nodeType: "TEXT_INPUT",
        text,
      };
    }
    return {
      nodeId: node.id,
      nodeName: name,
      nodeType: "TEXT",
      text,
    };
  }
  if (
    node.type === "INSTANCE" ||
    node.type === "COMPONENT" ||
    node.type === "RECTANGLE"
  ) {
    if (BUTTON_HINT_RE.test(name)) {
      const text =
        typeof node.characters === "string" && node.characters.length > 0
          ? node.characters
          : name;
      return {
        nodeId: node.id,
        nodeName: name,
        nodeType: "BUTTON",
        text,
      };
    }
    if (INPUT_HINT_RE.test(name)) {
      return {
        nodeId: node.id,
        nodeName: name,
        nodeType: "TEXT_INPUT",
        ...(typeof node.characters === "string" && node.characters.length > 0
          ? { text: node.characters }
          : {}),
      };
    }
  }
  return undefined;
};

const sortScreens = (
  screens: IntentDerivationFigmaInput["screens"],
): IntentDerivationFigmaInput["screens"] =>
  [...screens].sort((a, b) =>
    a.screenId < b.screenId ? -1 : a.screenId > b.screenId ? 1 : 0,
  );
