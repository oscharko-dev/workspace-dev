import type { FigmaAnalysis, FigmaAnalysisFrameVariantGroup } from "./figma-analysis.js";
import {
  firstText,
  isLikelyErrorRedColor,
  toRgbaColor
} from "./templates/utility-functions.js";
import { isTextElement } from "./types-ir.js";
import type {
  AppShellIR,
  DesignIR,
  ScreenElementIR,
  ScreenIR,
  ScreenVariantFamilyAxis,
  ScreenVariantFieldErrorEvidenceIR,
  ScreenVariantFamilyIR,
  ScreenVariantFamilyInitialStateIR,
  ScreenVariantFamilyScenarioIR,
  ScreenVariantScreenLevelErrorEvidenceIR
} from "./types-ir.js";

interface IndexedNodeRecord {
  element: ScreenElementIR;
  path: string;
}

interface ValidationFieldRecord {
  canonicalElement: ScreenElementIR;
  memberElement: ScreenElementIR;
  path: string;
  fieldKey: string;
}

interface ValidationMessageCandidate {
  element: ScreenElementIR;
  path: string;
  message: string;
}

interface ValidationOnlyDiffEvidence {
  isValidationOnly: boolean;
  fieldErrorEvidenceByFieldKey?: Record<string, ScreenVariantFieldErrorEvidenceIR>;
  screenLevelErrorEvidence?: ScreenVariantScreenLevelErrorEvidenceIR[];
}

const ACTIONABLE_AXES: readonly ScreenVariantFamilyAxis[] = [
  "pricing-mode",
  "expansion-state",
  "validation-state"
] as const;

/**
 * Maximum vertical distance a validation message label may sit above a form
 * field's top edge while still being considered a candidate for pairing. Chosen
 * to tolerate a standard form-row label/caption above the field.
 */
const VALIDATION_MESSAGE_ABOVE_FIELD_TOLERANCE_PX = 24;

/**
 * Maximum vertical distance a validation message may sit below a form field's
 * bottom edge while still being considered a candidate for pairing. Tuned to
 * allow for helper-text, inline error summaries, and related layout gaps that
 * appear directly beneath the field.
 */
const VALIDATION_MESSAGE_BELOW_FIELD_TOLERANCE_PX = 160;

const ACTIONABLE_AXIS_SET = new Set<string>(ACTIONABLE_AXES);
const ERROR_TOKEN_SET = new Set(["error", "errors", "fehler", "fehlermeldung", "fehlermeldungen"]);
const COLLAPSED_TOKEN_SET = new Set(["collapsed", "collapse", "eingeklappt"]);
const EXPANDED_TOKEN_SET = new Set(["expanded", "expand", "expandedstate"]);

