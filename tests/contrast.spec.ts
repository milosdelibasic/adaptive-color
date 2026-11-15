import type { ContrastState } from "../src/contrast";
import {
  contrastRatio,
  decideForeground,
  relativeLuminance,
} from "../src/contrast";

const onDark = "#E5F0FF";
const onLight = "#0E3F85";
const initial = (): ContrastState => ({
  color: onLight,
  pending: null,
  confirmations: 0,
  changedAt: 0,
});
const background = (luminance: number) => Array(25).fill(luminance) as number[];

it("uses linear-light contrast for custom brand colors", () => {
  expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1);
  expect(relativeLuminance("#000000")).toBe(0);
  expect(contrastRatio(1, 0)).toBe(21);
  expect(relativeLuminance(onLight)).toBeLessThan(0.1);
});
it("requires three consistent readings and does not switch for a single dark tile", () => {
  const first = decideForeground(
    initial(),
    background(0.01),
    onDark,
    onLight,
    1000,
  );
  expect(first.changed).toBe(false);
  const second = decideForeground(
    first.state,
    background(0.01),
    onDark,
    onLight,
    1300,
  );
  expect(second.changed).toBe(false);
  const cancelled = decideForeground(
    second.state,
    background(0.9),
    onDark,
    onLight,
    1400,
  );
  expect(cancelled.state.pending).toBeNull();
  let state = initial();
  for (const time of [1000, 1300, 1600])
    state = decideForeground(
      state,
      background(0.01),
      onDark,
      onLight,
      time,
    ).state;
  expect(state.color).toBe(onDark);
});
it("does not flicker during alternating ocean and land readings", () => {
  let state = initial();
  let changes = 0;
  for (let i = 0; i < 100; i++) {
    const result = decideForeground(
      state,
      background(i % 2 ? 0.8 : 0.01),
      onDark,
      onLight,
      i * 300,
    );
    state = result.state;
    if (result.changed) changes++;
  }
  expect(changes).toBe(0);
});
it("enforces the minimum interval even after repeated opposite readings", () => {
  let state: ContrastState = {
    color: onDark,
    pending: null,
    confirmations: 0,
    changedAt: 1000,
  };
  for (const time of [1100, 1200, 1300])
    state = decideForeground(
      state,
      background(0.9),
      onDark,
      onLight,
      time,
    ).state;
  expect(state.color).toBe(onDark);
  expect(
    decideForeground(state, background(0.9), onDark, onLight, 1600).state.color,
  ).toBe(onLight);
});
it("retains the last color when the capture has missing or invalid pixels", () => {
  expect(
    decideForeground(initial(), [NaN, -1, 2], onDark, onLight, 1000).state
      .color,
  ).toBe(onLight);
});

it("supports a prescribed brand blue over light backgrounds, with a dead band that prevents tone flicker", () => {
  const white = "#FFFFFF",
    blue = "#348AFA";
  let state: ContrastState = {
    color: blue,
    pending: null,
    confirmations: 0,
    changedAt: 0,
  };
  state = decideForeground(
    state,
    background(0.01),
    white,
    blue,
    1000,
    1,
    "background",
  ).state;
  expect(state.color).toBe(white);
  state = decideForeground(
    state,
    background(0.4),
    white,
    blue,
    1700,
    1,
    "background",
  ).state;
  expect(state.color).toBe(blue);
  for (let i = 0; i < 20; i++)
    state = decideForeground(
      state,
      background(i % 2 ? 0.16 : 0.21),
      white,
      blue,
      2400 + i * 700,
      1,
      "background",
    ).state;
  expect(state.color).toBe(blue);
});
