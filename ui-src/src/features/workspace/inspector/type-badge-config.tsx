/**
 * Shared element type badge configuration and component.
 *
 * Extracted from component-tree.tsx so that both the ComponentTree
 * and the Breadcrumb can use consistent type badges.
 */
import type { JSX } from "react";

export const TYPE_LABELS: Record<string, { abbr: string; color: string }> = {
  text: { abbr: "T", color: "bg-[#10293a] text-[#8dd5ff]" },
  button: { abbr: "B", color: "bg-[#173024] text-[#7fe0a9]" },
  input: { abbr: "In", color: "bg-[#332711] text-[#f3cb74]" },
  image: { abbr: "Im", color: "bg-[#2d2142] text-[#c5a3ff]" },
  container: { abbr: "C", color: "bg-[#20252b] text-[#cbd5e1]" },
  card: { abbr: "Cd", color: "bg-[#3a1f29] text-[#ff9db7]" },
  appbar: { abbr: "Ab", color: "bg-[#1d2341] text-[#9eb3ff]" },
  grid: { abbr: "G", color: "bg-[#0d3134] text-[#84e9ed]" },
  stack: { abbr: "S", color: "bg-[#10322a] text-[#86e0cb]" },
  list: { abbr: "L", color: "bg-[#3c2512] text-[#ffbe7d]" },
  table: { abbr: "Tb", color: "bg-[#3a1f37] text-[#ff9fea]" },
  chip: { abbr: "Ch", color: "bg-[#331c3b] text-[#f4a6ff]" },
  avatar: { abbr: "Av", color: "bg-[#283615] text-[#c7f171]" },
  badge: { abbr: "Bg", color: "bg-[#3a3112] text-[#ffe074]" },
  divider: { abbr: "D", color: "bg-[#262626] text-[#a3a3a3]" },
  navigation: { abbr: "N", color: "bg-[#102a3d] text-[#8bc9ff]" },
  dialog: { abbr: "Dl", color: "bg-[#2b1f43] text-[#caa8ff]" },
  drawer: { abbr: "Dr", color: "bg-[#20284a] text-[#a7b8ff]" },
  tab: { abbr: "Tb", color: "bg-[#173024] text-[#7fe0a9]" },
  select: { abbr: "Se", color: "bg-[#332711] text-[#f3cb74]" },
  switch: { abbr: "Sw", color: "bg-[#10322a] text-[#86e0cb]" },
  checkbox: { abbr: "Cx", color: "bg-[#10293a] text-[#8dd5ff]" },
  radio: { abbr: "Ra", color: "bg-[#2d2142] text-[#c5a3ff]" },
  slider: { abbr: "Sl", color: "bg-[#0d3134] text-[#84e9ed]" },
  rating: { abbr: "Rt", color: "bg-[#3a3112] text-[#ffe074]" },
  tooltip: { abbr: "Tt", color: "bg-[#20252b] text-[#d6dee8]" },
  snackbar: { abbr: "Sn", color: "bg-[#3c2512] text-[#ffbe7d]" },
  stepper: { abbr: "St", color: "bg-[#20284a] text-[#a7b8ff]" },
  progress: { abbr: "P", color: "bg-[#10293a] text-[#8dd5ff]" },
  skeleton: { abbr: "Sk", color: "bg-[#262626] text-[#a3a3a3]" },
  breadcrumbs: { abbr: "Bc", color: "bg-[#20252b] text-[#cbd5e1]" },
  paper: { abbr: "Pa", color: "bg-[#2b2620] text-[#d6c5b4]" }
};

export function TypeBadge({ type }: { type: string }): JSX.Element {
  const config = TYPE_LABELS[type];
  const abbr = config?.abbr ?? type.slice(0, 2).toUpperCase();
  const color = config?.color ?? "bg-[#20252b] text-[#cbd5e1]";

  return (
    <span
      className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded border border-white/10 px-0.5 text-[9px] font-bold leading-none ${color}`}
      title={type}
    >
      {abbr}
    </span>
  );
}
