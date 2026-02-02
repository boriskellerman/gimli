import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { Command } from "commander";
import { formatDocsLink } from "../terminal/links.js";
import { clearActiveProgressLine } from "../terminal/progress-line.js";
import { createSafeStreamWriter } from "../terminal/stream-writer.js";
import { colorize, isRich, theme } from "../terminal/theme.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TestResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  duration?: number;
  error?: string;
  file?: string;
  line?: number;
};

export type TestRunSummary = {
  timestamp: Date;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: TestFailure[];
};

export type TestFailure = {
  testName: string;
  file: string;
  line?: number;
  error: string;
  stackTrace?: string;
  category: FailureCategory;
};

export type FailureCategory =
  | "assertion"
  | "timeout"
  | "type-error"
  | "runtime-error"
  | "network"
  | "import"
  | "unknown";

type TestAnalyzerCliOptions = {
  json?: boolean;
  watch?: boolean;
  interval?: string;
  config?: string;
  filter?: string;
  verbose?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Failure pattern detection
// ─────────────────────────────────────────────────────────────────────────────

// Pattern order matters: more specific patterns should come before general ones.
// E.g., "fetch failed" must match network before "TypeError" matches type-error.
// ReferenceError must match runtime-error before "is not defined" matches type-error.
const FAILURE_PATTERNS: Array<{ pattern: RegExp; category: FailureCategory }> = [
  { pattern: /AssertionError|expect\(.*\)\.to|Expected.*Received/i, category: "assertion" },
  { pattern: /timeout|exceeded.*time|ETIMEDOUT/i, category: "timeout" },
  { pattern: /ECONNREFUSED|ENOTFOUND|fetch failed|network/i, category: "network" },
  { pattern: /Cannot find module|Failed to resolve|import.*from/i, category: "import" },
  { pattern: /ReferenceError|SyntaxError|RangeError/i, category: "runtime-error" },
  { pattern: /TypeError|is not a function|is not defined/i, category: "type-error" },
];

export function categorizeFailure(error: string): FailureCategory {
  for (const { pattern, category } of FAILURE_PATTERNS) {
    if (pattern.test(error)) {
      return category;
    }
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Output parsing
// ─────────────────────────────────────────────────────────────────────────────

type VitestJsonOutput = {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{
      fullName?: string;
      status?: string;
      duration?: number;
      failureMessages?: string[];
      location?: { line?: number; column?: number };
    }>;
  }>;
  startTime?: number;
  success?: boolean;
};

export function parseVitestOutput(output: string): TestRunSummary {
  const timestamp = new Date();
  const failures: TestFailure[] = [];

  // Try to parse as JSON first (vitest --reporter=json)
  try {
    const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as VitestJsonOutput;

      const totalTests = data.numTotalTests ?? 0;
      const passed = data.numPassedTests ?? 0;
      const failed = data.numFailedTests ?? 0;
      const skipped = data.numPendingTests ?? 0;
      const duration = data.startTime ? Date.now() - data.startTime : 0;

      // Extract failures
      for (const testFile of data.testResults ?? []) {
        const fileName = testFile.name ?? "unknown";
        for (const assertion of testFile.assertionResults ?? []) {
          if (assertion.status === "failed") {
            const errorMessage = (assertion.failureMessages ?? []).join("\n");
            failures.push({
              testName: assertion.fullName ?? "unknown",
              file: fileName,
              line: assertion.location?.line,
              error: errorMessage,
              stackTrace: extractStackTrace(errorMessage),
              category: categorizeFailure(errorMessage),
            });
          }
        }
      }

      return { timestamp, totalTests, passed, failed, skipped, duration, failures };
    }
  } catch {
    // Fall through to text parsing
  }

  // Parse text output format
  return parseVitestTextOutput(output, timestamp);
}

function parseVitestTextOutput(output: string, timestamp: Date): TestRunSummary {
  const failures: TestFailure[] = [];

  // Match test summary line: "Tests  10 passed | 2 failed | 1 skipped (13)"
  const summaryMatch = output.match(
    /Tests?\s+(\d+)\s*passed\s*\|\s*(\d+)\s*failed(?:\s*\|\s*(\d+)\s*skipped)?\s*\((\d+)\)/i,
  );

  // Match duration: "Duration  1.23s" or "Time  1.23s"
  const durationMatch = output.match(/(?:Duration|Time)\s+([\d.]+)s/i);

  // Extract failed test blocks
  const failedBlockRegex = /FAIL\s+([^\n]+)\s*\n([\s\S]*?)(?=(?:FAIL\s|✓|√|Tests?\s+\d+))/g;
  let match;
  while ((match = failedBlockRegex.exec(output)) !== null) {
    const file = match[1].trim();
    const block = match[2];

    // Extract individual test failures from block
    const testFailRegex = /[×✕]\s+([^\n]+)\n([\s\S]*?)(?=[×✕✓√]|\n\n|$)/g;
    let testMatch;
    while ((testMatch = testFailRegex.exec(block)) !== null) {
      const testName = testMatch[1].trim();
      const errorBlock = testMatch[2].trim();

      // Try to extract line number from error
      const lineMatch = errorBlock.match(/:(\d+):\d+/);

      failures.push({
        testName,
        file,
        line: lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined,
        error: errorBlock.slice(0, 500),
        stackTrace: extractStackTrace(errorBlock),
        category: categorizeFailure(errorBlock),
      });
    }
  }

  // Also check for inline failure format: "× test name"
  const inlineFailRegex =
    /[×✕]\s+([^\n]+?)(?:\s+\((\d+)\s*ms\))?\s*\n\s*(Error|AssertionError|TypeError|ReferenceError)[:\s]([^\n]+)/g;
  while ((match = inlineFailRegex.exec(output)) !== null) {
    const testName = match[1].trim();
    const errorType = match[3];
    const errorMessage = match[4].trim();

    // Avoid duplicates
    if (!failures.some((f) => f.testName === testName)) {
      failures.push({
        testName,
        file: "unknown",
        error: `${errorType}: ${errorMessage}`,
        category: categorizeFailure(`${errorType}: ${errorMessage}`),
      });
    }
  }

  const passed = summaryMatch ? Number.parseInt(summaryMatch[1], 10) : 0;
  const failed = summaryMatch ? Number.parseInt(summaryMatch[2], 10) : failures.length;
  const skipped = summaryMatch ? Number.parseInt(summaryMatch[3] ?? "0", 10) : 0;
  const totalTests = summaryMatch
    ? Number.parseInt(summaryMatch[4], 10)
    : passed + failed + skipped;
  const duration = durationMatch ? Number.parseFloat(durationMatch[1]) * 1000 : 0;

  return { timestamp, totalTests, passed, failed, skipped, duration, failures };
}

function extractStackTrace(errorMessage: string): string | undefined {
  const stackMatch = errorMessage.match(/(?:at\s+.+\n)+/);
  return stackMatch ? stackMatch[0].trim() : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test runner
// Note: Uses spawn() with explicit arguments (not shell string interpolation)
// for safety. Shell mode only enabled on Windows where required for .cmd files.
// ─────────────────────────────────────────────────────────────────────────────

export type TestRunResult = {
  exitCode: number;
  output: string;
  summary: TestRunSummary;
};

export async function runTests(options: {
  config?: string;
  filter?: string;
  reporter?: string;
}): Promise<TestRunResult> {
  return new Promise((resolve) => {
    // Build args array - spawn uses execFile semantics (no shell injection)
    const args = ["vitest", "run"];

    if (options.config) {
      args.push("--config", options.config);
    }

    if (options.filter) {
      args.push("--testNamePattern", options.filter);
    }

    // Use verbose reporter for better parsing
    args.push("--reporter", options.reporter ?? "verbose");

    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    let output = "";

    // spawn with array args is safe - no shell interpolation of user input
    const child = spawn(pnpm, args, {
      stdio: ["inherit", "pipe", "pipe"],
      // Shell only needed on Windows for .cmd file execution
      shell: process.platform === "win32",
      env: {
        ...process.env,
        // Suppress experimental warnings for cleaner output
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS ?? "",
          "--disable-warning=ExperimentalWarning",
          "--disable-warning=DEP0040",
        ]
          .filter(Boolean)
          .join(" "),
      },
    });

    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("exit", (code) => {
      const summary = parseVitestOutput(output);
      resolve({
        exitCode: code ?? 0,
        output,
        summary,
      });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        output: `Failed to spawn test runner: ${err.message}`,
        summary: {
          timestamp: new Date(),
          totalTests: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0,
          failures: [],
        },
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

function createOutputWriters() {
  const writer = createSafeStreamWriter({
    beforeWrite: () => clearActiveProgressLine(),
  });

  return {
    logLine: (text: string) => writer.writeLine(process.stdout, text),
    errorLine: (text: string) => writer.writeLine(process.stderr, text),
    emitJson: (payload: Record<string, unknown>) =>
      writer.write(process.stdout, `${JSON.stringify(payload)}\n`),
  };
}

function formatFailureCategory(category: FailureCategory, rich: boolean): string {
  const labels: Record<FailureCategory, string> = {
    assertion: "ASSERT",
    timeout: "TIMEOUT",
    "type-error": "TYPE",
    "runtime-error": "RUNTIME",
    network: "NETWORK",
    import: "IMPORT",
    unknown: "UNKNOWN",
  };

  const label = labels[category].padEnd(8);

  if (!rich) return `[${label}]`;

  const color =
    category === "assertion"
      ? theme.error
      : category === "timeout"
        ? theme.warn
        : category === "type-error"
          ? theme.error
          : theme.muted;

  return colorize(rich, color, `[${label}]`);
}

function formatSummary(summary: TestRunSummary, rich: boolean): string[] {
  const lines: string[] = [];
  const time = summary.timestamp.toISOString().slice(11, 19);

  const passLabel = colorize(rich, theme.success, `${summary.passed} passed`);
  const failLabel =
    summary.failed > 0
      ? colorize(rich, theme.error, `${summary.failed} failed`)
      : `${summary.failed} failed`;
  const skipLabel =
    summary.skipped > 0 ? colorize(rich, theme.muted, `${summary.skipped} skipped`) : null;
  const durationLabel = colorize(rich, theme.muted, `${(summary.duration / 1000).toFixed(2)}s`);

  const parts = [passLabel, failLabel, skipLabel, `(${summary.totalTests} total)`].filter(Boolean);
  lines.push(`[${time}] Tests: ${parts.join(" | ")} in ${durationLabel}`);

  return lines;
}

function formatFailure(failure: TestFailure, index: number, rich: boolean): string[] {
  const lines: string[] = [];
  const cat = formatFailureCategory(failure.category, rich);
  const location = failure.line ? `${failure.file}:${failure.line}` : failure.file;

  lines.push("");
  lines.push(
    `${colorize(rich, theme.error, `#${index + 1}`)} ${cat} ${colorize(rich, theme.accent, failure.testName)}`,
  );
  lines.push(`   ${colorize(rich, theme.muted, location)}`);

  // Truncate error message for display
  const errorPreview = failure.error.slice(0, 200).replace(/\n/g, " ");
  lines.push(`   ${errorPreview}${failure.error.length > 200 ? "..." : ""}`);

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI registration
// ─────────────────────────────────────────────────────────────────────────────

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function registerTestAnalyzerCli(program: Command) {
  const testAnalyzer = program
    .command("test-analyzer")
    .description("Run tests and analyze failures continuously")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/test-analyzer", "docs.gimli.bot/cli/test-analyzer")}\n`,
    );

  // ─── run subcommand ────────────────────────────────────────────────────────
  testAnalyzer
    .command("run")
    .description("Run tests once and analyze failures")
    .option("--json", "Output results as JSON", false)
    .option("--config <path>", "Path to vitest config file")
    .option("--filter <pattern>", "Filter tests by name pattern")
    .option("--verbose", "Show full test output", false)
    .action(async (opts: TestAnalyzerCliOptions) => {
      const { logLine, emitJson } = createOutputWriters();
      const rich = isRich();
      const jsonMode = Boolean(opts.json);

      if (!jsonMode) {
        logLine(colorize(rich, theme.muted, "Running tests..."));
      }

      const result = await runTests({
        config: opts.config,
        filter: opts.filter,
      });

      if (jsonMode) {
        emitJson({
          type: "test-run",
          exitCode: result.exitCode,
          summary: {
            timestamp: result.summary.timestamp.toISOString(),
            totalTests: result.summary.totalTests,
            passed: result.summary.passed,
            failed: result.summary.failed,
            skipped: result.summary.skipped,
            duration: result.summary.duration,
          },
          failures: result.summary.failures.map((f) => ({
            testName: f.testName,
            file: f.file,
            line: f.line,
            error: f.error,
            category: f.category,
          })),
        });
        process.exit(result.exitCode);
        return;
      }

      // Print verbose output if requested
      if (opts.verbose && result.output) {
        logLine("");
        logLine(colorize(rich, theme.muted, "─── Test Output ───"));
        for (const line of result.output.split("\n")) {
          logLine(line);
        }
        logLine(colorize(rich, theme.muted, "───────────────────"));
      }

      // Print summary
      for (const line of formatSummary(result.summary, rich)) {
        logLine(line);
      }

      // Print failures
      if (result.summary.failures.length > 0) {
        logLine("");
        logLine(
          colorize(rich, theme.error, `${result.summary.failures.length} failure(s) detected:`),
        );

        const failures = result.summary.failures;
        for (let i = 0; i < failures.length; i += 1) {
          for (const line of formatFailure(failures[i], i, rich)) {
            logLine(line);
          }
        }

        // Failure category breakdown
        const categoryCount = new Map<FailureCategory, number>();
        for (const failure of result.summary.failures) {
          categoryCount.set(failure.category, (categoryCount.get(failure.category) ?? 0) + 1);
        }

        logLine("");
        logLine(colorize(rich, theme.muted, "Failure breakdown:"));
        categoryCount.forEach((count, category) => {
          logLine(`  ${formatFailureCategory(category, rich)} ${count}`);
        });
      }

      process.exit(result.exitCode);
    });

  // ─── watch subcommand ──────────────────────────────────────────────────────
  testAnalyzer
    .command("watch")
    .description("Continuously run tests and report failures")
    .option("--json", "Output results as JSON", false)
    .option("--interval <ms>", "Polling interval between test runs", "30000")
    .option("--config <path>", "Path to vitest config file")
    .option("--filter <pattern>", "Filter tests by name pattern")
    .action(async (opts: TestAnalyzerCliOptions) => {
      const { logLine, emitJson } = createOutputWriters();
      const rich = isRich();
      const jsonMode = Boolean(opts.json);
      const interval = parsePositiveInt(opts.interval, 30000);

      let runCount = 0;
      let lastFailCount = 0;

      if (!jsonMode) {
        logLine(
          colorize(
            rich,
            theme.accent,
            `Starting continuous test monitoring (interval: ${interval / 1000}s)`,
          ),
        );
      }

      while (true) {
        runCount += 1;

        if (!jsonMode) {
          logLine("");
          logLine(colorize(rich, theme.muted, `─── Run #${runCount} ───`));
        }

        const result = await runTests({
          config: opts.config,
          filter: opts.filter,
        });

        if (jsonMode) {
          emitJson({
            type: "watch-run",
            runNumber: runCount,
            exitCode: result.exitCode,
            summary: {
              timestamp: result.summary.timestamp.toISOString(),
              totalTests: result.summary.totalTests,
              passed: result.summary.passed,
              failed: result.summary.failed,
              skipped: result.summary.skipped,
              duration: result.summary.duration,
            },
            failures: result.summary.failures.map((f) => ({
              testName: f.testName,
              file: f.file,
              line: f.line,
              error: f.error,
              category: f.category,
            })),
            newFailures: result.summary.failed > lastFailCount,
          });
        } else {
          for (const line of formatSummary(result.summary, rich)) {
            logLine(line);
          }

          // Alert on new failures
          if (result.summary.failed > lastFailCount) {
            logLine("");
            logLine(
              colorize(
                rich,
                theme.error,
                `⚠ New failures detected! (${lastFailCount} → ${result.summary.failed})`,
              ),
            );
            const watchFailures = result.summary.failures;
            for (let i = 0; i < watchFailures.length; i += 1) {
              for (const line of formatFailure(watchFailures[i], i, rich)) {
                logLine(line);
              }
            }
          } else if (result.summary.failed > 0) {
            logLine(
              colorize(rich, theme.warn, `  ${result.summary.failed} known failure(s) persisting`),
            );
          } else if (lastFailCount > 0 && result.summary.failed === 0) {
            logLine(colorize(rich, theme.success, "✓ All failures resolved!"));
          }
        }

        lastFailCount = result.summary.failed;

        await delay(interval);
      }
    });

  // ─── analyze subcommand ────────────────────────────────────────────────────
  testAnalyzer
    .command("analyze")
    .description("Analyze test output from stdin or file")
    .option("--json", "Output results as JSON", false)
    .argument("[file]", "Path to test output file (reads stdin if omitted)")
    .action(async (file: string | undefined, opts: TestAnalyzerCliOptions) => {
      const { logLine, emitJson } = createOutputWriters();
      const rich = isRich();
      const jsonMode = Boolean(opts.json);

      let input = "";

      if (file) {
        const { readFile } = await import("node:fs/promises");
        try {
          input = await readFile(file, "utf-8");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (jsonMode) {
            emitJson({ type: "error", error: msg });
          } else {
            logLine(colorize(rich, theme.error, `Failed to read file: ${msg}`));
          }
          process.exit(1);
          return;
        }
      } else {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        input = Buffer.concat(chunks).toString("utf-8");
      }

      const summary = parseVitestOutput(input);

      if (jsonMode) {
        emitJson({
          type: "analysis",
          summary: {
            timestamp: summary.timestamp.toISOString(),
            totalTests: summary.totalTests,
            passed: summary.passed,
            failed: summary.failed,
            skipped: summary.skipped,
            duration: summary.duration,
          },
          failures: summary.failures.map((f) => ({
            testName: f.testName,
            file: f.file,
            line: f.line,
            error: f.error,
            category: f.category,
          })),
        });
        return;
      }

      for (const line of formatSummary(summary, rich)) {
        logLine(line);
      }

      if (summary.failures.length > 0) {
        logLine("");
        logLine(colorize(rich, theme.error, `${summary.failures.length} failure(s) found:`));
        const analyzeFailures = summary.failures;
        for (let i = 0; i < analyzeFailures.length; i += 1) {
          for (const line of formatFailure(analyzeFailures[i], i, rich)) {
            logLine(line);
          }
        }
      }
    });
}
