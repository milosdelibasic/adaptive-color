import type { ReactNode } from "react";

export type AdaptiveColorSourceProps = {
  id: string;
  active?: boolean;
  continuous?: boolean;
  children: ReactNode;
};
export type AdaptiveForegroundOptions = {
  onDark: string;
  onLight: string;
  fallback: string;
  enabled?: boolean;
  confirmations?: 1 | 2 | 3;
  strategy?: "contrast" | "background";
};
