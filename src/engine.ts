import { AppState } from "react-native";

import type { ContrastState } from "./contrast";
import { decideForeground } from "./contrast";
import Native from "./specs/NativeSkyvistAdaptiveColor";

export type Target = {
  id: string;
  source: string;
  onDark: string;
  onLight: string;
  fallback: string;
  confirmations?: number;
  strategy?: "contrast" | "background";
  state: ContrastState;
  contrast: number;
  luminanceRange?: number[];
};
type Capture = {
  ok: boolean;
  reason?: string;
  captureMs?: number;
  mainThreadMs?: number;
  regions?: { id: string; samples: number[] }[];
};

export class AdaptiveColorEngine {
  private targets = new Map<string, Target>();
  private continuousSources = new Map<string, number>();
  private sources = new Map<string, number>();
  private listeners = new Set<() => void>();
  private lastInvalidation = new Map<string, number>();
  private dirtyUntil = new Map<string, number>();
  private blockedUntil = new Map<string, number>();
  private expensive = new Map<string, number>();
  private budgetRetries = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private enabled = true;
  private active = AppState.currentState === "active";
  private appStateSubscription: ReturnType<
    typeof AppState.addEventListener
  > | null = null;
  private stats = {
    requests: 0,
    failures: 0,
    changes: 0,
    maxCaptureMs: 0,
    budgetBackoffs: 0,
    lastError: "",
    lastRegions: 0,
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  color(id: string, fallback: string) {
    return this.enabled
      ? (this.targets.get(id)?.state.color ?? fallback)
      : fallback;
  }
  register(target: Omit<Target, "state" | "contrast" | "luminanceRange">) {
    if (this.targets.size >= 12) return () => {};
    this.targets.set(target.id, {
      ...target,
      contrast: 0,
      state: {
        color: target.fallback,
        pending: null,
        confirmations: 0,
        changedAt: 0,
      },
    });
    this.invalidate(target.source);
    return () => {
      this.targets.delete(target.id);
    };
  }
  activate(source: string, continuous = false) {
    if (continuous)
      this.continuousSources.set(
        source,
        (this.continuousSources.get(source) ?? 0) + 1,
      );
    if (!this.appStateSubscription) {
      this.active = AppState.currentState === "active";
      this.appStateSubscription = AppState.addEventListener(
        "change",
        (state) => {
          this.active = state === "active";
          if (!this.active) {
            if (this.timer) clearTimeout(this.timer);
            this.timer = null;
          } else this.sources.forEach((_, id) => this.invalidate(id));
        },
      );
    }
    this.sources.set(source, (this.sources.get(source) ?? 0) + 1);
    this.invalidate(source);
    return () => {
      if (continuous) {
        const next = (this.continuousSources.get(source) ?? 1) - 1;
        if (next > 0) this.continuousSources.set(source, next);
        else this.continuousSources.delete(source);
      }
      const count = (this.sources.get(source) ?? 1) - 1;
      if (count <= 0) {
        this.sources.delete(source);
        Native?.releaseSource?.(source);
        this.dirtyUntil.delete(source);
        this.lastInvalidation.delete(source);
        this.blockedUntil.delete(source);
        this.expensive.delete(source);
        this.budgetRetries.delete(source);
        if (this.sources.size === 0) {
          if (this.timer) clearTimeout(this.timer);
          this.timer = null;
          this.appStateSubscription?.remove();
          this.appStateSubscription = null;
        }
      } else this.sources.set(source, count);
    };
  }
  invalidate(source: string) {
    if (!this.sources.has(source)) return;
    const now = Date.now();
    // A new content-change burst may retry; repeated timers for the same idle image may not.
    if (now - (this.lastInvalidation.get(source) ?? 0) > 300) {
      this.blockedUntil.delete(source);
      this.budgetRetries.delete(source);
      this.expensive.delete(source);
      this.targets.forEach((target) => {
        if (target.source === source)
          target.state = { ...target.state, pending: null, confirmations: 0 };
      });
    }
    this.lastInvalidation.set(source, now);
    this.dirtyUntil.set(source, now + 1500);
    // Wait until movement/layout settles; never capture on every camera frame.
    if (this.continuousSources.size === 0) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
    this.schedule();
  }
  private schedule() {
    if (
      !this.enabled ||
      !this.active ||
      !Native ||
      this.timer ||
      this.inFlight ||
      this.sources.size === 0
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sample().catch(() => undefined);
    }, 300);
  }
  private async sample() {
    if (!this.enabled || !this.active || !Native || this.inFlight) return;
    const now = Date.now();
    const source = [...this.sources.keys()].find(
      (id) =>
        (this.continuousSources.has(id) ||
          ((this.dirtyUntil.get(id) ?? 0) > now && now - (this.lastInvalidation.get(id) ?? 0) >= 300)) &&
        (this.blockedUntil.get(id) ?? 0) <= now &&
        [...this.targets.values()].some((target) => target.source === id),
    );
    if (!source) {
      const pending = [...this.sources.keys()].some(
        (id) =>
          (this.continuousSources.has(id) ||
            (this.dirtyUntil.get(id) ?? 0) > now) &&
          this.blockedUntil.get(id) !== Infinity,
      );
      if (pending) this.schedule();
      return;
    }
    const targets = [...this.targets.values()].filter(
      (target) => target.source === source,
    );
    const references = this.sources.get(source)!;
    this.sources.delete(source);
    this.sources.set(source, references);
    const contentRevision = this.lastInvalidation.get(source);
    this.inFlight = true;
    try {
      const result: Capture = JSON.parse(
        await Native.capture(
          source,
          JSON.stringify(targets.map((target) => ({ id: target.id }))),
        ),
      );
      this.stats.requests++;
      const cost = result.mainThreadMs ?? result.captureMs ?? 0;
      this.stats.maxCaptureMs = Math.max(this.stats.maxCaptureMs, cost);
      const expensive = cost > 6 ? (this.expensive.get(source) ?? 0) + 1 : 0;
      this.expensive.set(source, expensive);
      // Cost is measured, not inferred from the small bitmap. Back off the shared source.
      if (cost > 12 || expensive >= 3) {
        const retries = (this.budgetRetries.get(source) ?? 0) + 1;
        this.budgetRetries.set(source, retries);
        this.blockedUntil.set(
          source,
          retries >= 2 ? Infinity : Date.now() + 5000,
        );
        if (retries < 2) this.dirtyUntil.set(source, Date.now() + 6500);
        else this.dirtyUntil.delete(source);
        this.expensive.set(source, 0);
        this.stats.budgetBackoffs++;
      }
      if (!result.ok) {
        this.stats.failures++;
        this.stats.lastError = result.reason ?? "capture-failed";
      }
      if (
        !this.enabled ||
        !this.active ||
        !this.sources.has(source) ||
        this.lastInvalidation.get(source) !== contentRevision
      )
        return;
      this.stats.lastRegions = result.regions?.length ?? 0;
      let changed = false;
      for (const region of result.regions ?? []) {
        const target = this.targets.get(region.id);
        if (!target || target.source !== source) continue;
        const decision = decideForeground(
          target.state,
          region.samples,
          target.onDark,
          target.onLight,
          Date.now(),
          target.confirmations,
          target.strategy,
        );
        target.state = decision.state;
        target.contrast = decision.contrast;
        target.luminanceRange = [
          Math.min(...region.samples),
          Math.max(...region.samples),
        ];
        if (decision.changed) {
          this.stats.changes++;
          changed = true;
        }
      }
      if (changed) this.emit();
    } catch (error) {
      this.stats.failures++;
      this.stats.lastError =
        error instanceof Error ? error.message : "capture-failed";
    } finally {
      this.inFlight = false;
      this.schedule();
    }
  }
  setEnabled = (enabled: boolean) => {
    if (enabled && !this.enabled) {
      this.blockedUntil.clear();
      this.budgetRetries.clear();
      this.expensive.clear();
    }
    this.enabled = enabled;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit();
    if (enabled) this.sources.forEach((_, source) => this.invalidate(source));
  };
  resetStats = () => {
    this.stats = {
      requests: 0,
      failures: 0,
      changes: 0,
      maxCaptureMs: 0,
      budgetBackoffs: 0,
      lastError: "",
      lastRegions: 0,
    };
    Native?.resetStats();
  };
  getStats = async () => ({
    enabled: this.enabled,
    supported: Boolean(Native),
    budgetSuspendedSources: [...this.sources.keys()].filter(
      (id) => this.blockedUntil.get(id) === Infinity,
    ),
    ...this.stats,
    targets: [...this.targets.values()].map((target) => ({
      id: target.id,
      source: target.source,
      color: target.state.color,
      contrast: target.contrast,
      luminanceRange: target.luminanceRange,
    })),
    native: Native
      ? (JSON.parse(await Native.getStats()) as Record<string, unknown>)
      : null,
  });
  setFrameMonitoring = (enabled: boolean) =>
    Native?.setFrameMonitoring(enabled);
}

export const adaptiveColor = new AdaptiveColorEngine();
