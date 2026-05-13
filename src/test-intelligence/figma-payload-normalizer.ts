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
 *
 * Issue #1902 — spatial-cluster pass:
 *   For each button-shaped INSTANCE/COMPONENT whose own `characters` field is
 *   empty (i.e. its visible label is the generic component name like
 *   `<Button>`), pair it with the first descendant TEXT node and adopt that
 *   text as the button label. The original component name is preserved on
 *   `componentName` for trace provenance, and the consumed TEXT node is
 *   suppressed from the flat projection so it is not double-counted as a
 *   stand-alone field. Buttons with no usable descendant text retain their
 *   component name and are tagged with `labelConfidence: 0` so the judge
 *   panel can flag them as weak labels.
 *
 *   Remaining flat TEXT projections are then grouped into spatial clusters by
 *   tight horizontal/vertical adjacency, so the downstream generator can keep
 *   label/value pairs (e.g. `Gesamtfinanzierungsbedarf` / `0,00 €`) together.
 */

import type { IntentDerivationFigmaInput } from "./intent-derivation.js";
import { isCoverageRelevantElementLike } from "./coverage-relevance.js";
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
/**
 * Maximum centre-to-centre distance (in px) between two TEXT projections that
 * still counts as the same field cluster. The threshold is generous enough to
 * catch typical label/value pairs (label above value, label left of value) but
 * tight enough that unrelated regions of a screen do not collapse.
 */
const FIELD_CLUSTER_GAP_PX = 32;

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
const RADIO_HINT_RE =
  /\b(radio|option|choice|brutto|netto|einmalig|monatlich|jährlich|ja|nein)\b|to?oggle(?:button|buttongroup)?|toogle(?:button|buttongroup)?/iu;
const SELECT_HINT_RE =
  /\b(select|dropdown|combo|auswahl|auswahlfeld|picker)\b/iu;
const RESULT_HINT_RE =
  /\b(result|ergebnis|gesamt|summe|betrag|rate|finanzierungsbedarf|auszahl|saldo|kreditbetrag)\b/iu;
const LABEL_HINT_RE =
  /\b(label|hinweis|help|helper|info|information|beschreibung|text)\b/iu;
const DECORATIVE_HINT_RE =
  /\b(icon|chevron|arrow|vector|svg|glyph|decorative|separator|divider)\b/iu;
const FORM_FIELD_CONTEXT_TEXT_RE =
  /[?？]|\b(?:optional|required|pflicht|pflichtfeld|erforderlich|gewünscht|gewuenscht|geplant|berücksichtigt|beruecksichtigt|soll|ist|handelt|wie|welche|kann|könnte|koennte)\b/iu;
const VALUE_LIKE_TEXT_RE =
  /^[\d\s.,%€$+-]+$|^(?:eur|usd|chf|gbp|ja|nein|yes|no|netto|brutto)$/iu;
const FIELD_CLUSTER_NODE_TYPES = new Set([
  "TEXT",
  "TEXT_INPUT",
  "RADIO_OPTION",
  "SELECT_FIELD",
  "RESULT_DISPLAY",
  "INFORMATIVE_LABEL",
]);

type SemanticNodeKind =
  | "button"
  | "text_input"
  | "radio_option"
  | "select_field"
  | "result_display"
  | "informative_label"
  | "decorative";

interface VisitFrame {
  node: FigmaRestNode;
  depth: number;
}

