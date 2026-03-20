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

// ── Depth-pressure analysis (ir-tree.ts) ───────────────────────────────────

/** Semantic density above which the higher pressure multiplier is used. */
export const DEPTH_HIGH_SEMANTIC_DENSITY_THRESHOLD = 0.25;

/** Budget-to-node-count multiplier when semantic density exceeds the high threshold. */
export const DEPTH_HIGH_DENSITY_PRESSURE_MULTIPLIER = 6;

/** Budget-to-node-count multiplier when semantic density is at or below the high threshold. */
export const DEPTH_LOW_DENSITY_PRESSURE_MULTIPLIER = 4;

/** Minimum node-count floor for high-pressure cutoff calculation. */
export const DEPTH_MIN_NODE_COUNT_FLOOR = 32;

/** Semantic density above which the wider semantic-depth multiplier is used. */
export const DEPTH_SEMANTIC_WIDTH_DENSITY_THRESHOLD = 0.15;

/** Multiplier for allowed semantic depth width when density exceeds the width threshold. */
export const DEPTH_HIGH_DENSITY_WIDTH_MULTIPLIER = 3;

/** Multiplier for allowed semantic depth width when density is at or below the width threshold. */
export const DEPTH_LOW_DENSITY_WIDTH_MULTIPLIER = 2;

/** Minimum allowed semantic depth width floor. */
export const DEPTH_MIN_SEMANTIC_WIDTH = 12;

// ── Classification geometry thresholds (ir-classification.ts) ──────────────

/** Minimum corner radius (px) to classify a node as having rounded corners. */
export const ROUNDED_CORNER_RADIUS_MIN = 8;

/** Minimum width (px) for a node to be considered field-sized (input/select). */
export const FIELD_MIN_WIDTH = 96;

/** Minimum height (px) for a node to be considered field-sized. */
export const FIELD_MIN_HEIGHT = 28;

/** Maximum height (px) for a node to be considered field-sized. */
export const FIELD_MAX_HEIGHT = 140;

/** Minimum length (px) along the long axis for divider detection. */
export const DIVIDER_MIN_LENGTH = 16;

/** Maximum thickness (px) along the short axis for divider detection. */
export const DIVIDER_MAX_THICKNESS = 2;

/** Minimum children in a row/cell for table row-cell structure detection. */
export const TABLE_ROW_CELL_MIN_CHILDREN = 2;

/** Minimum width (px) for structural table classification. */
export const TABLE_MIN_WIDTH = 180;

/** Pixel threshold for position-bucket grouping (row/column detection). */
export const POSITION_BUCKET_THRESHOLD = 18;

/** Minimum child count for grid structural classification. */
export const GRID_MIN_CHILDREN = 4;

/** Minimum row buckets for grid classification. */
export const GRID_MIN_ROW_BUCKETS = 2;

/** Minimum column buckets for grid classification. */
export const GRID_MIN_COLUMN_BUCKETS = 2;

/** Minimum child count for list structural classification. */
export const LIST_MIN_CHILDREN = 3;

/** Minimum text-bearing children for list classification. */
export const LIST_MIN_TEXT_CHILDREN = 2;

/** Minimum width (px) for card geometry classification. */
export const CARD_MIN_WIDTH = 120;

/** Minimum height (px) for card geometry classification. */
export const CARD_MIN_HEIGHT = 80;

/** Minimum table structure child count. */
export const TABLE_MIN_CHILDREN = 2;

// ── CSS Grid detection (generator-render.ts) ──────────────────────────────

/** Minimum ratio by which a child must exceed the average column width to be considered spanning. */
export const CSS_GRID_SPAN_WIDTH_RATIO = 1.6;

/** Minimum ratio by which a child must exceed the average row height to be considered row-spanning. */
export const CSS_GRID_SPAN_HEIGHT_RATIO = 1.6;

/** Coefficient of variation threshold above which column widths are considered asymmetric. */
export const CSS_GRID_ASYMMETRIC_CV_THRESHOLD = 0.25;

/** Minimum number of children required for CSS Grid detection. */
export const CSS_GRID_MIN_CHILDREN = 3;

// Note: MUI default breakpoint values are maintained in generator-responsive.ts
// as MUI_DEFAULT_BREAKPOINT_VALUES to avoid import cycles.
