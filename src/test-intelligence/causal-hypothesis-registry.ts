/**
 * Causal-hypothesis registry (Issue #2180).
 *
 * The registry derives the catalog of {@link CausalHypothesis} the
 * causal-validation framework evaluates against the generated suite.
 * Hypotheses are obtained from two sources:
 *
 *   1. **Domain invariants** (Issue #2040 / #2108). Each registered
 *      invariant in {@link DomainInvariantRegistry} that has a known
 *      causal projection contributes one or more hypotheses through a
 *      built-in mapping table. The mapping is intentionally explicit
 *      (one row per invariant id) rather than parsing the predicate
 *      bodies — predicate bodies are arbitrary TypeScript closures and
 *      cannot be introspected reliably.
 *
 *   2. **Operator-declared** hypotheses. Operators may load a fixture
 *      file via {@link loadOperatorHypotheses} that adds extra
 *      hypotheses scoped to their dataset (e.g. an internal "field X
 *      does not affect field Y" claim drawn from a banking
 *      requirement document).
 *
 * Identifiers
 *
 *   - {@link SemanticFieldId} is a branded string of the canonical
 *     form `${screenId}#${elementId}`. The registry uses the
 *     {@link TestDesignModel} to resolve hypothesis fields against
 *     real screens / elements; hypotheses that reference unknown
 *     screens or elements are rejected with `E_INVALID_FIELD_ID` so
 *     stale operator fixtures fail loudly.
 *
 *   - Hypothesis ids follow `H-{sourceTag}-{seq}` where `sourceTag` is
 *     either the originating invariant id (for invariant-derived
 *     hypotheses) or `OP` (for operator-declared). Sequence numbers
 *     are deterministic given the input order.
 *
 * Determinism
 *
 *   The registry is pure and deterministic. Identical
 *   `(invariants, model, operatorHypotheses)` tuples produce
 *   byte-identical output, including hypothesis ordering. The output
 *   list is sorted by `hypothesisId` to keep downstream artifacts
 *   replay-stable.
 */

import type { TestDesignModel } from "../contracts/index.js";
import type {
  DomainInvariant,
  DomainInvariantRegistry,
} from "./domain-invariant-registry.js";

/* -------------------------------------------------------------------- */
/*  Branded SemanticFieldId                                              */
/* -------------------------------------------------------------------- */

/**
 * Opaque identifier for a single semantic field within a
 * {@link TestDesignModel}. Encoded as `${screenId}#${elementId}`.
 *
 * Constructed via {@link semanticFieldId} — never assemble the string
 * directly; the brand is the contract.
 */
export type SemanticFieldId = string & { readonly __brand: "SemanticFieldId" };

const SEMANTIC_FIELD_ID_RE =
  /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}#[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/**
 * Construct a {@link SemanticFieldId} from a `(screenId, elementId)`
 * pair. Both arguments must match `[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}`
 * and may not contain `#` (the canonical separator).
 */
export const semanticFieldId = (
  screenId: string,
  elementId: string,
): SemanticFieldId => {
  if (screenId.includes("#") || elementId.includes("#")) {
    throw new CausalValidationFrameworkError(
      "E_INVALID_FIELD_ID",
      `causal-hypothesis-registry: semanticFieldId components must not contain '#' (got screenId="${screenId}", elementId="${elementId}").`,
    );
  }
  const id = `${screenId}#${elementId}`;
  if (!SEMANTIC_FIELD_ID_RE.test(id)) {
    throw new CausalValidationFrameworkError(
      "E_INVALID_FIELD_ID",
      `causal-hypothesis-registry: invalid SemanticFieldId "${id}" — components must be 1–128 chars of [A-Za-z0-9_.:-] and start with [A-Za-z0-9].`,
    );
  }
  return id as SemanticFieldId;
};

/**
 * Read a {@link SemanticFieldId} back into its `(screenId, elementId)`
 * components. Throws `E_INVALID_FIELD_ID` for malformed input so
 * downstream code never has to defend against partial parses.
 */
export const parseSemanticFieldId = (
  fieldId: SemanticFieldId,
): { readonly screenId: string; readonly elementId: string } => {
  if (!SEMANTIC_FIELD_ID_RE.test(fieldId)) {
    throw new CausalValidationFrameworkError(
      "E_INVALID_FIELD_ID",
      `causal-hypothesis-registry: SemanticFieldId "${fieldId}" does not match the canonical "<screenId>#<elementId>" form.`,
    );
  }
  const idx = fieldId.indexOf("#");
  return {
    screenId: fieldId.slice(0, idx),
    elementId: fieldId.slice(idx + 1),
  };
};

