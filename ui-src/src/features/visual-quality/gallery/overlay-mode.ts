export type OverlayMode =
  | "side-by-side"
  | "onion-skin"
  | "heatmap"
  | "confidence";

export const OVERLAY_MODES: { value: OverlayMode; label: string }[] = [
  { value: "side-by-side", label: "Side-by-side" },
  { value: "onion-skin", label: "Onion skin" },
  { value: "heatmap", label: "Heatmap" },
  { value: "confidence", label: "Confidence" },
];
