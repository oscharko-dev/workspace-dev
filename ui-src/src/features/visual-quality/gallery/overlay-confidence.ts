import type { ConfidenceLevel } from "../data/types";

export const CONFIDENCE_OVERLAY_COLORS: Record<ConfidenceLevel, string> = {
  high: "rgba(34, 197, 94, 0.2)",
  medium: "rgba(234, 179, 8, 0.2)",
  low: "rgba(249, 115, 22, 0.3)",
  very_low: "rgba(239, 68, 68, 0.4)",
};

export const CONFIDENCE_OVERLAY_BORDERS: Record<ConfidenceLevel, string> = {
  high: "rgba(34, 197, 94, 0.6)",
  medium: "rgba(234, 179, 8, 0.6)",
  low: "rgba(249, 115, 22, 0.6)",
  very_low: "rgba(239, 68, 68, 0.8)",
};