/* -------------------------------------------------------------------- */
/*  Stable error class                                                   */
/* -------------------------------------------------------------------- */

/**
 * Stable error codes thrown by the causal-hypothesis registry **and**
 * by the causal-validation framework. Surfacing them through a single
 * error class keeps the operator-facing error vocabulary small and
 * lets callers branch on `error.code` without string-matching message
 * text.
 */
export type CausalValidationErrorCode =
  | "E_INVALID_HYPOTHESIS"
  | "E_INVALID_FIELD_ID"
  | "E_NO_BVA_VARIATION"
  | "E_INVALID_SEED";

export class CausalValidationFrameworkError extends Error {
  readonly code: CausalValidationErrorCode;
  constructor(code: CausalValidationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CausalValidationFrameworkError";
  }
}

/* -------------------------------------------------------------------- */
/*  CausalHypothesis types                                               */
/* -------------------------------------------------------------------- */

/**
 * Closed set of supported causal-relationship kinds. Each kind has a
 * dedicated effect-assertion shape:
 *
 *   - `no-effect`         — toggling the cause MUST NOT change the
 *                            effect field's value.
 *   - `monotonic-up`      — increasing the cause MUST NOT decrease the
 *                            effect field's value (and vice versa).
 *   - `monotonic-down`    — increasing the cause MUST NOT increase the
 *                            effect field's value.
 *   - `linear`            — the effect field changes by a constant
 *                            multiple of the cause delta. The framework
 *                            asserts the *sign* of the change matches;
 *                            exact slope verification is out of scope
 *                            for the harness layer.
 *   - `discrete-mapping`  — the cause maps each enumerated value to a
 *                            distinct effect value (or a tuple). Used
 *                            for category-style fields.
 */
export type CausalRelationship =
  | "no-effect"
  | "monotonic-up"
  | "monotonic-down"
  | "linear"
  | "discrete-mapping";

/** Source provenance for a {@link CausalHypothesis}. */
export type CausalHypothesisSource =
  | { readonly kind: "domain-invariant"; readonly invariantId: string }
  | { readonly kind: "operator-declared"; readonly declaredAt: string };

/**
 * One typed causal hypothesis. The framework evaluates exactly one
 * effect-assertion per hypothesis per generated counterfactual pair.
 */
export interface CausalHypothesis {
  readonly hypothesisId: string;
  readonly cause: SemanticFieldId;
  readonly effect: SemanticFieldId;
  readonly relationship: CausalRelationship;
  readonly source: CausalHypothesisSource;
  /**
   * Optional human-readable rationale surfaced verbatim into the
   * persisted causal-validation report. Always populated for
   * invariant-derived hypotheses (mirrors the invariant's
   * `description`); operator-declared hypotheses may omit it.
   */
  readonly rationale?: string;
}

/* -------------------------------------------------------------------- */
/*  Invariant → Hypothesis catalog                                       */
/* -------------------------------------------------------------------- */

/**
 * Field-resolution descriptor used by the catalog rows below. Each
 * cause / effect side is described by a label-substring matcher so the
 * catalog stays decoupled from elementId conventions across the active
 * datasets — different banking masks reuse the same semantic field
 * (e.g. "VAT-rate") under varying elementIds.
 */
interface CatalogFieldDescriptor {
  /**
   * Lowercase substrings the resolver matches against
   * `TestDesignElement.label`. The first matching element on any
   * screen is selected; the catalog row is **skipped** when no element
   * matches (the dataset does not contain the relevant field).
   */
  readonly labelAnyOf: readonly string[];
  /**
   * Optional element-kind constraint (e.g. `"select"`,
   * `"number_input"`). When present the resolver requires the
   * element's `kind` to start with one of the listed prefixes.
   */
  readonly kindPrefixes?: readonly string[];
}

interface CatalogRow {
  readonly invariantId: string;
  readonly cause: CatalogFieldDescriptor;
  readonly effect: CatalogFieldDescriptor;
  readonly relationship: CausalRelationship;
}

/**
 * Catalog mapping each known domain-invariant id to one or more
 * causal hypotheses. The catalog is intentionally append-only and
 * narrow — only invariants with a clear, single-field cause / single-
 * field effect projection appear here. Invariants whose semantics are
 * cross-cutting (e.g. AML aggregation, compliance documentation
 * presence) are NOT projected; they remain validated by the invariant
 * pipeline directly and would only contribute noise to the causal
 * coverage KPI.
 */
