import { AppState } from "react-native";

import { AdaptiveColorEngine } from "../src/engine";
import Native from "../src/specs/NativeSkyvistAdaptiveColor";

jest.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));
jest.mock("../src/specs/NativeSkyvistAdaptiveColor", () => ({
  __esModule: true,
  default: {
    capture: jest.fn(async (_source: string, targets: string) =>
      JSON.stringify({
        ok: true,
        mainThreadMs: 1,
        regions: JSON.parse(targets).map(({ id }: { id: string }) => ({
          id,
          samples: Array(25).fill(0.01),
        })),
      }),
    ),
    getStats: jest.fn(async () => "{}"),
    resetStats: jest.fn(),
    releaseSource: jest.fn(),
  },
}));
let engine: AdaptiveColorEngine;
let deactivate: () => void;
const target = (id: string) => ({
  id,
  source: "map",
  onDark: "#E5F0FF",
  onLight: "#0E3F85",
  fallback: "#0E3F85",
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  engine = new AdaptiveColorEngine();
  deactivate = engine.activate("map");
});
afterEach(() => {
  deactivate();
  jest.useRealTimers();
});
it("batches controls and stops sampling the settled map", async () => {
  engine.register(target("search"));
  engine.register(target("location"));
  await jest.advanceTimersByTimeAsync(1800);
  expect(Native!.capture).toHaveBeenCalledTimes(4);
  expect(JSON.parse(jest.mocked(Native!.capture).mock.calls[0][1])).toEqual([
    { id: "search" },
    { id: "location" },
  ]);
  expect(engine.color("search", "")).toBe("#E5F0FF");
  await jest.advanceTimersByTimeAsync(10000);
  expect(Native!.capture).toHaveBeenCalledTimes(4);
});
it("defers capture until camera movement has settled", async () => {
  engine.register(target("search"));
  for (let i = 0; i < 30; i++) {
    engine.invalidate("map");
    await jest.advanceTimersByTimeAsync(100);
  }
  expect(Native!.capture).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(200);
  expect(Native!.capture).toHaveBeenCalledTimes(1);
});
it("pauses in the background and removes the lifecycle subscription after unmount", async () => {
  engine.register(target("search"));
  const listener = jest.mocked(AppState.addEventListener).mock.calls[0][1];
  listener("background");
  await jest.advanceTimersByTimeAsync(2000);
  expect(Native!.capture).not.toHaveBeenCalled();
  listener("active");
  await jest.advanceTimersByTimeAsync(300);
  expect(Native!.capture).toHaveBeenCalledTimes(1);
  deactivate();
  expect(
    jest.mocked(AppState.addEventListener).mock.results[0].value.remove,
  ).toHaveBeenCalled();
});
it("backs off immediately after an expensive capture and retries a settled source", async () => {
  engine.register(target("search"));
  jest
    .mocked(Native!.capture)
    .mockResolvedValueOnce(
      JSON.stringify({ ok: true, mainThreadMs: 18, regions: [] }),
    );
  await jest.advanceTimersByTimeAsync(300);
  await jest.advanceTimersByTimeAsync(4800);
  expect(Native!.capture).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(300);
  expect(Native!.capture).toHaveBeenCalledTimes(2);
});
it("disabled mode performs no captures and exposes the known fallback", async () => {
  engine.register(target("search"));
  engine.setEnabled(false);
  await jest.advanceTimersByTimeAsync(2000);
  expect(Native!.capture).not.toHaveBeenCalled();
  expect(engine.color("search", "#0E3F85")).toBe("#0E3F85");
});

it("suspends repeated budget breaches instead of polling an idle map forever", async () => {
  engine.register(target("search"));
  jest
    .mocked(Native!.capture)
    .mockResolvedValueOnce(
      JSON.stringify({ ok: true, mainThreadMs: 18, regions: [] }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({ ok: true, mainThreadMs: 18, regions: [] }),
    );
  await jest.advanceTimersByTimeAsync(10000);
  expect(Native!.capture).toHaveBeenCalledTimes(2);
  expect((await engine.getStats()).budgetSuspendedSources).toEqual(["map"]);
  engine.invalidate("map");
  await jest.advanceTimersByTimeAsync(300);
  expect(Native!.capture).toHaveBeenCalledTimes(3);
  expect((await engine.getStats()).budgetSuspendedSources).toEqual([]);
});

it("allows one settled reading for a small icon, then updates after a new map movement despite the previous budget suspension", async () => {
  engine.register({
    ...target("search"),
    onDark: "#FFFFFF",
    onLight: "#348AFA",
    confirmations: 1,
  });
  const result = (value: number) =>
    JSON.stringify({
      ok: true,
      mainThreadMs: 26,
      regions: [{ id: "search", samples: Array(25).fill(value) }],
    });
  jest
    .mocked(Native!.capture)
    .mockResolvedValueOnce(result(0.01))
    .mockResolvedValueOnce(result(0.01));
  await jest.advanceTimersByTimeAsync(10000);
  expect(engine.color("search", "")).toBe("#FFFFFF");
  expect(Native!.capture).toHaveBeenCalledTimes(2);
  jest.mocked(Native!.capture).mockResolvedValueOnce(result(0.95));
  engine.invalidate("map");
  await jest.advanceTimersByTimeAsync(300);
  expect(engine.color("search", "")).toBe("#348AFA");
});

it("samples a visible continuous source beyond the initial settle window and releases it on unmount", async () => {
  deactivate();
  const stop = engine.activate("video", true);
  engine.register({ ...target("overlay"), source: "video" });
  await jest.advanceTimersByTimeAsync(3000);
  expect(Native!.capture).toHaveBeenCalledTimes(10);
  stop();
  const count = jest.mocked(Native!.capture).mock.calls.length;
  await jest.advanceTimersByTimeAsync(3000);
  expect(Native!.capture).toHaveBeenCalledTimes(count);
});

it('gives multiple continuous backgrounds a turn', async () => {
  deactivate();
  const stopA = engine.activate('video-a', true), stopB = engine.activate('video-b', true);
  engine.register({ ...target('a'), source: 'video-a' }); engine.register({ ...target('b'), source: 'video-b' });
  await jest.advanceTimersByTimeAsync(1800);
  const sources = jest.mocked(Native!.capture).mock.calls.map(call => call[0]);
  expect(sources.filter(id => id === 'video-a')).toHaveLength(3);
  expect(sources.filter(id => id === 'video-b')).toHaveLength(3);
  stopA(); stopB();
});
it('keeps video sampling while postponing a different source that is moving', async () => {
  engine.register(target('map-overlay'));
  const stop = engine.activate('video', true);
  engine.register({ ...target('video-overlay'), source: 'video' });
  for(let i=0;i<10;i++){ engine.invalidate('map'); await jest.advanceTimersByTimeAsync(100); }
  expect(jest.mocked(Native!.capture).mock.calls.map(call => call[0])).not.toContain('map');
  expect(Native!.capture).toHaveBeenCalled();
  stop();
});
