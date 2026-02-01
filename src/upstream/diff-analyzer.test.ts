/**
 * Tests for the diff analyzer module
 */

import { describe, expect, it } from "vitest";

import {
  analyzeDiff,
  hasBreakingIndicators,
  hasSecurityIndicators,
  parseDiff,
  type DiffInput,
} from "./diff-analyzer.js";

// ============================================================================
// Test Fixtures
// ============================================================================

const SIMPLE_DIFF = `diff --git a/src/utils.ts b/src/utils.ts
index 1234567..abcdefg 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,6 +10,10 @@ export function helper() {
   return true;
 }

+export function newHelper() {
+  return false;
+}
+
 export function existingFunction() {
   // existing code
 }`;

const NEW_FILE_DIFF = `diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,20 @@
+/**
+ * New feature module
+ */
+
+export interface FeatureConfig {
+  enabled: boolean;
+  name: string;
+}
+
+export function createFeature(config: FeatureConfig) {
+  return {
+    ...config,
+    id: generateId(),
+  };
+}
+
+export function runFeature(id: string) {
+  console.log("Running feature:", id);
+}
+`;

const DELETED_FILE_DIFF = `diff --git a/src/deprecated.ts b/src/deprecated.ts
deleted file mode 100644
index 1234567..0000000
--- a/src/deprecated.ts
+++ /dev/null
@@ -1,10 +0,0 @@
-export function oldFunction() {
-  return "deprecated";
-}
-
-export const OLD_CONSTANT = 42;
-
-export interface OldInterface {
-  value: string;
-}
-`;

const RENAMED_FILE_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index 1234567..abcdefg 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,5 +1,5 @@
-// Old file name
+// New file name
 export function utility() {
   return true;
 }`;

const SECURITY_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 1234567..abcdefg 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -15,7 +15,12 @@ export async function validateToken(token: string) {
   return decoded;
 }

+export async function hashPassword(password: string) {
+  const salt = await bcrypt.genSalt(12);
+  return bcrypt.hash(password, salt);
+}
+
 export function createSession(userId: string) {
   const sessionToken = jwt.sign({ userId }, SECRET_KEY, { expiresIn: '24h' });
   return sessionToken;
 }`;

const BREAKING_CHANGE_DIFF = `diff --git a/src/api.ts b/src/api.ts
index 1234567..abcdefg 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -5,10 +5,6 @@ export interface ApiConfig {
   timeout: number;
 }

-export function deprecatedEndpoint() {
-  return fetch("/old-api");
-}
-
 export function newEndpoint(config: ApiConfig) {
   return fetch(config.baseUrl, { timeout: config.timeout });
 }
@@ -20,7 +16,7 @@ export interface User {
   email: string;
 }

-export type UserId = string;
+export type UserId = number;

 export class ApiClient {
   constructor(private config: ApiConfig) {}`;

const TEST_FILE_DIFF = `diff --git a/src/utils.test.ts b/src/utils.test.ts
index 1234567..abcdefg 100644
--- a/src/utils.test.ts
+++ b/src/utils.test.ts
@@ -10,6 +10,14 @@ describe("utils", () => {
     expect(helper()).toBe(true);
   });

+  it("should test newHelper", () => {
+    expect(newHelper()).toBe(false);
+  });
+
+  it("should handle edge cases", () => {
+    expect(helper()).not.toBeNull();
+  });
+
   it("should work with existingFunction", () => {
     expect(existingFunction()).toBeDefined();
   });
 });`;

const DOCS_DIFF = `diff --git a/docs/guide.md b/docs/guide.md
index 1234567..abcdefg 100644
--- a/docs/guide.md
+++ b/docs/guide.md
@@ -10,6 +10,12 @@ This is the user guide.

 ## Getting Started

+### Installation
+
+Run the following command to install:
+
+\`\`\`bash
+npm install my-package
+\`\`\`
+
 ## Usage

 See examples below.`;