/** Internal raw projection record carrying spatial + tree context. */
interface RawProjection {
  nodeId: string;
  nodeName: string;
  /** Resolved node-type label as it would appear in the IR. */
  nodeType:
    | "TEXT"
    | "TEXT_INPUT"
    | "BUTTON"
    | "RADIO_OPTION"
    | "SELECT_FIELD"
    | "RESULT_DISPLAY"
    | "INFORMATIVE_LABEL"
    | "DECORATIVE";
  /** Underlying Figma type (`TEXT`, `INSTANCE`, `COMPONENT`, `RECTANGLE`). */
  figmaType: string;
  text: string;
  /**
   * Original Figma node name for INSTANCE/COMPONENT projections — preserved
   * so we can emit `trace.componentName` even when the visible label is later
   * adopted from a descendant TEXT node.
   */
  componentName?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  /**
   * IDs of all INSTANCE/COMPONENT ancestors traversed between the screen root
   * and this node. Used by the pairing pass to decide which TEXT projections
   * should donate their label to which button.
   */
  instanceAncestorIds: string[];
  /** True if the projection itself is a button-shaped INSTANCE/COMPONENT. */
  isButtonInstance: boolean;
  /** Semantic classification retained for downstream consumers. */
  semanticKind?: SemanticNodeKind;
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

interface ProjectionFrame {
  node: FigmaRestNode;
  depth: number;
  /** Stack of INSTANCE/COMPONENT ancestors, oldest-first. */
  instanceAncestorIds: string[];
  /** Nearest non-button interactive ancestor; used to classify descendant text labels. */
  interactiveAncestorKind?: Extract<
    SemanticNodeKind,
    "text_input" | "radio_option" | "select_field"
  >;
}

const projectScreenNodes = (
  screenRoot: FigmaRestNode,
): IntentDerivationFigmaInput["screens"][number]["nodes"] => {
  const raw: RawProjection[] = [];
  const stack: ProjectionFrame[] = [
    { node: screenRoot, depth: 0, instanceAncestorIds: [] },
  ];
  let visited = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    visited += 1;
    if (visited > MAX_VISIT_NODES) break;
    const { node, depth, instanceAncestorIds, interactiveAncestorKind } = frame;
    if (node !== screenRoot && node.visible === false) continue;
    if (node !== screenRoot) {
      const projection = projectNode(
        node,
        instanceAncestorIds,
        interactiveAncestorKind,
      );
      if (projection !== undefined) raw.push(projection);
    }
    if (depth > 64) continue;
    const children = node.children;
    if (Array.isArray(children)) {
      const nodeSemanticKind =
        node !== screenRoot && isInstanceLike(node)
          ? classifySemanticKind(node)
          : undefined;
      const childAncestors =
        node !== screenRoot && isInstanceLike(node)
          ? [...instanceAncestorIds, node.id]
          : instanceAncestorIds;
      const childInteractiveAncestorKind = resolveChildInteractiveAncestorKind(
        nodeSemanticKind,
        interactiveAncestorKind,
      );
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (child !== undefined) {
          stack.push({
            node: child,
            depth: depth + 1,
            instanceAncestorIds: childAncestors,
            ...(childInteractiveAncestorKind !== undefined
              ? { interactiveAncestorKind: childInteractiveAncestorKind }
              : {}),
          });
        }
      }
    }
  }
  return finalizeProjections(raw);
};

const isInstanceLike = (node: FigmaRestNode): boolean =>
  node.type === "INSTANCE" || node.type === "COMPONENT";

const classifySemanticKind = (
  node: FigmaRestNode,
): SemanticNodeKind | undefined => {
  const name = (node.name ?? "").trim();
  const text = typeof node.characters === "string" ? node.characters.trim() : "";
  const combined = `${name} ${text}`.trim();
  if (combined.length === 0) return undefined;
  if (DECORATIVE_HINT_RE.test(combined)) return "decorative";
  if (SELECT_HINT_RE.test(combined)) return "select_field";
  if (RADIO_HINT_RE.test(combined)) return "radio_option";
  if (BUTTON_HINT_RE.test(combined)) return "button";
  if (RESULT_HINT_RE.test(combined)) return "result_display";
  if (LABEL_HINT_RE.test(combined)) return "informative_label";
  if (INPUT_HINT_RE.test(combined)) return "text_input";
  return undefined;
};

