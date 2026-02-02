/**
 * Scout Agents Module
 *
 * Scout agents research the codebase before building. They investigate
 * architecture, dependencies, patterns, and tests to inform implementation.
 *
 * @example
 * ```typescript
 * import { runScout, getScoutResult, listScoutRuns } from './scout';
 *
 * // Run a feature scout
 * const result = await runScout({
 *   type: 'feature',
 *   query: 'Add OAuth2 authentication',
 *   scope: 'src/auth/',
 *   depth: 'medium',
 * }, requesterSessionKey);
 *
 * // Get results
 * console.log(result.findings);
 * ```
 */

export * from "./types.js";
export * from "./prompts.js";
export * from "./scout-runner.js";
