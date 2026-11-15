import { TurboModuleRegistry } from "react-native";

import type { TurboModule } from "react-native";

export interface Spec extends TurboModule {
  capture(sourceId: string, targets: string): Promise<string>;
  getStats(): Promise<string>;
  resetStats(): void;
  releaseSource(sourceId: string): void;
  setFrameMonitoring(enabled: boolean): void;
}

export default TurboModuleRegistry.get<Spec>("SkyvistAdaptiveColor");