const resolveChildInteractiveAncestorKind = (
  semanticKind: SemanticNodeKind | undefined,
  inherited:
    | Extract<SemanticNodeKind, "text_input" | "radio_option" | "select_field">
    | undefined,
):
  | Extract<SemanticNodeKind, "text_input" | "radio_option" | "select_field">
  | undefined => {
  if (
    semanticKind === "text_input" ||
    semanticKind === "radio_option" ||
    semanticKind === "select_field"
  ) {
    return semanticKind;
  }
  return inherited;
};

const projectNode = (
  node: FigmaRestNode,
  instanceAncestorIds: string[],
  interactiveAncestorKind:
    | Extract<SemanticNodeKind, "text_input" | "radio_option" | "select_field">
    | undefined,
): RawProjection | undefined => {
  const name = node.name ?? "";
  const bbox = readBbox(node);
  const semanticKind = classifySemanticKind(node);
  if (semanticKind === "decorative") return undefined;
  if (TEXT_NODE_TYPES.has(node.type)) {
    const text = typeof node.characters === "string" ? node.characters : name;
    const resolvedSemanticKind = semanticKind ?? interactiveAncestorKind;
    const nodeType =
      resolvedSemanticKind === "text_input"
        ? "TEXT_INPUT"
        : resolvedSemanticKind === "radio_option"
          ? "RADIO_OPTION"
          : resolvedSemanticKind === "select_field"
            ? "SELECT_FIELD"
            : resolvedSemanticKind === "result_display"
              ? "RESULT_DISPLAY"
              : resolvedSemanticKind === "informative_label"
                ? "INFORMATIVE_LABEL"
                : INPUT_HINT_RE.test(name)
                  ? "TEXT_INPUT"
                  : "TEXT";
    if (
      !isCoverageRelevantElementLike({
        label: text,
        kind: nodeType,
      }) &&
      nodeType !== "TEXT_INPUT" &&
      nodeType !== "RESULT_DISPLAY"
    ) {
      if (!isLikelyFieldContextText(text)) return undefined;
      const projection: RawProjection = {
        nodeId: node.id,
        nodeName: name,
        nodeType: "INFORMATIVE_LABEL",
        figmaType: node.type,
        text,
        instanceAncestorIds: [...instanceAncestorIds],
        isButtonInstance: false,
        semanticKind: "informative_label",
      };
      if (bbox !== undefined) projection.bbox = bbox;
      return projection;
    }
    const projection: RawProjection = {
      nodeId: node.id,
      nodeName: name,
      nodeType,
      figmaType: node.type,
      text,
      instanceAncestorIds: [...instanceAncestorIds],
      isButtonInstance: false,
    };
    if (resolvedSemanticKind !== undefined)
      projection.semanticKind = resolvedSemanticKind;
    if (bbox !== undefined) projection.bbox = bbox;
    return projection;
  }
  if (
    node.type === "INSTANCE" ||
    node.type === "COMPONENT" ||
    node.type === "RECTANGLE"
  ) {
    if (semanticKind === "button" || BUTTON_HINT_RE.test(name)) {
      const hasOwnText =
        typeof node.characters === "string" && node.characters.length > 0;
      const projection: RawProjection = {
        nodeId: node.id,
        nodeName: name,
        nodeType: "BUTTON",
        figmaType: node.type,
        text: hasOwnText ? (node.characters as string) : name,
        componentName: name,
        instanceAncestorIds: [...instanceAncestorIds],
        isButtonInstance: isInstanceLike(node),
        semanticKind: "button",
      };
      if (bbox !== undefined) projection.bbox = bbox;
      return projection;
    }
    if (semanticKind !== undefined) {
      const hasOwnText =
        typeof node.characters === "string" && node.characters.length > 0;
      const text = hasOwnText ? (node.characters as string) : name;
      const nodeType =
        semanticKind === "text_input"
          ? "TEXT_INPUT"
          : semanticKind === "radio_option"
            ? "RADIO_OPTION"
            : semanticKind === "select_field"
              ? "SELECT_FIELD"
              : semanticKind === "result_display"
                ? "RESULT_DISPLAY"
                : "INFORMATIVE_LABEL";
      if (
        !isCoverageRelevantElementLike({
          label: text,
          kind: nodeType,
        }) &&
        semanticKind !== "text_input" &&
        semanticKind !== "result_display"
      ) {
        return undefined;
      }
      const projection: RawProjection = {
        nodeId: node.id,
        nodeName: name,
        nodeType,
        figmaType: node.type,
        text,
        instanceAncestorIds: [...instanceAncestorIds],
        isButtonInstance: false,
        semanticKind,
      };
      if (bbox !== undefined) projection.bbox = bbox;
      return projection;
    }
    if (INPUT_HINT_RE.test(name)) {
      const hasOwnText =
        typeof node.characters === "string" && node.characters.length > 0;
      const projection: RawProjection = {
        nodeId: node.id,
        nodeName: name,
        nodeType: "TEXT_INPUT",
        figmaType: node.type,
        text: hasOwnText ? (node.characters as string) : name,
        instanceAncestorIds: [...instanceAncestorIds],
        isButtonInstance: false,
        semanticKind: "text_input",
      };
      if (bbox !== undefined) projection.bbox = bbox;
      return projection;
    }
  }
  return undefined;
};

