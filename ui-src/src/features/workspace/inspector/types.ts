import type { CSSProperties } from "react";

type CSSCustomProperties = {
  [key: `--${string}`]: string | number;
};

export type InspectorCSSProperties = CSSProperties & CSSCustomProperties;