const INVARIANT_HYPOTHESIS_CATALOG: readonly CatalogRow[] = [
  {
    // INV-VAT-01: VAT rate must not affect financing-need result.
    invariantId: "INV-VAT-01",
    cause: {
      labelAnyOf: ["vat", "mwst", "mehrwertsteuer", "umsatzsteuer"],
      kindPrefixes: ["select", "dropdown", "combobox", "radio"],
    },
    effect: {
      labelAnyOf: [
        "financing need",
        "finance need",
        "loan amount",
        "funding need",
        "finanzierungsbedarf",
      ],
    },
    relationship: "no-effect",
  },
  {
    // INV-FINANCING-NEED-01: financing-need monotonic-up in price input.
    invariantId: "INV-FINANCING-NEED-01",
    cause: {
      labelAnyOf: ["kaufpreis", "purchase price", "price", "amount"],
      kindPrefixes: ["number", "currency", "input"],
    },
    effect: {
      labelAnyOf: [
        "financing need",
        "finance need",
        "loan amount",
        "funding need",
        "finanzierungsbedarf",
      ],
    },
    relationship: "monotonic-up",
  },
  {
    // INV-SOLVENCY2-COOLOFF-01: long-term insurance contracts always
    // expose a cooling-off period regardless of premium amount, so
    // changing the premium does not affect the cooling-off flag.
    invariantId: "INV-SOLVENCY2-COOLOFF-01",
    cause: {
      labelAnyOf: ["premium", "prämie", "praemie", "beitrag"],
      kindPrefixes: ["number", "currency", "input"],
    },
    effect: {
      labelAnyOf: [
        "cooling-off",
        "widerruf",
        "widerrufsrecht",
        "withdrawal period",
      ],
    },
    relationship: "no-effect",
  },
  {
    // INV-IDD-DEMANDS-01: a demands-and-needs analysis must not be
    // skipped because the customer raised the requested coverage. The
    // analysis presence is independent of coverage amount.
    invariantId: "INV-IDD-DEMANDS-01",
    cause: {
      labelAnyOf: ["coverage", "deckung", "versicherungssumme", "sum insured"],
      kindPrefixes: ["number", "currency", "input"],
    },
    effect: {
      labelAnyOf: [
        "demands and needs",
        "wünsche und bedürfnisse",
        "bedarfsanalyse",
        "needs analysis",
      ],
    },
    relationship: "no-effect",
  },
];

/* -------------------------------------------------------------------- */
/*  Hypothesis derivation                                                */
/* -------------------------------------------------------------------- */

const lowerIncludes = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.toLowerCase().includes(needle));

const findFieldByDescriptor = (
  model: TestDesignModel,
  descriptor: CatalogFieldDescriptor,
): { readonly screenId: string; readonly elementId: string } | undefined => {
  for (const screen of model.screens) {
    for (const element of screen.elements) {
      if (!lowerIncludes(element.label, descriptor.labelAnyOf)) continue;
      if (descriptor.kindPrefixes !== undefined) {
        const kind = element.kind.toLowerCase();
        if (!descriptor.kindPrefixes.some((prefix) => kind.startsWith(prefix))) {
          continue;
        }
      }
      return { screenId: screen.screenId, elementId: element.elementId };
    }
  }
  return undefined;
};

const validateOperatorHypothesis = (
  hypothesis: CausalHypothesis,
  model: TestDesignModel,
): void => {
  const cause = parseSemanticFieldId(hypothesis.cause);
  const effect = parseSemanticFieldId(hypothesis.effect);
  const screenIds = new Set(model.screens.map((screen) => screen.screenId));
  const elementIds = new Map<string, Set<string>>();
  for (const screen of model.screens) {
    elementIds.set(
      screen.screenId,
      new Set(screen.elements.map((element) => element.elementId)),
    );
  }
  for (const side of [
    { kind: "cause" as const, ref: cause },
    { kind: "effect" as const, ref: effect },
  ]) {
    if (!screenIds.has(side.ref.screenId)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_FIELD_ID",
        `causal-hypothesis-registry: ${side.kind} field of hypothesis "${hypothesis.hypothesisId}" references unknown screenId "${side.ref.screenId}".`,
      );
    }
    if (!elementIds.get(side.ref.screenId)?.has(side.ref.elementId)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_FIELD_ID",
        `causal-hypothesis-registry: ${side.kind} field of hypothesis "${hypothesis.hypothesisId}" references unknown elementId "${side.ref.elementId}" on screen "${side.ref.screenId}".`,
      );
    }
  }
  if (hypothesis.cause === hypothesis.effect) {
    throw new CausalValidationFrameworkError(
      "E_INVALID_HYPOTHESIS",
      `causal-hypothesis-registry: hypothesis "${hypothesis.hypothesisId}" has identical cause and effect fields; a self-referential hypothesis is not valid.`,
    );
  }
};