const isLikelyFieldContextText = (text: string): boolean => {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return (
    normalized.length >= 4 &&
    normalized.length <= 160 &&
    /\p{L}/u.test(normalized) &&
    !VALUE_LIKE_TEXT_RE.test(normalized) &&
    FORM_FIELD_CONTEXT_TEXT_RE.test(normalized)
  );
};

const readBbox = (
  node: FigmaRestNode,
): { x: number; y: number; width: number; height: number } | undefined => {
  const box = node.absoluteBoundingBox;
  if (box === undefined) return undefined;
  const x = typeof box.x === "number" ? box.x : NaN;
  const y = typeof box.y === "number" ? box.y : NaN;
  const width = typeof box.width === "number" ? box.width : NaN;
  const height = typeof box.height === "number" ? box.height : NaN;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return undefined;
  }
  return { x, y, width, height };
};

/**
 * Pair button-shaped projections with their best descendant TEXT projection,
 * cluster the remaining text fields by spatial proximity, and emit the public
 * `IntentDerivationNodeInput` array sorted by `nodeId`.
 */
const finalizeProjections = (
  raw: RawProjection[],
): IntentDerivationFigmaInput["screens"][number]["nodes"] => {
  // Stable secondary order so the pairing pass picks deterministic donors
  // even when the walk order varies.
  const ordered = [...raw].sort((a, b) =>
    a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
  );
  const buttonsById = new Map<string, RawProjection>();
  for (const entry of ordered) {
    if (entry.isButtonInstance) buttonsById.set(entry.nodeId, entry);
  }

  // Pair each button with its best descendant TEXT donor. We walk text
  // candidates in id-sorted order and award each donor to at most one button
  // — the *deepest* (innermost) ancestor — so a Button → ChildButton →
  // ChildText chain inherits the text down to the innermost button only.
  const adoptedLabel = new Map<
    string,
    { donorId: string; text: string; donorBbox?: RawProjection["bbox"] }
  >();
  const consumedDonorIds = new Set<string>();
  for (const candidate of ordered) {
    if (candidate.figmaType !== "TEXT") continue;
    if (typeof candidate.text !== "string" || candidate.text.length === 0) {
      continue;
    }
    let chosenButton: RawProjection | undefined;
    // Walk ancestors innermost-first so the deepest button wins (sibling-text
    // inheritance for nested component instances).
    for (let i = candidate.instanceAncestorIds.length - 1; i >= 0; i -= 1) {
      const ancestorId = candidate.instanceAncestorIds[i];
      if (ancestorId === undefined) continue;
      const button = buttonsById.get(ancestorId);
      if (button === undefined) continue;
      // Only adopt when the button has no real `characters` of its own — we
      // never overwrite an explicit author-set label.
      if (
        typeof button.text === "string" &&
        button.text.length > 0 &&
        button.text !== button.componentName
      ) {
        continue;
      }
      // Bounding-box gate: when both bboxes are known, require containment
      // (the candidate's centre must lie inside the button's box). When
      // either box is missing we trust the structural ancestry.
      if (!isCandidateInsideButton(candidate, button)) continue;
      chosenButton = button;
      break;
    }
    if (chosenButton === undefined) continue;
    const existing = adoptedLabel.get(chosenButton.nodeId);
    if (existing === undefined) {
      adoptedLabel.set(chosenButton.nodeId, {
        donorId: candidate.nodeId,
        text: candidate.text,
        donorBbox: candidate.bbox,
      });
      consumedDonorIds.add(candidate.nodeId);
    }
  }

  // Build the published projection list.
  const published: IntentDerivationFigmaInput["screens"][number]["nodes"] = [];
  for (const entry of ordered) {
    // Drop TEXT donors that were folded into a button label so we do not
    // double-count them as stand-alone fields.
    if (consumedDonorIds.has(entry.nodeId)) continue;

    const adoption = entry.isButtonInstance
      ? adoptedLabel.get(entry.nodeId)
      : undefined;
    const labelConfidence = computeLabelConfidence(entry, adoption);
    const labelSource = computeLabelSource(entry, adoption);

    const node: IntentDerivationFigmaInput["screens"][number]["nodes"][number] =
      {
        nodeId: entry.nodeId,
        nodeName: entry.nodeName,
        nodeType: entry.nodeType,
        text: adoption !== undefined ? adoption.text : entry.text,
      };
    if (entry.semanticKind !== undefined) node.semanticKind = entry.semanticKind;
    if (entry.componentName !== undefined) {
      node.componentName = entry.componentName;
    }
    if (labelSource !== undefined) node.labelSource = labelSource;
    if (labelConfidence !== undefined) {
      node.labelConfidence = labelConfidence;
    }
    if (entry.bbox !== undefined) node.bbox = entry.bbox;
    published.push(node);
  }

  // Field-cluster pass: group adjacent TEXT/TEXT_INPUT projections by tight
  // spatial proximity. Buttons are deliberately excluded — they already carry
  // a self-contained label.
  applyFieldClusters(published);

  return published.sort((a, b) =>
    a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
  );
};