const DEPENDENCY_DIFF = `diff --git a/package.json b/package.json
index 1234567..abcdefg 100644
--- a/package.json
+++ b/package.json
@@ -10,7 +10,8 @@
   },
   "dependencies": {
     "express": "^4.18.0",
-    "lodash": "^4.17.0"
+    "lodash": "^4.17.21",
+    "axios": "^1.5.0"
   },
   "devDependencies": {
     "typescript": "^5.0.0"`;

const MULTI_FILE_DIFF = `diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,10 @@
+export function newFeature() {
+  return true;
+}
diff --git a/src/feature.test.ts b/src/feature.test.ts
new file mode 100644
index 0000000..abcdefg
--- /dev/null
+++ b/src/feature.test.ts
@@ -0,0 +1,8 @@
+import { describe, expect, it } from "vitest";
+import { newFeature } from "./feature.js";
+
+describe("newFeature", () => {
+  it("should return true", () => {
+    expect(newFeature()).toBe(true);
+  });
+});
diff --git a/docs/feature.md b/docs/feature.md
new file mode 100644
index 0000000..9876543
--- /dev/null
+++ b/docs/feature.md
@@ -0,0 +1,5 @@
+# Feature Documentation
+
+This is the new feature.`;

// ============================================================================
// Tests: parseDiff
// ============================================================================

describe("parseDiff", () => {
  it("should parse a simple diff with modifications", () => {
    const files = parseDiff(SIMPLE_DIFF);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/utils.ts");
    expect(files[0].changeType).toBe("modified");
    expect(files[0].additions).toBe(4);
    expect(files[0].deletions).toBe(0);
    expect(files[0].hunks).toHaveLength(1);
  });

  it("should parse a new file diff", () => {
    const files = parseDiff(NEW_FILE_DIFF);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/feature.ts");
    expect(files[0].changeType).toBe("added");
    expect(files[0].additions).toBe(20);
    expect(files[0].deletions).toBe(0);
  });

  it("should parse a deleted file diff", () => {
    const files = parseDiff(DELETED_FILE_DIFF);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/deprecated.ts");
    expect(files[0].changeType).toBe("deleted");
    expect(files[0].deletions).toBe(10);
  });

  it("should parse a renamed file diff", () => {
    const files = parseDiff(RENAMED_FILE_DIFF);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/new-name.ts");
    expect(files[0].changeType).toBe("renamed");
    expect(files[0].oldPath).toBe("src/old-name.ts");
  });

  it("should parse multiple files", () => {
    const files = parseDiff(MULTI_FILE_DIFF);

    expect(files).toHaveLength(3);
    expect(files[0].path).toBe("src/feature.ts");
    expect(files[1].path).toBe("src/feature.test.ts");
    expect(files[2].path).toBe("docs/feature.md");
  });

  it("should handle empty diff", () => {
    const files = parseDiff("");
    expect(files).toHaveLength(0);
  });
});

// ============================================================================
// Tests: analyzeDiff - Category Detection
// ============================================================================

