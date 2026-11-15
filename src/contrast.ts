export type ContrastState = {
  color: string;
  pending: string | null;
  confirmations: number;
  changedAt: number;
};

export const relativeLuminance = (color: string) => {
  if (!/^#[\da-f]{6}$/i.test(color))
    throw new Error("Adaptive colors must be opaque #RRGGBB values.");
  const channels = [1, 3, 5].map((offset) => {
    const c = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

export const contrastRatio = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export const decideForeground = (
  state: ContrastState,
  samples: number[],
  onDark: string,
  onLight: string,
  now: number,
  requiredConfirmations = 3,
  strategy: "contrast" | "background" = "contrast",
) => {
  const values = samples
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    .sort((a, b) => a - b);
  if (values.length < 5) return { state, contrast: 0, changed: false };
  const low = values[Math.floor(values.length * 0.2)];
  const high =
    values[Math.min(values.length - 1, Math.floor(values.length * 0.8))];
  const score = (color: string) => {
    const l = relativeLuminance(color);
    // A candidate inside the background range has a worst-case contrast of 1.
    return l >= low && l <= high
      ? 1
      : Math.min(contrastRatio(l, low), contrastRatio(l, high));
  };
  const darkScore = score(onDark);
  const lightScore = score(onLight);
  const median = values[Math.floor(values.length / 2)];
  const next =
    strategy === "background"
      ? state.color === onDark
        ? median > 0.22
          ? onLight
          : onDark
        : median < 0.14
          ? onDark
          : onLight
      : darkScore >= lightScore
        ? onDark
        : onLight;
  const currentScore = score(state.color);
  const nextScore = score(next);
  if (
    next === state.color ||
    (strategy === "contrast" &&
      (nextScore < currentScore * 1.25 || nextScore - currentScore < 0.5))
  ) {
    return {
      state: { ...state, pending: null, confirmations: 0 },
      contrast: currentScore,
      changed: false,
    };
  }
  const confirmations = state.pending === next ? state.confirmations + 1 : 1;
  if (confirmations < requiredConfirmations || now - state.changedAt < 600) {
    return {
      state: { ...state, pending: next, confirmations },
      contrast: currentScore,
      changed: false,
    };
  }
  return {
    state: { color: next, pending: null, confirmations: 0, changedAt: now },
    contrast: nextScore,
    changed: true,
  };
};