const computeLabelSource = (
  entry: RawProjection,
  adoption:
    | { donorId: string; text: string; donorBbox?: RawProjection["bbox"] }
    | undefined,
): 
  | IntentDerivationFigmaInput["screens"][number]["nodes"][number]["labelSource"]
  | undefined => {
  if (adoption !== undefined) return "sibling_text";
  if (entry.figmaType === "TEXT") return "node_text";
  if (
    entry.semanticKind !== undefined &&
    entry.semanticKind !== "button" &&
    entry.semanticKind !== "decorative"
  ) {
    return "node_text";
  }
  if (entry.isButtonInstance || entry.componentName !== undefined) {
    return "node_name";
  }
  return undefined;
};

const computeLabelConfidence = (
  entry: RawProjection,
  adoption:
    | { donorId: string; text: string; donorBbox?: RawProjection["bbox"] }
    | undefined,
): number | undefined => {
  if (adoption !== undefined) return 0.85;
  if (
    entry.semanticKind !== undefined &&
    entry.semanticKind !== "button" &&
    entry.semanticKind !== "decorative"
  ) {
    return 0.9;
  }
  if (!entry.isButtonInstance) return undefined;
  // Button instance with no donor and no real own characters → weak label.
  // Treat the visible label as the component name, mark confidence as 0 so
  // judges can flag it as a `weak_label` finding.
  return 0;
};