describe("analyzeDiff - category detection", () => {
  it("should detect feature from conventional commit prefix", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "feat(utils): add newHelper function",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("feature");
    expect(result.primaryCategory).toBe("feature");
    expect(result.confidence).toBe("high");
  });

  it("should detect bugfix from commit message", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "fix(utils): resolve issue with helper function",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("bugfix");
    expect(result.priority).toBe("high");
  });

  it("should detect bugfix from issue reference", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "Fixes #123: Handle edge case",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("bugfix");
  });

  it("should detect test changes from file path", () => {
    const input: DiffInput = {
      diff: TEST_FILE_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("test");
    expect(result.priority).toBe("low");
  });

  it("should detect docs changes from file path", () => {
    const input: DiffInput = {
      diff: DOCS_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("docs");
    expect(result.priority).toBe("low");
  });

  it("should detect dependency changes", () => {
    const input: DiffInput = {
      diff: DEPENDENCY_DIFF,
      commitMessage: "chore(deps): bump lodash and add axios",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("dependency");
  });

  it("should detect refactor from commit message", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "refactor: cleanup utility functions",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("refactor");
  });

  it("should detect performance changes", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "perf: optimize helper function",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("performance");
    expect(result.priority).toBe("medium");
  });

  it("should detect chore from commit message", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "chore: update config files",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("chore");
  });

  it("should detect categories from labels", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      labels: ["enhancement", "feature"],
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("feature");
  });

  it("should handle multiple categories", () => {
    const input: DiffInput = {
      diff: MULTI_FILE_DIFF,
      commitMessage: "feat: add new feature with tests and docs",
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("feature");
    expect(result.categories).toContain("test");
    expect(result.categories).toContain("docs");
    expect(result.files).toHaveLength(3);
  });
});

// ============================================================================
// Tests: analyzeDiff - Security Detection
// ============================================================================

describe("analyzeDiff - security detection", () => {
  it("should detect security changes from code patterns", () => {
    const input: DiffInput = {
      diff: SECURITY_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.isSecurity).toBe(true);
    expect(result.categories).toContain("security");
    expect(result.securitySignals.length).toBeGreaterThan(0);
    expect(result.priority).toBe("high");
  });

  it("should detect security from commit message", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "security: fix XSS vulnerability in input handling",
    };

    const result = analyzeDiff(input);

    expect(result.isSecurity).toBe(true);
    expect(result.securitySignals.some((s) => s.type === "vulnerability-fix")).toBe(true);
  });

  it("should detect CVE references", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "fix: patch CVE-2024-12345 vulnerability",
    };

    const result = analyzeDiff(input);

    expect(result.isSecurity).toBe(true);
    expect(result.securitySignals.some((s) => s.severity === "critical")).toBe(true);
    expect(result.priority).toBe("critical");
  });

  it("should detect dependabot updates", () => {
    const input: DiffInput = {
      diff: DEPENDENCY_DIFF,
      prTitle: "Dependabot: bump axios from 1.4.0 to 1.5.0",
    };

    const result = analyzeDiff(input);

    expect(result.isSecurity).toBe(true);
    expect(result.securitySignals.some((s) => s.type === "dependency-security")).toBe(true);
  });

  it("should detect security from labels", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      labels: ["security", "high-priority"],
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("security");
  });

  it("should detect authentication changes", () => {
    const diff = `diff --git a/src/login.ts b/src/login.ts
index 1234567..abcdefg 100644
--- a/src/login.ts
+++ b/src/login.ts
@@ -10,6 +10,10 @@ export async function login(username: string, password: string) {
   const token = await authenticateUser(username, password);
   return token;
 }
+
+export async function validateSession(sessionId: string) {
+  return checkSessionValidity(sessionId);
+}`;

    const input: DiffInput = { diff };
    const result = analyzeDiff(input);

    expect(result.isSecurity).toBe(true);
    expect(result.securitySignals.some((s) => s.type === "authentication")).toBe(true);
  });

  it("should detect input validation changes", () => {
    const diff = `diff --git a/src/input.ts b/src/input.ts
index 1234567..abcdefg 100644
--- a/src/input.ts
+++ b/src/input.ts
@@ -10,6 +10,10 @@ export function processInput(input: string) {
   return input.trim();
 }
+
+export function sanitizeHtml(input: string) {
+  return escapeHtml(input);
+}`;

    const input: DiffInput = { diff };
    const result = analyzeDiff(input);

    expect(result.isSecurity).toBe(true);
    expect(result.securitySignals.some((s) => s.type === "input-validation")).toBe(true);
  });
});

// ============================================================================
// Tests: analyzeDiff - Breaking Change Detection
// ============================================================================