const normalizeNodeName = (value: string | undefined): string => {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const normalizeValueToken = (value: string | undefined): string => {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
};

const createAccordionStateKey = (element: ScreenElementIR, occurrenceIndex: number): string => {
  const sanitizedName = element.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase() || "accordion";
  return occurrenceIndex === 0 ? sanitizedName : `${sanitizedName}_${occurrenceIndex}`;
};

const collectScreenElements = (roots: readonly ScreenElementIR[]): ScreenElementIR[] => {
  const result: ScreenElementIR[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    result.push(current);
    if (Array.isArray(current.children) && current.children.length > 0) {
      for (let index = current.children.length - 1; index >= 0; index -= 1) {
        stack.push(current.children[index]!);
      }
    }
  }
  return result;
};

const collectNormalizedTokens = (screen: ScreenIR): Set<string> => {
  const tokens = new Set<string>();
  const visit = (node: ScreenElementIR): void => {
    for (const candidate of [node.name, node.text]) {
      const normalized = normalizeNodeName(candidate);
      if (!normalized) {
        continue;
      }
      for (const token of normalized.split("-")) {
        if (token.length > 0) {
          tokens.add(token);
        }
      }
    }
    if (node.variantMapping) {
      for (const [property, value] of Object.entries(node.variantMapping.properties)) {
        const normalizedProperty = normalizeNodeName(property);
        if (normalizedProperty) {
          tokens.add(normalizedProperty);
        }
        const normalizedValue = normalizeValueToken(value);
        if (normalizedValue) {
          tokens.add(normalizedValue);
        }
      }
      if (node.variantMapping.state) {
        const normalizedState = normalizeValueToken(node.variantMapping.state);
        if (normalizedState) {
          tokens.add(normalizedState);
        }
      }
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const child of screen.children) {
    visit(child);
  }
  return tokens;
};

const resolveAccordionExpanded = (element: ScreenElementIR): boolean | undefined => {
  const stateValues = [
    element.variantMapping?.properties["state"],
    element.variantMapping?.state,
    element.name
  ];
  for (const rawValue of stateValues) {
    const normalized = normalizeValueToken(rawValue);
    if (!normalized) {
      continue;
    }
    if (EXPANDED_TOKEN_SET.has(normalized)) {
      return true;
    }
    if (COLLAPSED_TOKEN_SET.has(normalized)) {
      return false;
    }
  }
  return undefined;
};

const resolveInitialState = ({
  screen,
  axes
}: {
  screen: ScreenIR;
  axes: readonly ScreenVariantFamilyAxis[];
}): ScreenVariantFamilyInitialStateIR => {
  const tokens = collectNormalizedTokens(screen);
  const accordions = collectScreenElements(screen.children).filter((element) => element.type === "accordion");
  const occurrenceCountByName = new Map<string, number>();
  const accordionStateByKey = Object.fromEntries(
    accordions
      .map((accordion) => {
        const expanded = resolveAccordionExpanded(accordion);
        if (expanded === undefined) {
          return undefined;
        }
        const sanitized = accordion.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase() || "accordion";
        const occurrenceIndex = occurrenceCountByName.get(sanitized) ?? 0;
        occurrenceCountByName.set(sanitized, occurrenceIndex + 1);
        return [createAccordionStateKey(accordion, occurrenceIndex), expanded] as const;
      })
      .filter((entry): entry is readonly [string, boolean] => entry !== undefined)
  );

  const initialState: ScreenVariantFamilyInitialStateIR = {};
  if (axes.includes("pricing-mode")) {
    if (tokens.has("brutto")) {
      initialState.pricingMode = "brutto";
    } else if (tokens.has("netto")) {
      initialState.pricingMode = "netto";
    }
  }

  if (axes.includes("validation-state")) {
    initialState.validationState = [...tokens].some((token) => ERROR_TOKEN_SET.has(token)) ? "error" : "default";
  }

  if (axes.includes("expansion-state")) {
    const hasExpandedAccordion = Object.values(accordionStateByKey).some((value) => value);
    const hasCollapsedAccordion = Object.values(accordionStateByKey).some((value) => !value);
    if (hasExpandedAccordion) {
      initialState.expansionState = "expanded";
    } else if (hasCollapsedAccordion) {
      initialState.expansionState = "collapsed";
    } else if ([...tokens].some((token) => EXPANDED_TOKEN_SET.has(token))) {
      initialState.expansionState = "expanded";
    } else if ([...tokens].some((token) => COLLAPSED_TOKEN_SET.has(token))) {
      initialState.expansionState = "collapsed";
    }
  }

  if (Object.keys(accordionStateByKey).length > 0) {
    initialState.accordionStateByKey = accordionStateByKey;
  }

  return initialState;
};

const buildIndexedNodeRecords = ({ roots, rootPath }: { roots: readonly ScreenElementIR[]; rootPath: string }): IndexedNodeRecord[] => {
  const records: IndexedNodeRecord[] = [];

  const visitSiblings = (siblings: readonly ScreenElementIR[], parentPath: string): void => {
    const occurrenceByFingerprint = new Map<string, number>();
    for (const sibling of siblings) {
      const fingerprint = [
        normalizeNodeName(sibling.nodeType),
        normalizeNodeName(sibling.semanticType ?? sibling.type),
        normalizeNodeName(sibling.name)
      ].join("|");
      const occurrenceIndex = occurrenceByFingerprint.get(fingerprint) ?? 0;
      occurrenceByFingerprint.set(fingerprint, occurrenceIndex + 1);
      const path = `${parentPath}/${fingerprint}[${occurrenceIndex}]`;
      records.push({ element: sibling, path });
      if (Array.isArray(sibling.children) && sibling.children.length > 0) {
        visitSiblings(sibling.children, path);
      }
    }
  };

  visitSiblings(roots, rootPath);
  return records;
};

const buildIndexedNodeMap = ({ roots, rootPath }: { roots: readonly ScreenElementIR[]; rootPath: string }): Map<string, ScreenElementIR> => {
  return new Map(buildIndexedNodeRecords({ roots, rootPath }).map((record) => [record.path, record.element] as const));
};

const toParentPath = (path: string): string => {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex <= 0 ? "" : path.slice(0, separatorIndex);
};

const toPathDepth = (path: string): number => path.split("/").filter((segment) => segment.length > 0).length;

const sortRecordEntries = (value: Record<string, string> | undefined): Record<string, string> | undefined => {
  if (!value) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(value).sort((left, right) => left[0].localeCompare(right[0]))
  );
};

const localStructureFingerprint = (element: ScreenElementIR): string => {
  return JSON.stringify({
    name: element.name,
    nodeType: element.nodeType,
    type: element.type,
    semanticType: element.semanticType,
    text: isTextElement(element) ? element.text : undefined,
    layoutMode: element.layoutMode,
    gap: element.gap,
    padding: element.padding,
    variantMapping: element.variantMapping
      ? {
          properties: sortRecordEntries(element.variantMapping.properties),
          muiProps: element.variantMapping.muiProps,
          state: element.variantMapping.state
        }
      : undefined
  });
};

const localStyleFingerprint = (element: ScreenElementIR): string => {
  return JSON.stringify({
    fillColor: element.fillColor,
    fillGradient: element.fillGradient,
    opacity: element.opacity,
    elevation: element.elevation,
    insetShadow: element.insetShadow,
    strokeColor: element.strokeColor,
    strokeWidth: element.strokeWidth,
    cornerRadius: element.cornerRadius,
    fontSize: element.fontSize,
    fontWeight: element.fontWeight,
    fontFamily: element.fontFamily,
    lineHeight: element.lineHeight,
    letterSpacing: element.letterSpacing,
    textAlign: element.textAlign
  });
};

const isFieldElement = (element: ScreenElementIR): boolean => {
  return element.type === "input" || element.type === "select";
};

const toStateKey = (element: ScreenElementIR): string => {
  const sanitized = element.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
  return `${sanitized}_${element.id.replace(/[^a-zA-Z0-9]+/g, "_")}`;
};

const findFirstByNormalizedName = (element: ScreenElementIR, target: string): ScreenElementIR | undefined => {
  const stack = [element];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (normalizeNodeName(current.name).includes(target)) {
      return current;
    }
    for (let index = (current.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      const child = current.children?.[index];
      if (child) {
        stack.push(child);
      }
    }
  }
  return undefined;
};

const inferVisualErrorFromOutline = (element: ScreenElementIR): boolean => {
  const outlineContainer = findFirstByNormalizedName(element, "muioutlinedinputroot") ?? element;
  const outlinedBorderNode = findFirstByNormalizedName(element, "muinotchedoutlined");
  const outlineColor = toRgbaColor(outlinedBorderNode?.strokeColor ?? outlineContainer.strokeColor ?? element.strokeColor);
  return isLikelyErrorRedColor(outlineColor);
};

const resolveNodeMessageText = (element: ScreenElementIR): string | undefined => {
  if (isTextElement(element)) {
    const message = element.text.trim();
    return message.length > 0 ? message : undefined;
  }
  const message = firstText(element)?.trim();
  return message && message.length > 0 ? message : undefined;
};

const isValidationMessageCandidate = (element: ScreenElementIR): boolean => {
  if (isTextElement(element)) {
    return resolveNodeMessageText(element) !== undefined;
  }
  if (element.type === "alert" || element.type === "snackbar") {
    return resolveNodeMessageText(element) !== undefined;
  }
  const normalizedName = normalizeNodeName(element.name);
  return (
    normalizedName.includes("error") ||
    normalizedName.includes("alert") ||
    normalizedName.includes("warning")
  ) && resolveNodeMessageText(element) !== undefined;
};

const isPathWithinSubtree = ({ ancestorPath, candidatePath }: { ancestorPath: string; candidatePath: string }): boolean => {
  return candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}/`);
};

const resolveValidationMessageCandidatesFromAddedRecord = ({
  record,
  memberRecords
}: {
  record: IndexedNodeRecord;
  memberRecords: readonly IndexedNodeRecord[];
}): ValidationMessageCandidate[] | undefined => {
  if (isValidationMessageCandidate(record.element)) {
    const message = resolveNodeMessageText(record.element);
    return message
      ? [
          {
            element: record.element,
            path: record.path,
            message
          }
        ]
      : undefined;
  }

  const subtreeRecords = memberRecords.filter((candidate) =>
    isPathWithinSubtree({ ancestorPath: record.path, candidatePath: candidate.path })
  );
  const descendantCandidates = subtreeRecords
    .filter((candidate) => candidate.path !== record.path)
    .filter((candidate) => isValidationMessageCandidate(candidate.element))
    .map((candidate) => {
      const message = resolveNodeMessageText(candidate.element);
      return message
        ? {
            element: candidate.element,
            path: candidate.path,
            message
          }
        : undefined;
    })
    .filter((candidate): candidate is ValidationMessageCandidate => candidate !== undefined);

  if (descendantCandidates.length === 0) {
    return undefined;
  }

  const candidatePaths = descendantCandidates.map((candidate) => candidate.path);
  const subtreeIsMessageOnly = subtreeRecords.every((candidate) => {
    if (candidate.path === record.path) {
      return true;
    }
    return candidatePaths.some(
      (candidatePath) =>
        isPathWithinSubtree({ ancestorPath: candidate.path, candidatePath }) ||
        isPathWithinSubtree({ ancestorPath: candidatePath, candidatePath: candidate.path })
    );
  });

  return subtreeIsMessageOnly ? descendantCandidates : undefined;
};

const sharesFieldContainer = ({ fieldPath, messagePath }: { fieldPath: string; messagePath: string }): boolean => {
  const fieldParentPath = toParentPath(fieldPath);
  const messageParentPath = toParentPath(messagePath);
  if (fieldParentPath.length > 0 && fieldParentPath === messageParentPath) {
    return true;
  }
  const fieldGrandParentPath = toParentPath(fieldParentPath);
  const messageGrandParentPath = toParentPath(messageParentPath);
  return fieldGrandParentPath.length > 0 && fieldGrandParentPath === messageGrandParentPath;
};

/**
 * Serializes a scenario's `initialState` into a stable signature for matching
 * scenarios across a family. `validationState` is deliberately excluded —
 * this signature is used by `resolveValidationBaselineScenario` to find the
 * non-error counterpart of an error scenario, so including it would prevent
 * the baseline match from ever succeeding.
 */
const resolveInitialStateSignature = ({
  initialState
}: {
  initialState: ScreenVariantFamilyInitialStateIR;
}): string => {
  return JSON.stringify({
    pricingMode: initialState.pricingMode,
    expansionState: initialState.expansionState,
    accordionStateByKey: initialState.accordionStateByKey
      ? Object.fromEntries(
          Object.entries(initialState.accordionStateByKey).sort((left, right) => left[0].localeCompare(right[0]))
        )
      : undefined
  });
};

const screenContentRoots = ({ screen, appShell }: { screen: ScreenIR; appShell: AppShellIR | undefined }): ScreenElementIR[] => {
  if (!screen.appShell || !appShell) {
    return [...screen.children];
  }
  const contentNodeIdSet = new Set(screen.appShell.contentNodeIds);
  return screen.children.filter((child) => contentNodeIdSet.has(child.id));
};

const screenShellRoots = ({ screen, appShell }: { screen: ScreenIR; appShell: AppShellIR | undefined }): ScreenElementIR[] => {
  if (!screen.appShell || !appShell) {
    return [];
  }
  const contentNodeIdSet = new Set(screen.appShell.contentNodeIds);
  return screen.children.filter((child) => !contentNodeIdSet.has(child.id));
};

const contentEqualityFingerprint = (element: ScreenElementIR): string => {
  return JSON.stringify({
    name: element.name,
    nodeType: element.nodeType,
    type: element.type,
    semanticType: element.semanticType,
    text: element.text,
    layoutMode: element.layoutMode,
    gap: element.gap,
    padding: element.padding,
    variantMapping: element.variantMapping
      ? {
          properties: Object.keys(element.variantMapping.properties)
            .sort((left, right) => left.localeCompare(right))
            .reduce<Record<string, string>>((result, key) => {
              result[key] = element.variantMapping?.properties[key] ?? "";
              return result;
            }, {}),
          muiProps: element.variantMapping.muiProps,
          state: element.variantMapping.state
        }
      : undefined,
    children: (element.children ?? []).map(contentEqualityFingerprint)
  });
};

const contentScreensAreEquivalent = ({
  canonicalRoots,
  memberRoots
}: {
  canonicalRoots: readonly ScreenElementIR[];
  memberRoots: readonly ScreenElementIR[];
}): boolean => {
  if (canonicalRoots.length !== memberRoots.length) {
    return false;
  }
  const canonicalFingerprint = canonicalRoots.map(contentEqualityFingerprint);
  const memberFingerprint = memberRoots.map(contentEqualityFingerprint);
  return JSON.stringify(canonicalFingerprint) === JSON.stringify(memberFingerprint);
};

const buildValidationFieldRecords = ({
  canonicalRoots,
  memberRoots
}: {
  canonicalRoots: readonly ScreenElementIR[];
  memberRoots: readonly ScreenElementIR[];
}): ValidationFieldRecord[] => {
  const canonicalRecords = buildIndexedNodeRecords({ roots: canonicalRoots, rootPath: "content" });
  const memberByPath = new Map(buildIndexedNodeRecords({ roots: memberRoots, rootPath: "content" }).map((record) => [record.path, record] as const));
  return canonicalRecords
    .filter((record) => isFieldElement(record.element))
    .map((record) => {
      const memberRecord = memberByPath.get(record.path);
      if (!memberRecord || !isFieldElement(memberRecord.element)) {
        return undefined;
      }
      return {
        canonicalElement: record.element,
        memberElement: memberRecord.element,
        path: record.path,
        fieldKey: toStateKey(record.element)
      } satisfies ValidationFieldRecord;
    })
    .filter((record): record is ValidationFieldRecord => record !== undefined);
};

const resolveFieldMessageAssociation = ({
  candidate,
  changedFields
}: {
  candidate: ValidationMessageCandidate;
  changedFields: readonly ValidationFieldRecord[];
}): ValidationFieldRecord | undefined => {
  if (changedFields.length === 0) {
    return undefined;
  }
  const scopedFields = changedFields.filter((field) => sharesFieldContainer({ fieldPath: field.path, messagePath: candidate.path }));
  const candidateFields = scopedFields.length > 0 ? scopedFields : changedFields;
  const ranked = candidateFields
    .map((field) => ({
      field,
      distance: Math.abs((candidate.element.y ?? 0) - (field.memberElement.y ?? field.canonicalElement.y ?? 0)),
      fieldY: field.memberElement.y ?? field.canonicalElement.y ?? 0,
      pathDepth: toPathDepth(field.path)
    }))
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      if (left.pathDepth !== right.pathDepth) {
        return right.pathDepth - left.pathDepth;
      }
      return left.field.path.localeCompare(right.field.path);
    });
  const nearest = ranked[0];
  const runnerUp = ranked[1];
  if (!nearest) {
    return undefined;
  }
  const candidateY = candidate.element.y;
  const fieldY = nearest.fieldY;
  const fieldHeight = nearest.field.memberElement.height ?? nearest.field.canonicalElement.height ?? 0;
  const isInlineRange =
    candidateY === undefined ||
    (candidateY >= fieldY - VALIDATION_MESSAGE_ABOVE_FIELD_TOLERANCE_PX &&
      candidateY <= fieldY + fieldHeight + VALIDATION_MESSAGE_BELOW_FIELD_TOLERANCE_PX);
  if (!isInlineRange) {
    return undefined;
  }
  if (runnerUp && runnerUp.distance === nearest.distance) {
    return undefined;
  }
  return nearest.field;
};

const extractValidationOnlyDiffEvidence = ({
  canonicalRoots,
  memberRoots
}: {
  canonicalRoots: readonly ScreenElementIR[];
  memberRoots: readonly ScreenElementIR[];
}): ValidationOnlyDiffEvidence => {
  const canonicalRecords = buildIndexedNodeRecords({ roots: canonicalRoots, rootPath: "content" });
  const memberRecords = buildIndexedNodeRecords({ roots: memberRoots, rootPath: "content" });
  const canonicalByPath = new Map(canonicalRecords.map((record) => [record.path, record] as const));
  const memberByPath = new Map(memberRecords.map((record) => [record.path, record] as const));
  const canonicalPaths = new Set(canonicalByPath.keys());
  const memberPaths = new Set(memberByPath.keys());
  const changedFields = new Map<string, ValidationFieldRecord>();
  const messageCandidates: ValidationMessageCandidate[] = [];

  for (const record of buildValidationFieldRecords({ canonicalRoots, memberRoots })) {
    if (!inferVisualErrorFromOutline(record.canonicalElement) && inferVisualErrorFromOutline(record.memberElement)) {
      changedFields.set(record.fieldKey, record);
    }
  }
  const changedFieldPaths = [...changedFields.values()].map((field) => field.path);

  for (const path of [...canonicalPaths].sort((left, right) => left.localeCompare(right))) {
    const canonicalRecord = canonicalByPath.get(path);
    const memberRecord = memberByPath.get(path);
    if (!canonicalRecord) {
      continue;
    }
    if (!memberRecord) {
      return {
        isValidationOnly: false
      };
    }
    const canonicalElement = canonicalRecord.element;
    const memberElement = memberRecord.element;
    if (localStructureFingerprint(canonicalElement) !== localStructureFingerprint(memberElement)) {
      if (
        isTextElement(canonicalElement) &&
        isTextElement(memberElement) &&
        canonicalElement.text.trim() !== memberElement.text.trim() &&
        memberElement.text.trim().length > 0
      ) {
        messageCandidates.push({
          element: memberElement,
          path,
          message: memberElement.text.trim()
        });
        continue;
      }
      return {
        isValidationOnly: false
      };
    }
    if (localStyleFingerprint(canonicalElement) !== localStyleFingerprint(memberElement)) {
      const isChangedFieldSubtree = changedFieldPaths.some(
        (fieldPath) => path === fieldPath || path.startsWith(`${fieldPath}/`)
      );
      if (!(isChangedFieldSubtree || (isFieldElement(canonicalElement) && isFieldElement(memberElement) && inferVisualErrorFromOutline(memberElement)))) {
        return {
          isValidationOnly: false
        };
      }
    }
  }

  const topLevelAddedRecords = memberRecords
    .filter((record) => !canonicalPaths.has(record.path))
    .filter((record) => canonicalPaths.has(toParentPath(record.path)) || !memberPaths.has(toParentPath(record.path)))
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const record of topLevelAddedRecords) {
    const candidates = resolveValidationMessageCandidatesFromAddedRecord({
      record,
      memberRecords
    });
    if (!candidates) {
      return {
        isValidationOnly: false
      };
    }
    messageCandidates.push(...candidates);
  }

  if (messageCandidates.length === 0 && changedFields.size === 0) {
    return {
      isValidationOnly: false
    };
  }

  const fieldErrorEvidenceByFieldKey = new Map<string, ScreenVariantFieldErrorEvidenceIR>();
  for (const [fieldKey, field] of changedFields.entries()) {
    fieldErrorEvidenceByFieldKey.set(fieldKey, {
      message: "",
      visualError: true,
      sourceNodeId: field.memberElement.id
    });
  }

  const screenLevelErrorEvidence: ScreenVariantScreenLevelErrorEvidenceIR[] = [];
  for (const candidate of messageCandidates.sort((left, right) => left.path.localeCompare(right.path))) {
    const matchedField = resolveFieldMessageAssociation({
      candidate,
      changedFields: [...changedFields.values()]
    });
    if (matchedField) {
      const existing = fieldErrorEvidenceByFieldKey.get(matchedField.fieldKey);
      // First-wins: once a field already has a matched message, keep it.
      if (existing && existing.message.length > 0) {
        continue;
      }
      fieldErrorEvidenceByFieldKey.set(matchedField.fieldKey, {
        ...(existing ? { ...existing } : {}),
        message: candidate.message,
        visualError: true,
        sourceNodeId: candidate.element.id
      });
      continue;
    }
    screenLevelErrorEvidence.push({
      message: candidate.message,
      severity: "error",
      sourceNodeId: candidate.element.id
    });
  }

  return {
    isValidationOnly: true,
    ...(fieldErrorEvidenceByFieldKey.size > 0
      ? {
          fieldErrorEvidenceByFieldKey: Object.fromEntries(
            [...fieldErrorEvidenceByFieldKey.entries()].sort((left, right) => left[0].localeCompare(right[0]))
          )
        }
      : {}),
    ...(screenLevelErrorEvidence.length > 0 ? { screenLevelErrorEvidence } : {})
  };
};

const deriveShellTextOverrides = ({
  canonicalScreen,
  memberScreen,
  appShell
}: {
  canonicalScreen: ScreenIR;
  memberScreen: ScreenIR;
  appShell: AppShellIR;
}): Record<string, string> | undefined => {
  const canonicalShellRoots = screenShellRoots({ screen: canonicalScreen, appShell });
  const memberShellRoots = screenShellRoots({ screen: memberScreen, appShell });
  const canonicalIndex = buildIndexedNodeMap({ roots: canonicalShellRoots, rootPath: "shell" });
  const memberIndex = buildIndexedNodeMap({ roots: memberShellRoots, rootPath: "shell" });

  const canonicalPaths = [...canonicalIndex.keys()].sort((left, right) => left.localeCompare(right));
  const memberPaths = [...memberIndex.keys()].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(canonicalPaths) !== JSON.stringify(memberPaths)) {
    return undefined;
  }

  const overrides: Record<string, string> = {};
  for (const nodePath of canonicalPaths) {
    const canonicalNode = canonicalIndex.get(nodePath);
    const memberNode = memberIndex.get(nodePath);
    if (!canonicalNode || !memberNode || canonicalNode.type !== memberNode.type) {
      return undefined;
    }
    if (canonicalNode.type !== "text" || memberNode.type !== "text") {
      continue;
    }
    const canonicalText = canonicalNode.text.trim();
    const memberText = memberNode.text.trim();
    if (canonicalText !== memberText) {
      overrides[canonicalNode.id] = memberText;
    }
  }

  return overrides;
};

const resolveFamilyAppShell = ({
  ir,
  canonicalScreen
}: {
  ir: DesignIR;
  canonicalScreen: ScreenIR;
}): AppShellIR | undefined => {
  const appShellId = canonicalScreen.appShell?.id;
  if (!appShellId) {
    return undefined;
  }
  return ir.appShells?.find((candidate) => candidate.id === appShellId);
};

/**
 * Resolves the non-error baseline scenario against which an error scenario's
 * diff should be measured. Prefers (a) a canonical signature match, then (b)
 * any signature match, then (c) the canonical fallback, then (d) any non-error
 * candidate. The canonical preference ensures determinism across input orderings.
 */
const resolveValidationBaselineScenario = ({
  scenarios,
  scenario,
  canonicalScreenId
}: {
  scenarios: readonly ScreenVariantFamilyScenarioIR[];
  scenario: ScreenVariantFamilyScenarioIR;
  canonicalScreenId: string;
}): ScreenVariantFamilyScenarioIR | undefined => {
  const scenarioStateSignature = resolveInitialStateSignature({
    initialState: scenario.initialState
  });
  const candidates = scenarios.filter(
    (candidate) =>
      candidate.screenId !== scenario.screenId &&
      candidate.initialState.validationState !== "error"
  );
  const signatureMatches = candidates.filter(
    (candidate) => resolveInitialStateSignature({ initialState: candidate.initialState }) === scenarioStateSignature
  );
  const canonicalSignatureMatch = signatureMatches.find((candidate) => candidate.screenId === canonicalScreenId);
  if (canonicalSignatureMatch) {
    return canonicalSignatureMatch;
  }
  if (signatureMatches.length > 0) {
    return signatureMatches[0];
  }
  const canonicalFallback = candidates.find((candidate) => candidate.screenId === canonicalScreenId);
  if (canonicalFallback) {
    return canonicalFallback;
  }
  return candidates[0];
};

const deriveFamily = ({
  ir,
  group,
  canonicalScreen,
  memberScreens,
  axes
}: {
  ir: DesignIR;
  group: FigmaAnalysisFrameVariantGroup;
  canonicalScreen: ScreenIR;
  memberScreens: ScreenIR[];
  axes: ScreenVariantFamilyAxis[];
}): ScreenVariantFamilyIR | undefined => {
  const appShell = resolveFamilyAppShell({ ir, canonicalScreen });
  const canonicalContentRoots = screenContentRoots({ screen: canonicalScreen, appShell });
  const scenarios: ScreenVariantFamilyScenarioIR[] = [];
  const screenById = new Map(memberScreens.map((screen) => [screen.id, screen] as const));

  for (const memberScreenId of group.frameIds) {
    const memberScreen = screenById.get(memberScreenId);
    if (!memberScreen) {
      return undefined;
    }

    let shellTextOverrides: Record<string, string> | undefined;
    if (appShell) {
      shellTextOverrides = deriveShellTextOverrides({
        canonicalScreen,
        memberScreen,
        appShell
      });
      if (shellTextOverrides === undefined) {
        // Shell structure differs between this member and canonical — the family
        // cannot be safely deduplicated because the shell itself has structural
        // differences that cannot be represented as text overrides. Abort family
        // derivation so the screens fall back to independent generation.
        return undefined;
      }
    }

    const memberContentRoots = screenContentRoots({ screen: memberScreen, appShell });
    const contentScreenId = contentScreensAreEquivalent({
      canonicalRoots: canonicalContentRoots,
      memberRoots: memberContentRoots
    })
      ? canonicalScreen.id
      : memberScreen.id;

    const initialState = resolveInitialState({
      screen: memberScreen,
      axes
    });

    scenarios.push({
      screenId: memberScreen.id,
      contentScreenId,
      initialState,
      ...(shellTextOverrides && Object.keys(shellTextOverrides).length > 0 ? { shellTextOverrides } : {})
    });
  }

  const validationOverridesByScreenId = new Map<string, {
    contentScreenId: string;
    fieldErrorEvidenceByFieldKey?: Record<string, ScreenVariantFieldErrorEvidenceIR>;
    screenLevelErrorEvidence?: ScreenVariantScreenLevelErrorEvidenceIR[];
  }>();

  for (const scenario of scenarios) {
    if (scenario.initialState.validationState !== "error") {
      continue;
    }
    const baselineScenario = resolveValidationBaselineScenario({
      scenarios,
      scenario,
      canonicalScreenId: canonicalScreen.id
    });
    if (!baselineScenario) {
      continue;
    }
    const baselineScreen = screenById.get(baselineScenario.screenId);
    const memberScreen = screenById.get(scenario.screenId);
    if (!baselineScreen || !memberScreen) {
      continue;
    }
    const baselineContentRoots = screenContentRoots({ screen: baselineScreen, appShell });
    const memberContentRoots = screenContentRoots({ screen: memberScreen, appShell });
    const validationOnlyDiffEvidence = extractValidationOnlyDiffEvidence({
      canonicalRoots: baselineContentRoots,
      memberRoots: memberContentRoots
    });
    if (!validationOnlyDiffEvidence.isValidationOnly) {
      continue;
    }
    validationOverridesByScreenId.set(scenario.screenId, {
      contentScreenId: baselineScenario.contentScreenId,
      ...(validationOnlyDiffEvidence.fieldErrorEvidenceByFieldKey
        ? { fieldErrorEvidenceByFieldKey: validationOnlyDiffEvidence.fieldErrorEvidenceByFieldKey }
        : {}),
      ...(validationOnlyDiffEvidence.screenLevelErrorEvidence
        ? { screenLevelErrorEvidence: validationOnlyDiffEvidence.screenLevelErrorEvidence }
        : {})
    });
  }

  const finalScenarios: ScreenVariantFamilyScenarioIR[] = scenarios.map((scenario) => {
    const override = validationOverridesByScreenId.get(scenario.screenId);
    if (!override) {
      return scenario;
    }
    return {
      ...scenario,
      contentScreenId: override.contentScreenId,
      ...(override.fieldErrorEvidenceByFieldKey ? { fieldErrorEvidenceByFieldKey: override.fieldErrorEvidenceByFieldKey } : {}),
      ...(override.screenLevelErrorEvidence ? { screenLevelErrorEvidence: override.screenLevelErrorEvidence } : {})
    };
  });

  return {
    familyId: group.groupId,
    canonicalScreenId: canonicalScreen.id,
    memberScreenIds: [...group.frameIds],
    axes,
    scenarios: finalScenarios
  };
};

export const applyScreenVariantFamiliesToDesignIr = ({
  ir,
  figmaAnalysis
}: {
  ir: DesignIR;
  figmaAnalysis: FigmaAnalysis;
}): DesignIR => {
  const baseIr = { ...ir };
  delete baseIr.screenVariantFamilies;

  const screenById = new Map(ir.screens.map((screen) => [screen.id, screen] as const));
  const families: ScreenVariantFamilyIR[] = [];

  for (const group of figmaAnalysis.frameVariantGroups) {
    const axes = group.variantAxes
      .map((axis) => axis.axis)
      .filter((axis): axis is ScreenVariantFamilyAxis => ACTIONABLE_AXIS_SET.has(axis));
    if (axes.length === 0 || group.frameIds.length < 2) {
      continue;
    }

    const canonicalScreen = screenById.get(group.canonicalFrameId);
    if (!canonicalScreen) {
      continue;
    }

    const memberScreens = group.frameIds
      .map((frameId) => screenById.get(frameId))
      .filter((screen): screen is ScreenIR => screen !== undefined);
    if (memberScreens.length !== group.frameIds.length) {
      continue;
    }

    const family = deriveFamily({
      ir,
      group,
      canonicalScreen,
      memberScreens,
      axes
    });
    if (family) {
      families.push(family);
    }
  }

  return {
    ...baseIr,
    ...(families.length > 0 ? { screenVariantFamilies: families } : {})
  };
};