export interface BuildCausalHypothesisRegistryInput {
  /** Domain-invariant entries (typically `registry.list()`). */
  readonly invariants: readonly DomainInvariant[];
  /** Active dataset model — required for field-id resolution. */
  readonly model: TestDesignModel;
  /** Optional operator-declared hypotheses (already-typed). */
  readonly operatorHypotheses?: readonly CausalHypothesis[];
}

/**
 * Build the deterministic catalog of {@link CausalHypothesis}
 * applicable to a given model. The output list is sorted by
 * `hypothesisId` so downstream artifacts are byte-stable.
 *
 * Invariant-derived rows are emitted with id
 * `H-{INVARIANT_ID}-001` (one hypothesis per row); operator-declared
 * hypotheses keep their caller-supplied id.
 */
export const buildCausalHypothesisRegistry = (
  input: BuildCausalHypothesisRegistryInput,
): readonly CausalHypothesis[] => {
  const out: CausalHypothesis[] = [];
  const seenIds = new Set<string>();
  const invariantById = new Map<string, DomainInvariant>();
  for (const invariant of input.invariants) {
    invariantById.set(invariant.id, invariant);
  }
  for (const row of INVARIANT_HYPOTHESIS_CATALOG) {
    const invariant = invariantById.get(row.invariantId);
    if (invariant === undefined) continue;
    const causeRef = findFieldByDescriptor(input.model, row.cause);
    if (causeRef === undefined) continue;
    const effectRef = findFieldByDescriptor(input.model, row.effect);
    if (effectRef === undefined) continue;
    const cause = semanticFieldId(causeRef.screenId, causeRef.elementId);
    const effect = semanticFieldId(effectRef.screenId, effectRef.elementId);
    if (cause === effect) continue;
    const hypothesisId = `H-${row.invariantId}-001`;
    if (seenIds.has(hypothesisId)) continue;
    seenIds.add(hypothesisId);
    out.push({
      hypothesisId,
      cause,
      effect,
      relationship: row.relationship,
      source: { kind: "domain-invariant", invariantId: row.invariantId },
      rationale: invariant.description,
    });
  }
  for (const operatorHypothesis of input.operatorHypotheses ?? []) {
    if (seenIds.has(operatorHypothesis.hypothesisId)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis id "${operatorHypothesis.hypothesisId}" collides with an existing entry.`,
      );
    }
    validateOperatorHypothesis(operatorHypothesis, input.model);
    seenIds.add(operatorHypothesis.hypothesisId);
    out.push(operatorHypothesis);
  }
  out.sort((left, right) =>
    left.hypothesisId.localeCompare(right.hypothesisId),
  );
  return out;
};

/**
 * Convenience overload that takes a {@link DomainInvariantRegistry}
 * directly and forwards `registry.list()` to
 * {@link buildCausalHypothesisRegistry}.
 */
export const buildCausalHypothesisRegistryFromRegistry = (input: {
  readonly registry: DomainInvariantRegistry;
  readonly model: TestDesignModel;
  readonly operatorHypotheses?: readonly CausalHypothesis[];
}): readonly CausalHypothesis[] =>
  buildCausalHypothesisRegistry({
    invariants: input.registry.list(),
    model: input.model,
    ...(input.operatorHypotheses !== undefined
      ? { operatorHypotheses: input.operatorHypotheses }
      : {}),
  });

/* -------------------------------------------------------------------- */
/*  Operator fixture loader                                              */
/* -------------------------------------------------------------------- */

const ALLOWED_RELATIONSHIPS: ReadonlySet<CausalRelationship> = new Set([
  "no-effect",
  "monotonic-up",
  "monotonic-down",
  "linear",
  "discrete-mapping",
]);

const HYPOTHESIS_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

const requireString = (
  value: unknown,
  context: string,
): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new CausalValidationFrameworkError(
      "E_INVALID_HYPOTHESIS",
      `causal-hypothesis-registry: ${context} must be a non-empty string.`,
    );
  }
  return value;
};

/**
 * Validate + coerce an `unknown` payload (typically `JSON.parse` of a
 * fixture file) into a list of {@link CausalHypothesis}. The loader
 * accepts either:
 *
 *   - a top-level array of hypothesis objects, or
 *   - an envelope `{ hypotheses: [...] }`.
 *
 * Each hypothesis must carry `hypothesisId`, `cause`, `effect`,
 * `relationship`, and `source.kind === "operator-declared"` with an
 * ISO-8601 `declaredAt` timestamp. Rejects malformed entries with
 * `E_INVALID_HYPOTHESIS` so stale fixtures fail loudly at load time.
 */
export const loadOperatorHypotheses = (
  payload: unknown,
): readonly CausalHypothesis[] => {
  let entries: unknown[];
  if (Array.isArray(payload)) {
    entries = payload;
  } else if (isPlainObject(payload) && Array.isArray(payload["hypotheses"])) {
    entries = payload["hypotheses"];
  } else {
    throw new CausalValidationFrameworkError(
      "E_INVALID_HYPOTHESIS",
      `causal-hypothesis-registry: operator hypothesis payload must be an array or an object with a "hypotheses" array.`,
    );
  }
  const out: CausalHypothesis[] = [];
  const seen = new Set<string>();
  for (const [idx, entry] of entries.entries()) {
    if (!isPlainObject(entry)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis at index ${idx} is not an object.`,
      );
    }
    const hypothesisId = requireString(
      entry["hypothesisId"],
      `operator hypothesis at index ${idx} field "hypothesisId"`,
    );
    if (!HYPOTHESIS_ID_RE.test(hypothesisId)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis id "${hypothesisId}" must match ${HYPOTHESIS_ID_RE.source}.`,
      );
    }
    if (seen.has(hypothesisId)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis id "${hypothesisId}" appears more than once in the payload.`,
      );
    }
    seen.add(hypothesisId);
    const causeRaw = requireString(
      entry["cause"],
      `operator hypothesis "${hypothesisId}" field "cause"`,
    );
    const effectRaw = requireString(
      entry["effect"],
      `operator hypothesis "${hypothesisId}" field "effect"`,
    );
    const cause = causeRaw.includes("#")
      ? (causeRaw as SemanticFieldId)
      : (() => {
          throw new CausalValidationFrameworkError(
            "E_INVALID_HYPOTHESIS",
            `causal-hypothesis-registry: operator hypothesis "${hypothesisId}" cause "${causeRaw}" is not in canonical "<screenId>#<elementId>" form.`,
          );
        })();
    const effect = effectRaw.includes("#")
      ? (effectRaw as SemanticFieldId)
      : (() => {
          throw new CausalValidationFrameworkError(
            "E_INVALID_HYPOTHESIS",
            `causal-hypothesis-registry: operator hypothesis "${hypothesisId}" effect "${effectRaw}" is not in canonical "<screenId>#<elementId>" form.`,
          );
        })();
    parseSemanticFieldId(cause);
    parseSemanticFieldId(effect);
    const relationship = requireString(
      entry["relationship"],
      `operator hypothesis "${hypothesisId}" field "relationship"`,
    ) as CausalRelationship;
    if (!ALLOWED_RELATIONSHIPS.has(relationship)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis "${hypothesisId}" relationship "${relationship}" is not one of [${[...ALLOWED_RELATIONSHIPS].join(", ")}].`,
      );
    }
    const sourceRaw = entry["source"];
    if (!isPlainObject(sourceRaw)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis "${hypothesisId}" must declare a "source" object.`,
      );
    }
    if (sourceRaw["kind"] !== "operator-declared") {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis "${hypothesisId}" source.kind must be "operator-declared" (got "${String(sourceRaw["kind"])}").`,
      );
    }
    const declaredAt = requireString(
      sourceRaw["declaredAt"],
      `operator hypothesis "${hypothesisId}" source.declaredAt`,
    );
    if (!ISO_TIMESTAMP_RE.test(declaredAt)) {
      throw new CausalValidationFrameworkError(
        "E_INVALID_HYPOTHESIS",
        `causal-hypothesis-registry: operator hypothesis "${hypothesisId}" source.declaredAt "${declaredAt}" is not an ISO-8601 UTC timestamp.`,
      );
    }
    const rationale =
      typeof entry["rationale"] === "string" && entry["rationale"].length > 0
        ? entry["rationale"]
        : undefined;
    const hypothesis: CausalHypothesis = {
      hypothesisId,
      cause,
      effect,
      relationship,
      source: { kind: "operator-declared", declaredAt },
      ...(rationale !== undefined ? { rationale } : {}),
    };
    out.push(hypothesis);
  }
  return out;
};