describe("analyzeDiff - breaking change detection", () => {
  it("should detect breaking changes from code", () => {
    const input: DiffInput = {
      diff: BREAKING_CHANGE_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.isBreaking).toBe(true);
    expect(result.categories).toContain("breaking");
    expect(result.breakingSignals.length).toBeGreaterThan(0);
    expect(result.priority).toBe("high");
  });

  it("should detect BREAKING CHANGE in commit message", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "feat!: BREAKING CHANGE: remove deprecated API",
    };

    const result = analyzeDiff(input);

    expect(result.isBreaking).toBe(true);
    expect(result.breakingSignals.some((s) => s.type === "behavior-change")).toBe(true);
  });

  it("should detect API removal from commit message", () => {
    const input: DiffInput = {
      diff: DELETED_FILE_DIFF,
      commitMessage: "chore: removes deprecated API endpoints",
    };

    const result = analyzeDiff(input);

    expect(result.isBreaking).toBe(true);
    expect(result.breakingSignals.some((s) => s.type === "api-removal")).toBe(true);
  });

  it("should detect breaking from labels", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      labels: ["breaking-change"],
    };

    const result = analyzeDiff(input);

    expect(result.categories).toContain("breaking");
  });

  it("should detect migration required", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      prBody: "This change requires a migration. Please run the migration script.",
    };

    const result = analyzeDiff(input);

    expect(result.isBreaking).toBe(true);
    expect(result.breakingSignals.some((s) => s.type === "config-change")).toBe(true);
  });

  it("should detect function removal", () => {
    const input: DiffInput = {
      diff: BREAKING_CHANGE_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.breakingSignals.some((s) => s.type === "api-removal")).toBe(true);
  });

  it("should detect type changes", () => {
    const input: DiffInput = {
      diff: BREAKING_CHANGE_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.breakingSignals.some((s) => s.type === "type-change")).toBe(true);
  });
});

// ============================================================================
// Tests: analyzeDiff - Priority
// ============================================================================

describe("analyzeDiff - priority", () => {
  it("should assign critical priority for CVE fixes", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "fix: patch CVE-2024-12345",
    };

    const result = analyzeDiff(input);

    expect(result.priority).toBe("critical");
  });

  it("should assign high priority for security changes", () => {
    const input: DiffInput = {
      diff: SECURITY_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.priority).toBe("high");
  });

  it("should assign high priority for breaking changes", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "feat!: BREAKING CHANGE: new API",
    };

    const result = analyzeDiff(input);

    expect(result.priority).toBe("high");
  });

  it("should assign high priority for bugfixes", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "fix: resolve crash on startup",
    };

    const result = analyzeDiff(input);

    expect(result.priority).toBe("high");
  });

  it("should assign medium priority for features", () => {
    const input: DiffInput = {
      diff: NEW_FILE_DIFF,
      commitMessage: "feat: add new feature",
    };

    const result = analyzeDiff(input);

    expect(result.priority).toBe("medium");
  });

  it("should assign low priority for docs", () => {
    const input: DiffInput = {
      diff: DOCS_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.priority).toBe("low");
  });

  it("should assign low priority for tests", () => {
    const input: DiffInput = {
      diff: TEST_FILE_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.priority).toBe("low");
  });
});

// ============================================================================
// Tests: analyzeDiff - Summary
// ============================================================================

describe("analyzeDiff - summary", () => {
  it("should generate summary for simple change", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "feat: add helper",
    };

    const result = analyzeDiff(input);

    expect(result.summary).toContain("feature");
    expect(result.summary).toContain("1 file");
  });

  it("should indicate security in summary", () => {
    const input: DiffInput = {
      diff: SECURITY_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result.summary).toContain("Security-related");
  });

  it("should indicate breaking in summary", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "BREAKING CHANGE: remove old API",
    };

    const result = analyzeDiff(input);

    expect(result.summary).toContain("Breaking");
  });

  it("should include multiple categories in summary", () => {
    const input: DiffInput = {
      diff: MULTI_FILE_DIFF,
      commitMessage: "feat: add feature with tests",
    };

    const result = analyzeDiff(input);

    expect(result.summary).toContain("also:");
    expect(result.summary).toContain("3 files");
  });
});

