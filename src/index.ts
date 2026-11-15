import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useSyncExternalStore,
} from "react";

import { adaptiveColor } from "./engine";
import type {
  AdaptiveColorSourceProps,
  AdaptiveForegroundOptions,
} from "./index.types";

export { contrastRatio, relativeLuminance } from "./contrast";
export { adaptiveColor } from "./engine";

const Source = createContext<string | null>(null);
export const AdaptiveColorSource = ({
  id,
  active = true,
  continuous = false,
  children,
}: AdaptiveColorSourceProps) => {
  useEffect(
    () => (active ? adaptiveColor.activate(id, continuous) : undefined),
    [active, continuous, id],
  );
  return createElement(
    Source.Provider,
    { value: active ? id : null },
    children,
  );
};

export const useAdaptiveForeground = ({
  onDark,
  onLight,
  fallback,
  enabled = true,
  confirmations = 3,
  strategy = "contrast",
}: AdaptiveForegroundOptions) => {
  const source = useContext(Source);
  const id = `skyvist-contrast-${useId().replace(/[^\w-]/g, "")}`;
  useEffect(() => {
    if (!source || !enabled) return;
    return adaptiveColor.register({
      id,
      source,
      onDark,
      onLight,
      fallback,
      confirmations,
      strategy,
    });
  }, [confirmations, enabled, fallback, id, onDark, onLight, source, strategy]);
  const color = useSyncExternalStore(
    adaptiveColor.subscribe,
    () => adaptiveColor.color(id, fallback),
    () => fallback,
  );
  return {
    color,
    targetProps: {
      nativeID: id,
      testID: id,
      collapsable: false as const,
      onLayout: () => {
        if (source && enabled) adaptiveColor.invalidate(source);
      },
    },
  };
};

// Prototype-only instrumentation for repeatable enabled/disabled runs in the same binary.
if (__DEV__) {
  (
    globalThis as typeof globalThis & {
      __skyvistAdaptiveColor?: typeof adaptiveColor;
    }
  ).__skyvistAdaptiveColor = adaptiveColor;
}
