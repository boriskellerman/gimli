export type { MemoryIndexManager, MemorySearchResult } from "./manager.js";
export { getMemorySearchManager, type MemorySearchManagerResult } from "./search-manager.js";
export {
  applyDecay,
  applyDecayToResults,
  calculateAgeDays,
  calculateDecayFactor,
  DEFAULT_DECAY_CONFIG,
  resolveDecayConfig,
  shouldArchive,
  type DecayConfig,
  type DecayFunction,
} from "./decay.js";