const isCandidateInsideButton = (
  candidate: RawProjection,
  button: RawProjection,
): boolean => {
  const cbox = candidate.bbox;
  const bbox = button.bbox;
  if (cbox === undefined || bbox === undefined) return true;
  const cx = cbox.x + cbox.width / 2;
  const cy = cbox.y + cbox.height / 2;
  return (
    cx >= bbox.x &&
    cx <= bbox.x + bbox.width &&
    cy >= bbox.y &&
    cy <= bbox.y + bbox.height
  );
};

/**
 * Group remaining flat TEXT/TEXT_INPUT projections by tight spatial adjacency
 * (Issue #1902, criterion 5). The grouping is union-find based and operates
 * on bbox edges, not centres, so a label sitting directly above a value gets
 * the same `clusterId` regardless of differing widths.
 */
const applyFieldClusters = (
  nodes: IntentDerivationFigmaInput["screens"][number]["nodes"],
): void => {
  const indexed = nodes
    .map((node, index) => ({ node, index }))
    .filter(
      (entry) =>
        FIELD_CLUSTER_NODE_TYPES.has(entry.node.nodeType) &&
        entry.node.bbox !== undefined,
    );
  if (indexed.length < 2) return;
  const parent: number[] = indexed.map((_, i) => i);
  const find = (i: number): number => {
    let cursor = i;
    while (parent[cursor] !== cursor) {
      const next = parent[cursor];
      if (next === undefined) break;
      const grand = parent[next];
      if (grand !== undefined) parent[cursor] = grand;
      cursor = parent[cursor]!;
    }
    return cursor;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  for (let i = 0; i < indexed.length; i += 1) {
    for (let j = i + 1; j < indexed.length; j += 1) {
      const left = indexed[i]!;
      const right = indexed[j]!;
      if (areBoxesAdjacent(left.node.bbox!, right.node.bbox!)) {
        union(i, j);
      }
    }
  }
  // Build cluster id from the lexicographically smallest node id in each
  // group so the assignment is deterministic.
  const groupRepIds = new Map<number, string>();
  for (let i = 0; i < indexed.length; i += 1) {
    const root = find(i);
    const candidate = indexed[i]!.node.nodeId;
    const existing = groupRepIds.get(root);
    if (existing === undefined || candidate < existing) {
      groupRepIds.set(root, candidate);
    }
  }
  // Count members per root so singletons are not labelled.
  const memberCounts = new Map<number, number>();
  for (let i = 0; i < indexed.length; i += 1) {
    const root = find(i);
    memberCounts.set(root, (memberCounts.get(root) ?? 0) + 1);
  }
  for (let i = 0; i < indexed.length; i += 1) {
    const root = find(i);
    if ((memberCounts.get(root) ?? 0) < 2) continue;
    const repId = groupRepIds.get(root);
    if (repId === undefined) continue;
    indexed[i]!.node.clusterId = `field-cluster::${repId}`;
  }
};

const areBoxesAdjacent = (
  a: NonNullable<
    IntentDerivationFigmaInput["screens"][number]["nodes"][number]["bbox"]
  >,
  b: NonNullable<
    IntentDerivationFigmaInput["screens"][number]["nodes"][number]["bbox"]
  >,
): boolean => {
  const horizontalGap = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const verticalGap = Math.max(
    0,
    Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height),
  );
  if (horizontalGap > FIELD_CLUSTER_GAP_PX) return false;
  if (verticalGap > FIELD_CLUSTER_GAP_PX) return false;
  // Require horizontal OR vertical alignment so that genuinely diagonal
  // pairs are not collapsed.
  const horizontalOverlap =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const verticalOverlap =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return horizontalOverlap > 0 || verticalOverlap > 0;
};

const sortScreens = (
  screens: IntentDerivationFigmaInput["screens"],
): IntentDerivationFigmaInput["screens"] =>
  [...screens].sort((a, b) =>
    a.screenId < b.screenId ? -1 : a.screenId > b.screenId ? 1 : 0,
  );
