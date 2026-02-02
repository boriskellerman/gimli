/**
 * AI Developer Workflows (ADWs)
 *
 * This module provides composable workflows for autonomous agent operations.
 * Each ADW is a deterministic wrapper around non-deterministic agent calls,
 * following the TAC (Tactical Agentic Coding) principles.
 *
 * Available workflows:
 * - plan-build: Plan a feature implementation and then build it
 * - test-fix: Analyze test failures, implement fixes, verify
 * - review-document: Review code and extract learnings
 */

// Base framework
export {
  // Core types
  type ADWStatus,
  type StageStatus,
  type TriggerType,
  type StageConfig,
  type StageResult,
  type RetryConfig,
  type ValidationRules,
  type ADWDefinition,
  type ADWContext,
  type ADWResult,
  // Constants
  DEFAULT_RETRY_CONFIG,
  DEFAULT_STAGE_TIMEOUT_SECONDS,
  DEFAULT_TOTAL_TIMEOUT_SECONDS,
  // Utilities
  generateExecutionId,
  calculateRetryDelay,
  isRetryableError,
  sleep,
  // Logging
  type ADWLogger,
  createConsoleLogger,
  createFileLogger,
  // Execution
  executeStage,
  executeStageWithRetry,
  executeADW,
  // Result storage
  loadResults,
  getResult,
  formatResultAsMarkdown,
} from "./adw-base.js";

// Plan-Build workflow
export {
  // Types
  type PlanBuildInput,
  type ImplementationPlan,
  type BuildResult,
  // Definition
  createPlanBuildDefinition,
  // Execution
  executePlanBuild,
  // Parsing
  parsePlanFromOutput,
  parseBuildResult,
  getPlanBuildResults,
} from "./adw-plan-build.js";

// Test-Fix workflow
export {
  // Types
  type TestFixInput,
  type RootCauseAnalysis,
  type FixResult,
  type VerificationResult,
  // Definition
  createTestFixDefinition,
  // Execution
  executeTestFix,
  // Parsing
  parseAnalysis,
  parseFixResult,
  parseVerificationResult,
  getTestFixResults,
  wasFixSuccessful,
} from "./adw-test-fix.js";

// Review-Document workflow
export {
  // Types
  type ReviewDocumentInput,
  type ReviewFinding,
  type CodeReview,
  type DocumentationUpdate,
  type ExtractedLearning,
  type DocumentationResult,
  // Definition
  createReviewDocumentDefinition,
  // Execution
  executeReviewDocument,
  // Parsing
  parseCodeReview,
  parseDocumentationResult,
  getReviewDocumentResults,
  formatReviewAsMarkdown,
  formatLearningsAsYaml,
} from "./adw-review-document.js";
