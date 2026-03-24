/**
 * Diagnostic badge component for node-level inspectability diagnostics.
 *
 * Renders a small color-coded badge next to a tree node to indicate
 * the diagnostic category (hidden, placeholder, truncated, etc.).
 */
import type { JSX } from "react";
import {
  getNodeDiagnosticBadge,
  type NodeDiagnosticCategory
} from "./node-diagnostics";

interface DiagnosticBadgeProps {
  category: NodeDiagnosticCategory;
}

export function DiagnosticBadge({ category }: DiagnosticBadgeProps): JSX.Element {
  const badge = getNodeDiagnosticBadge(category);

  return (
    <span
      data-testid={`diagnostic-badge-${category}`}
      className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-0.5 text-[9px] font-bold leading-none ${badge.color}`}
      title={badge.title}
      aria-label={badge.title}
    >
      {badge.abbr}
    </span>
  );
}
