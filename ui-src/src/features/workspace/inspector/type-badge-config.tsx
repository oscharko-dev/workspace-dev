/**
 * Shared element type badge configuration and component.
 *
 * Extracted from component-tree.tsx so that both the ComponentTree
 * and the Breadcrumb can use consistent type badges.
 */
import type { JSX } from "react";

export const TYPE_LABELS: Record<string, { abbr: string; color: string }> = {
  text: { abbr: "T", color: "bg-blue-100 text-blue-700" },
  button: { abbr: "B", color: "bg-emerald-100 text-emerald-700" },
  input: { abbr: "In", color: "bg-amber-100 text-amber-700" },
  image: { abbr: "Im", color: "bg-violet-100 text-violet-700" },
  container: { abbr: "C", color: "bg-slate-100 text-slate-600" },
  card: { abbr: "Cd", color: "bg-rose-100 text-rose-700" },
  appbar: { abbr: "Ab", color: "bg-indigo-100 text-indigo-700" },
  grid: { abbr: "G", color: "bg-cyan-100 text-cyan-700" },
  stack: { abbr: "S", color: "bg-teal-100 text-teal-700" },
  list: { abbr: "L", color: "bg-orange-100 text-orange-700" },
  table: { abbr: "Tb", color: "bg-pink-100 text-pink-700" },
  chip: { abbr: "Ch", color: "bg-fuchsia-100 text-fuchsia-700" },
  avatar: { abbr: "Av", color: "bg-lime-100 text-lime-700" },
  badge: { abbr: "Bg", color: "bg-yellow-100 text-yellow-700" },
  divider: { abbr: "D", color: "bg-gray-100 text-gray-500" },
  navigation: { abbr: "N", color: "bg-sky-100 text-sky-700" },
  dialog: { abbr: "Dl", color: "bg-purple-100 text-purple-700" },
  drawer: { abbr: "Dr", color: "bg-indigo-100 text-indigo-600" },
  tab: { abbr: "Tb", color: "bg-emerald-100 text-emerald-600" },
  select: { abbr: "Se", color: "bg-amber-100 text-amber-600" },
  switch: { abbr: "Sw", color: "bg-teal-100 text-teal-600" },
  checkbox: { abbr: "Cx", color: "bg-blue-100 text-blue-600" },
  radio: { abbr: "Ra", color: "bg-violet-100 text-violet-600" },
  slider: { abbr: "Sl", color: "bg-cyan-100 text-cyan-600" },
  rating: { abbr: "Rt", color: "bg-yellow-100 text-yellow-600" },
  tooltip: { abbr: "Tt", color: "bg-slate-100 text-slate-700" },
  snackbar: { abbr: "Sn", color: "bg-orange-100 text-orange-600" },
  stepper: { abbr: "St", color: "bg-indigo-100 text-indigo-600" },
  progress: { abbr: "P", color: "bg-blue-100 text-blue-600" },
  skeleton: { abbr: "Sk", color: "bg-gray-100 text-gray-500" },
  breadcrumbs: { abbr: "Bc", color: "bg-slate-100 text-slate-600" },
  paper: { abbr: "Pa", color: "bg-stone-100 text-stone-600" }
};

export function TypeBadge({ type }: { type: string }): JSX.Element {
  const config = TYPE_LABELS[type];
  const abbr = config?.abbr ?? type.slice(0, 2).toUpperCase();
  const color = config?.color ?? "bg-slate-100 text-slate-600";

  return (
    <span
      className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded px-0.5 text-[9px] font-bold leading-none ${color}`}
      title={type}
    >
      {abbr}
    </span>
  );
}
