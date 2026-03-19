/**
 * Centralized pipeline constants.
 *
 * Extracted from scattered magic numbers across the code generation pipeline
 * to improve discoverability, consistency, and tunability.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/303
 */

// ── Tree traversal & budget ─────────────────────────────────────────────────

/** Maximum number of elements to retain per screen after budget pruning. */
export const DEFAULT_SCREEN_ELEMENT_BUDGET = 1_200;

/** Maximum nesting depth before tree traversal stops descending. */
export const DEFAULT_SCREEN_ELEMENT_MAX_DEPTH = 14;

// ── Pattern extraction ──────────────────────────────────────────────────────

/** Minimum Jaccard-like similarity score to consider two subtrees as the same pattern. */
export const PATTERN_SIMILARITY_THRESHOLD = 0.8;

/** Minimum number of occurrences before a repeated subtree is extracted into a shared component. */
export const PATTERN_MIN_OCCURRENCES = 3;

/** Minimum number of nodes in a subtree for it to qualify as an extraction candidate. */
export const PATTERN_MIN_SUBTREE_NODE_COUNT = 3;

// ── Theme sx extraction ─────────────────────────────────────────────────────

/** Minimum ratio of identical sx values across samples to extract into the theme. */
export const THEME_SX_EXTRACTION_THRESHOLD = 0.7;

/** Minimum number of component samples required before theme sx extraction is attempted. */
export const THEME_SX_MIN_SAMPLES = 3;

// ── Typography & heading detection ──────────────────────────────────────────

/** Font size (px) at or above which text is classified as a heading. */
export const HEADING_FONT_SIZE_MIN = 20;

/** Font weight at or above which text is classified as a heading. */
export const HEADING_FONT_WEIGHT_MIN = 650;

/** Font size (px) at or above which text is considered a large heading (combined with weight). */
export const LARGE_HEADING_FONT_SIZE_MIN = 24;

/** Font weight used alongside LARGE_HEADING_FONT_SIZE_MIN for combined heading detection. */
export const LARGE_HEADING_FONT_WEIGHT_MIN = 600;

/** Line height multiplier for heading text when no explicit value exists. */
export const HEADING_LINE_HEIGHT_MULTIPLIER = 1.3;

/** Line height multiplier for body text when no explicit value exists. */
export const BODY_LINE_HEIGHT_MULTIPLIER = 1.5;

/** Base font size (px) used for prominence weight calculation (REM equivalent). */
export const REM_BASE_FONT_SIZE = 16;

/** Ratio of uppercase characters required to classify text as ALL CAPS. */
export const UPPERCASE_DETECTION_RATIO = 0.8;

// ── Spacing & layout ────────────────────────────────────────────────────────

/** Default spacing base unit (px) for MUI theme spacing calculations. */
export const DEFAULT_SPACING_BASE = 8;

// ── Geometry weights ────────────────────────────────────────────────────────

/** Divisor for text-width based prominence weight in heading/body context. */
export const TEXT_WIDTH_PROMINENCE_DIVISOR = 160;

/** Divisor for area-based geometry weight calculation. */
export const AREA_GEOMETRY_WEIGHT_DIVISOR = 120;

// ── Accessibility ───────────────────────────────────────────────────────────

/** WCAG AA minimum contrast ratio for normal-sized text. */
export const WCAG_AA_NORMAL_TEXT_CONTRAST_MIN = 4.5;

// Note: MUI default breakpoint values are maintained in generator-responsive.ts
// as MUI_DEFAULT_BREAKPOINT_VALUES to avoid import cycles.
