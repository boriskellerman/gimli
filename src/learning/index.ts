/**
 * Learning system exports
 */

export * from "./extract-learnings.js";
export * from "./learnings-store.js";
export * from "./learning-capture-hook.js";
export * from "./metrics.js";
export * from "./feedback-loop.js";
export * from "./preference-extraction.js";
export * from "./checkpoints.js";
export * from "./style-adaptation.js";
export * from "./journal.js";
export * from "./ab-testing.js";
export * from "./velocity.js";
export * from "./self-evaluation.js";

// expertise-detection.ts exports (profile-based expertise tracking)
export {
  type ExpertiseLevel,
  type ExpertiseSignal,
  type ExpertiseObservation,
  type TopicExpertise,
  type ExpertiseProfile,
  type ExpertiseAdjustment,
  loadExpertiseProfile,
  saveExpertiseProfile,
  detectExpertiseSignals,
  inferTopic,
  updateExpertise,
  getTopicExpertise,
  getExpertiseAdjustment,
  recordExpertiseSignal,
  getCombinedExpertise,
  // Rename to avoid conflict with expertise-store
  resolveExpertisePath as resolveExpertiseProfilePath,
  formatExpertiseSummary as formatExpertiseProfileSummary,
} from "./expertise-detection.js";

// expertise-store.ts exports (config-based expert knowledge files)
export {
  type ExpertKnowledge,
  type MentalModelComponent,
  type CommonIssue,
  type RelatedFile,
  type SelfImprovement,
  type SyncSource,
  type SyncHistoryEntry as ExpertiseSyncHistoryEntry,
  type ExpertiseConfig,
  type CreateExpertiseOptions,
  type ExpertiseUpdate,
  type ExpertiseSyncReport,
  resolveExpertiseDir,
  resolveExpertisePath,
  createEmptyExpertise,
  loadExpertise,
  saveExpertise,
  createExpertise,
  listExpertise,
  deleteExpertise,
  updateExpertiseKnowledge,
  recordExpertiseSync,
  getPendingUpdates,
  searchExpertise,
  formatExpertiseSummary,
  mergeExpertise,
} from "./expertise-store.js";