// ============================================================================
// Tests: hasSecurityIndicators
// ============================================================================

describe("hasSecurityIndicators", () => {
  it("should return true for security commit message", () => {
    const input: DiffInput = {
      diff: "",
      commitMessage: "security: fix vulnerability",
    };

    expect(hasSecurityIndicators(input)).toBe(true);
  });

  it("should return true for CVE reference", () => {
    const input: DiffInput = {
      diff: "",
      commitMessage: "fix: CVE-2024-12345",
    };

    expect(hasSecurityIndicators(input)).toBe(true);
  });

  it("should return true for security code patterns", () => {
    const input: DiffInput = {
      diff: "+ const hash = await bcrypt.hash(password, 10);",
    };

    expect(hasSecurityIndicators(input)).toBe(true);
  });

  it("should return false for regular changes", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "feat: add helper",
    };

    expect(hasSecurityIndicators(input)).toBe(false);
  });
});

// ============================================================================
// Tests: hasBreakingIndicators
// ============================================================================

describe("hasBreakingIndicators", () => {
  it("should return true for BREAKING CHANGE", () => {
    const input: DiffInput = {
      diff: "",
      commitMessage: "BREAKING CHANGE: remove old API",
    };

    expect(hasBreakingIndicators(input)).toBe(true);
  });

  it("should return true for remove API", () => {
    const input: DiffInput = {
      diff: "",
      commitMessage: "chore: removes deprecated API endpoints",
    };

    expect(hasBreakingIndicators(input)).toBe(true);
  });

  it("should return true for migration required", () => {
    const input: DiffInput = {
      diff: "",
      prBody: "Migration required for this change",
    };

    expect(hasBreakingIndicators(input)).toBe(true);
  });

  it("should return false for regular changes", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "feat: add helper",
    };

    expect(hasBreakingIndicators(input)).toBe(false);
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("should handle empty input", () => {
    const input: DiffInput = {
      diff: "",
    };

    const result = analyzeDiff(input);

    expect(result.primaryCategory).toBe("chore");
    expect(result.files).toHaveLength(0);
    expect(result.priority).toBe("low");
  });

  it("should handle missing optional fields", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
    };

    const result = analyzeDiff(input);

    expect(result).toBeDefined();
    expect(result.categories.length).toBeGreaterThan(0);
  });

  it("should prioritize security over other categories", () => {
    const input: DiffInput = {
      diff: SECURITY_DIFF,
      commitMessage: "feat: add password hashing",
    };

    const result = analyzeDiff(input);

    expect(result.primaryCategory).toBe("security");
    expect(result.categories.indexOf("security")).toBeLessThan(
      result.categories.indexOf("feature"),
    );
  });

  it("should prioritize breaking over feature", () => {
    const input: DiffInput = {
      diff: SIMPLE_DIFF,
      commitMessage: "feat!: BREAKING CHANGE: new API design",
    };

    const result = analyzeDiff(input);

    expect(result.categories.indexOf("breaking")).toBeLessThan(
      result.categories.indexOf("feature"),
    );
  });

  it("should deduplicate security signals", () => {
    const diff = `diff --git a/src/auth.ts b/src/auth.ts
index 1234567..abcdefg 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,6 @@
+const token1 = jwt.sign(data);
+const token2 = jwt.verify(token);
+const token3 = validateToken(input);
 export function auth() {}`;

    const input: DiffInput = { diff };
    const result = analyzeDiff(input);

    // Should only have one authentication signal, not three
    const authSignals = result.securitySignals.filter((s) => s.type === "authentication");
    expect(authSignals).toHaveLength(1);
  });
});
