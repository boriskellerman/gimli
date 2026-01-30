import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { createEditTool, createReadTool, createWriteTool } from "@mariozechner/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertRequiredParams,
  CLAUDE_PARAM_GROUPS,
  createGimliReadTool,
  createSandboxedEditTool,
  createSandboxedReadTool,
  createSandboxedWriteTool,
  normalizeToolParams,
  wrapToolParamNormalization,
} from "./pi-tools.read.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

/**
 * Comprehensive tests for file tools (read, write, edit)
 * PRD Phase 2 - Tools: Test `read`, `write`, `edit` file tools
 */

describe("File Tools - read, write, edit", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-file-tools-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("Read Tool", () => {
    describe("Basic functionality", () => {
      it("reads a text file successfully", async () => {
        const testFile = path.join(tmpDir, "test.txt");
        await fs.writeFile(testFile, "Hello, World!", "utf8");

        const baseTool = createReadTool(tmpDir) as unknown as AnyAgentTool;
        const readTool = createGimliReadTool(baseTool);

        const result = (await readTool.execute("test-1", {
          path: testFile,
        })) as AgentToolResult<unknown>;

        expect(result.content).toBeDefined();
        const content = Array.isArray(result.content) ? result.content : [];
        const textBlock = content.find(
          (b): b is { type: "text"; text: string } =>
            !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
        );
        expect(textBlock?.text).toContain("Hello, World!");
      });

      it("reads a file with line numbers", async () => {
        const testFile = path.join(tmpDir, "lines.txt");
        await fs.writeFile(testFile, "Line 1\nLine 2\nLine 3", "utf8");

        const baseTool = createReadTool(tmpDir) as unknown as AnyAgentTool;
        const readTool = createGimliReadTool(baseTool);

        const result = (await readTool.execute("test-2", {
          path: testFile,
        })) as AgentToolResult<unknown>;

        const content = Array.isArray(result.content) ? result.content : [];
        const textBlock = content.find(
          (b): b is { type: "text"; text: string } =>
            !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
        );
        expect(textBlock?.text).toContain("Line 1");
        expect(textBlock?.text).toContain("Line 2");
        expect(textBlock?.text).toContain("Line 3");
      });

      it("handles empty files", async () => {
        const testFile = path.join(tmpDir, "empty.txt");
        await fs.writeFile(testFile, "", "utf8");

        const baseTool = createReadTool(tmpDir) as unknown as AnyAgentTool;
        const readTool = createGimliReadTool(baseTool);

        const result = (await readTool.execute("test-3", {
          path: testFile,
        })) as AgentToolResult<unknown>;

        expect(result.content).toBeDefined();
      });

      it("throws error for non-existent file", async () => {
        const testFile = path.join(tmpDir, "nonexistent.txt");

        const baseTool = createReadTool(tmpDir) as unknown as AnyAgentTool;
        const readTool = createGimliReadTool(baseTool);

        await expect(
          readTool.execute("test-4", {
            path: testFile,
          }),
        ).rejects.toThrow();
      });

      it("reads file using file_path alias (Claude Code compatibility)", async () => {
        const testFile = path.join(tmpDir, "alias.txt");
        await fs.writeFile(testFile, "Alias test", "utf8");

        const baseTool = createReadTool(tmpDir) as unknown as AnyAgentTool;
        const readTool = createGimliReadTool(baseTool);

        const result = (await readTool.execute("test-5", {
          file_path: testFile,
        })) as AgentToolResult<unknown>;

        const content = Array.isArray(result.content) ? result.content : [];
        const textBlock = content.find(
          (b): b is { type: "text"; text: string } =>
            !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
        );
        expect(textBlock?.text).toContain("Alias test");
      });
    });

    describe("Sandboxed read tool", () => {
      it("reads files within sandbox root", async () => {
        const testFile = path.join(tmpDir, "sandboxed.txt");
        await fs.writeFile(testFile, "Sandboxed content", "utf8");

        const readTool = createSandboxedReadTool(tmpDir);

        const result = (await readTool.execute("test-6", {
          path: testFile,
        })) as AgentToolResult<unknown>;

        const content = Array.isArray(result.content) ? result.content : [];
        const textBlock = content.find(
          (b): b is { type: "text"; text: string } =>
            !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
        );
        expect(textBlock?.text).toContain("Sandboxed content");
      });

      it("blocks reading files outside sandbox root", async () => {
        const outsidePath = path.join(os.tmpdir(), `gimli-outside-${Date.now()}.txt`);
        await fs.writeFile(outsidePath, "outside", "utf8");

        try {
          const readTool = createSandboxedReadTool(tmpDir);
          await expect(readTool.execute("test-7", { path: outsidePath })).rejects.toThrow(
            /sandbox root/i,
          );
        } finally {
          await fs.rm(outsidePath, { force: true });
        }
      });

      it("blocks reading files using file_path alias outside sandbox", async () => {
        const outsidePath = path.join(os.tmpdir(), `gimli-outside-${Date.now()}.txt`);
        await fs.writeFile(outsidePath, "outside", "utf8");

        try {
          const readTool = createSandboxedReadTool(tmpDir);
          await expect(readTool.execute("test-8", { file_path: outsidePath })).rejects.toThrow(
            /sandbox root/i,
          );
        } finally {
          await fs.rm(outsidePath, { force: true });
        }
      });

      it("blocks path traversal attempts", async () => {
        const readTool = createSandboxedReadTool(tmpDir);

        await expect(readTool.execute("test-9", { path: "../../../etc/passwd" })).rejects.toThrow(
          /sandbox root/i,
        );
      });

      it("reads file using relative path within sandbox", async () => {
        const testFile = path.join(tmpDir, "relative.txt");
        await fs.writeFile(testFile, "Relative path", "utf8");

        const readTool = createSandboxedReadTool(tmpDir);

        const result = (await readTool.execute("test-10", {
          path: "relative.txt",
        })) as AgentToolResult<unknown>;

        const content = Array.isArray(result.content) ? result.content : [];
        const textBlock = content.find(
          (b): b is { type: "text"; text: string } =>
            !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
        );
        expect(textBlock?.text).toContain("Relative path");
      });
    });
  });

  describe("Write Tool", () => {
    describe("Basic functionality", () => {
      it("creates a new file", async () => {
        const testFile = path.join(tmpDir, "new-file.txt");
        const writeTool = wrapToolParamNormalization(
          createWriteTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.write,
        );

        await writeTool.execute("test-1", {
          path: testFile,
          content: "New file content",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("New file content");
      });

      it("overwrites existing file", async () => {
        const testFile = path.join(tmpDir, "overwrite.txt");
        await fs.writeFile(testFile, "Original content", "utf8");

        const writeTool = wrapToolParamNormalization(
          createWriteTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.write,
        );

        await writeTool.execute("test-2", {
          path: testFile,
          content: "New content",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("New content");
      });

      it("creates file using file_path alias (Claude Code compatibility)", async () => {
        const testFile = path.join(tmpDir, "alias-write.txt");
        const writeTool = wrapToolParamNormalization(
          createWriteTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.write,
        );

        await writeTool.execute("test-3", {
          file_path: testFile,
          content: "Alias content",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Alias content");
      });

      it("creates nested directories if needed", async () => {
        const testFile = path.join(tmpDir, "nested", "dir", "file.txt");
        const writeTool = wrapToolParamNormalization(
          createWriteTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.write,
        );

        await writeTool.execute("test-4", {
          path: testFile,
          content: "Nested content",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Nested content");
      });

      it("writes multiline content", async () => {
        const testFile = path.join(tmpDir, "multiline.txt");
        const writeTool = wrapToolParamNormalization(
          createWriteTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.write,
        );

        await writeTool.execute("test-5", {
          path: testFile,
          content: "Line 1\nLine 2\nLine 3",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Line 1\nLine 2\nLine 3");
      });

      it("writes empty content", async () => {
        const testFile = path.join(tmpDir, "empty-write.txt");
        const writeTool = wrapToolParamNormalization(
          createWriteTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.write,
        );

        await writeTool.execute("test-6", {
          path: testFile,
          content: "",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("");
      });
    });

    describe("Sandboxed write tool", () => {
      it("writes files within sandbox root", async () => {
        const testFile = path.join(tmpDir, "sandboxed-write.txt");
        const writeTool = createSandboxedWriteTool(tmpDir);

        await writeTool.execute("test-7", {
          path: testFile,
          content: "Sandboxed write",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Sandboxed write");
      });

      it("blocks writing files outside sandbox root", async () => {
        const outsidePath = path.join(os.tmpdir(), `gimli-outside-${Date.now()}.txt`);

        try {
          const writeTool = createSandboxedWriteTool(tmpDir);
          await expect(
            writeTool.execute("test-8", {
              path: outsidePath,
              content: "Should fail",
            }),
          ).rejects.toThrow(/sandbox root/i);
        } finally {
          await fs.rm(outsidePath, { force: true }).catch(() => {});
        }
      });

      it("blocks path traversal attempts on write", async () => {
        const writeTool = createSandboxedWriteTool(tmpDir);

        await expect(
          writeTool.execute("test-9", {
            path: "../../../tmp/escape.txt",
            content: "Should fail",
          }),
        ).rejects.toThrow(/sandbox root/i);
      });
    });
  });

  describe("Edit Tool", () => {
    describe("Basic functionality", () => {
      it("replaces text in a file", async () => {
        const testFile = path.join(tmpDir, "edit.txt");
        await fs.writeFile(testFile, "Hello, World!", "utf8");

        const editTool = wrapToolParamNormalization(
          createEditTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.edit,
        );

        await editTool.execute("test-1", {
          path: testFile,
          oldText: "World",
          newText: "Gimli",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Hello, Gimli!");
      });

      it("replaces multiline text", async () => {
        const testFile = path.join(tmpDir, "multiline-edit.txt");
        await fs.writeFile(testFile, "Line 1\nLine 2\nLine 3", "utf8");

        const editTool = wrapToolParamNormalization(
          createEditTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.edit,
        );

        await editTool.execute("test-2", {
          path: testFile,
          oldText: "Line 2",
          newText: "Modified Line",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Line 1\nModified Line\nLine 3");
      });

      it("uses Claude Code parameter aliases (old_string, new_string)", async () => {
        const testFile = path.join(tmpDir, "alias-edit.txt");
        await fs.writeFile(testFile, "Original text", "utf8");

        const editTool = wrapToolParamNormalization(
          createEditTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.edit,
        );

        await editTool.execute("test-3", {
          file_path: testFile,
          old_string: "Original",
          new_string: "Modified",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Modified text");
      });

      it("rejects empty newText (delete operations require non-empty replacement)", async () => {
        const testFile = path.join(tmpDir, "delete-edit.txt");
        await fs.writeFile(testFile, "Hello, World!", "utf8");

        const editTool = wrapToolParamNormalization(
          createEditTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.edit,
        );

        // The wrapped edit tool enforces non-empty newText - this is by design
        // to prevent accidental deletions. Users must use explicit replacement text.
        await expect(
          editTool.execute("test-4", {
            path: testFile,
            oldText: ", World",
            newText: "",
          }),
        ).rejects.toThrow(/Missing required parameter/);
      });

      it("inserts text (replace empty match)", async () => {
        const testFile = path.join(tmpDir, "insert-edit.txt");
        await fs.writeFile(testFile, "HelloWorld", "utf8");

        const editTool = wrapToolParamNormalization(
          createEditTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.edit,
        );

        await editTool.execute("test-5", {
          path: testFile,
          oldText: "Hello",
          newText: "Hello, ",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Hello, World");
      });

      it("throws error when old text not found", async () => {
        const testFile = path.join(tmpDir, "notfound-edit.txt");
        await fs.writeFile(testFile, "Hello, World!", "utf8");

        const editTool = wrapToolParamNormalization(
          createEditTool(tmpDir) as unknown as AnyAgentTool,
          CLAUDE_PARAM_GROUPS.edit,
        );

        await expect(
          editTool.execute("test-6", {
            path: testFile,
            oldText: "NotFound",
            newText: "Replacement",
          }),
        ).rejects.toThrow();
      });
    });

    describe("Sandboxed edit tool", () => {
      it("edits files within sandbox root", async () => {
        const testFile = path.join(tmpDir, "sandboxed-edit.txt");
        await fs.writeFile(testFile, "Sandbox content", "utf8");

        const editTool = createSandboxedEditTool(tmpDir);

        await editTool.execute("test-7", {
          path: testFile,
          oldText: "Sandbox",
          newText: "Modified",
        });

        const content = await fs.readFile(testFile, "utf8");
        expect(content).toBe("Modified content");
      });

      it("blocks editing files outside sandbox root", async () => {
        const outsidePath = path.join(os.tmpdir(), `gimli-outside-${Date.now()}.txt`);
        await fs.writeFile(outsidePath, "outside", "utf8");

        try {
          const editTool = createSandboxedEditTool(tmpDir);
          await expect(
            editTool.execute("test-8", {
              path: outsidePath,
              oldText: "outside",
              newText: "modified",
            }),
          ).rejects.toThrow(/sandbox root/i);
        } finally {
          await fs.rm(outsidePath, { force: true });
        }
      });

      it("blocks path traversal attempts on edit", async () => {
        const editTool = createSandboxedEditTool(tmpDir);

        await expect(
          editTool.execute("test-9", {
            path: "../../../etc/passwd",
            oldText: "root",
            newText: "hacked",
          }),
        ).rejects.toThrow(/sandbox root/i);
      });
    });
  });

  describe("Parameter Normalization", () => {
    describe("normalizeToolParams", () => {
      it("converts file_path to path", () => {
        const result = normalizeToolParams({ file_path: "/test/file.txt" });
        expect(result).toEqual({ path: "/test/file.txt" });
      });

      it("converts old_string to oldText", () => {
        const result = normalizeToolParams({ old_string: "old" });
        expect(result).toEqual({ oldText: "old" });
      });

      it("converts new_string to newText", () => {
        const result = normalizeToolParams({ new_string: "new" });
        expect(result).toEqual({ newText: "new" });
      });

      it("preserves path when both file_path and path are present", () => {
        const result = normalizeToolParams({
          file_path: "/ignored",
          path: "/used",
        });
        expect(result).toEqual({ file_path: "/ignored", path: "/used" });
      });

      it("preserves oldText when both old_string and oldText are present", () => {
        const result = normalizeToolParams({
          old_string: "ignored",
          oldText: "used",
        });
        expect(result).toEqual({ old_string: "ignored", oldText: "used" });
      });

      it("handles multiple aliases at once", () => {
        const result = normalizeToolParams({
          file_path: "/test.txt",
          old_string: "old",
          new_string: "new",
        });
        expect(result).toEqual({
          path: "/test.txt",
          oldText: "old",
          newText: "new",
        });
      });

      it("returns undefined for non-object input", () => {
        expect(normalizeToolParams(null)).toBeUndefined();
        expect(normalizeToolParams(undefined)).toBeUndefined();
        expect(normalizeToolParams("string")).toBeUndefined();
        expect(normalizeToolParams(123)).toBeUndefined();
      });
    });

    describe("assertRequiredParams", () => {
      it("passes when at least one key in group is present", () => {
        const params = { path: "/test.txt" };
        expect(() => assertRequiredParams(params, CLAUDE_PARAM_GROUPS.read, "read")).not.toThrow();
      });

      it("passes when alias key is present", () => {
        const params = { file_path: "/test.txt" };
        expect(() => assertRequiredParams(params, CLAUDE_PARAM_GROUPS.read, "read")).not.toThrow();
      });

      it("throws when no key in group is present", () => {
        const params = { content: "hello" };
        expect(() => assertRequiredParams(params, CLAUDE_PARAM_GROUPS.read, "read")).toThrow(
          /Missing required parameter/,
        );
      });

      it("throws when value is empty string", () => {
        const params = { path: "   " };
        expect(() => assertRequiredParams(params, CLAUDE_PARAM_GROUPS.read, "read")).toThrow(
          /Missing required parameter/,
        );
      });

      it("validates all groups for edit tool", () => {
        const params = { path: "/test.txt", oldText: "old", newText: "new" };
        expect(() => assertRequiredParams(params, CLAUDE_PARAM_GROUPS.edit, "edit")).not.toThrow();
      });

      it("throws when edit tool is missing oldText", () => {
        const params = { path: "/test.txt", newText: "new" };
        expect(() => assertRequiredParams(params, CLAUDE_PARAM_GROUPS.edit, "edit")).toThrow(
          /Missing required parameter/,
        );
      });

      it("throws for undefined or null params", () => {
        expect(() => assertRequiredParams(undefined, CLAUDE_PARAM_GROUPS.read, "read")).toThrow(
          /Missing parameters/,
        );
        expect(() =>
          assertRequiredParams(
            null as unknown as Record<string, unknown>,
            CLAUDE_PARAM_GROUPS.read,
            "read",
          ),
        ).toThrow(/Missing parameters/);
      });
    });
  });

  describe("Integration - Full Workflow", () => {
    it("performs read-edit-read cycle correctly", async () => {
      const testFile = path.join(tmpDir, "workflow.txt");

      // Write initial file
      const writeTool = wrapToolParamNormalization(
        createWriteTool(tmpDir) as unknown as AnyAgentTool,
        CLAUDE_PARAM_GROUPS.write,
      );
      await writeTool.execute("write-1", {
        path: testFile,
        content: "function hello() {\n  return 'world';\n}",
      });

      // Read the file
      const baseTool = createReadTool(tmpDir) as unknown as AnyAgentTool;
      const readTool = createGimliReadTool(baseTool);
      const readResult1 = (await readTool.execute("read-1", {
        path: testFile,
      })) as AgentToolResult<unknown>;

      const content1 = Array.isArray(readResult1.content) ? readResult1.content : [];
      const textBlock1 = content1.find(
        (b): b is { type: "text"; text: string } =>
          !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
      );
      expect(textBlock1?.text).toContain("function hello()");

      // Edit the file
      const editTool = wrapToolParamNormalization(
        createEditTool(tmpDir) as unknown as AnyAgentTool,
        CLAUDE_PARAM_GROUPS.edit,
      );
      await editTool.execute("edit-1", {
        path: testFile,
        oldText: "return 'world'",
        newText: "return 'gimli'",
      });

      // Read again to verify
      const readResult2 = (await readTool.execute("read-2", {
        path: testFile,
      })) as AgentToolResult<unknown>;

      const content2 = Array.isArray(readResult2.content) ? readResult2.content : [];
      const textBlock2 = content2.find(
        (b): b is { type: "text"; text: string } =>
          !!b && typeof b === "object" && (b as { type?: unknown }).type === "text",
      );
      expect(textBlock2?.text).toContain("return 'gimli'");
    });

    it("sandboxed tools maintain isolation across operations", async () => {
      const insideFile = path.join(tmpDir, "inside.txt");
      const outsideFile = path.join(os.tmpdir(), `gimli-outside-${Date.now()}.txt`);
      await fs.writeFile(outsideFile, "outside", "utf8");

      try {
        const readTool = createSandboxedReadTool(tmpDir);
        const writeTool = createSandboxedWriteTool(tmpDir);
        const editTool = createSandboxedEditTool(tmpDir);

        // Write inside sandbox works
        await writeTool.execute("write-1", {
          path: insideFile,
          content: "inside content",
        });

        // Read inside sandbox works
        const readResult = (await readTool.execute("read-1", {
          path: insideFile,
        })) as AgentToolResult<unknown>;
        expect(readResult.content).toBeDefined();

        // Edit inside sandbox works
        await editTool.execute("edit-1", {
          path: insideFile,
          oldText: "inside",
          newText: "modified",
        });

        // All operations outside sandbox fail
        await expect(readTool.execute("read-2", { path: outsideFile })).rejects.toThrow(
          /sandbox root/i,
        );
        await expect(
          writeTool.execute("write-2", { path: outsideFile, content: "fail" }),
        ).rejects.toThrow(/sandbox root/i);
        await expect(
          editTool.execute("edit-2", { path: outsideFile, oldText: "a", newText: "b" }),
        ).rejects.toThrow(/sandbox root/i);
      } finally {
        await fs.rm(outsideFile, { force: true });
      }
    });
  });

  describe("Edge Cases", () => {
    it("handles files with special characters in name", async () => {
      const testFile = path.join(tmpDir, "special-chars-!@#.txt");
      const writeTool = wrapToolParamNormalization(
        createWriteTool(tmpDir) as unknown as AnyAgentTool,
        CLAUDE_PARAM_GROUPS.write,
      );

      await writeTool.execute("test-1", {
        path: testFile,
        content: "Special chars",
      });

      const content = await fs.readFile(testFile, "utf8");
      expect(content).toBe("Special chars");
    });

    it("handles files with unicode content", async () => {
      const testFile = path.join(tmpDir, "unicode.txt");
      const writeTool = wrapToolParamNormalization(
        createWriteTool(tmpDir) as unknown as AnyAgentTool,
        CLAUDE_PARAM_GROUPS.write,
      );

      await writeTool.execute("test-2", {
        path: testFile,
        content: "Hello 你好 مرحبا 🎉",
      });

      const content = await fs.readFile(testFile, "utf8");
      expect(content).toBe("Hello 你好 مرحبا 🎉");
    });

    it("handles very long file paths", async () => {
      const longDir = path.join(tmpDir, "a".repeat(50), "b".repeat(50));
      await fs.mkdir(longDir, { recursive: true });
      const testFile = path.join(longDir, "long-path.txt");

      const writeTool = wrapToolParamNormalization(
        createWriteTool(tmpDir) as unknown as AnyAgentTool,
        CLAUDE_PARAM_GROUPS.write,
      );

      await writeTool.execute("test-3", {
        path: testFile,
        content: "Long path content",
      });

      const content = await fs.readFile(testFile, "utf8");
      expect(content).toBe("Long path content");
    });

    it("handles binary content in write tool", async () => {
      const testFile = path.join(tmpDir, "binary.bin");
      const writeTool = wrapToolParamNormalization(
        createWriteTool(tmpDir) as unknown as AnyAgentTool,
        CLAUDE_PARAM_GROUPS.write,
      );

      const binaryContent = "\x00\x01\x02\x03";
      await writeTool.execute("test-4", {
        path: testFile,
        content: binaryContent,
      });

      const content = await fs.readFile(testFile, "utf8");
      expect(content).toBe(binaryContent);
    });

    it("preserves file permissions after edit", async () => {
      const testFile = path.join(tmpDir, "permissions.txt");
      await fs.writeFile(testFile, "Original", "utf8");
      await fs.chmod(testFile, 0o644);

      const statBefore = await fs.stat(testFile);

      const editTool = wrapToolParamNormalization(
        createEditTool(tmpDir) as unknown as AnyAgentTool,
        CLAUDE_PARAM_GROUPS.edit,
      );

      await editTool.execute("test-5", {
        path: testFile,
        oldText: "Original",
        newText: "Modified",
      });

      const statAfter = await fs.stat(testFile);
      // Check mode ignoring file type bits
      expect(statAfter.mode & 0o777).toBe(statBefore.mode & 0o777);
    });
  });
});
