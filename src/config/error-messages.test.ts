/**
 * Tests for improved error messages across the codebase.
 *
 * These tests verify that error messages are:
 * 1. Specific - clearly state what went wrong
 * 2. Actionable - provide guidance on how to fix the issue
 * 3. Contextual - include relevant details for debugging
 */

import { describe, expect, it } from "vitest";

import { MissingEnvVarError } from "./env-substitution.js";
import { CircularIncludeError } from "./includes.js";

describe("Error Messages", () => {
  describe("MissingEnvVarError", () => {
    it("includes the variable name and config path", () => {
      const error = new MissingEnvVarError(
        "ANTHROPIC_API_KEY",
        "models.providers.anthropic.apiKey",
      );

      expect(error.varName).toBe("ANTHROPIC_API_KEY");
      expect(error.configPath).toBe("models.providers.anthropic.apiKey");
      expect(error.message).toContain("ANTHROPIC_API_KEY");
      expect(error.message).toContain("models.providers.anthropic.apiKey");
    });

    it("provides export command example", () => {
      const error = new MissingEnvVarError("MY_API_KEY", "some.path");

      expect(error.message).toContain('export MY_API_KEY="your-value"');
    });

    it("suggests adding to shell profile", () => {
      const error = new MissingEnvVarError("MY_API_KEY", "some.path");

      expect(error.message).toContain("~/.bashrc");
      expect(error.message).toContain("~/.zshrc");
    });

    it("suggests gimli.json env.vars alternative", () => {
      const error = new MissingEnvVarError("MY_API_KEY", "some.path");

      expect(error.message).toContain("env.vars");
      expect(error.message).toContain('"MY_API_KEY"');
    });

    it("recommends running gimli doctor", () => {
      const error = new MissingEnvVarError("MY_API_KEY", "some.path");

      expect(error.message).toContain("gimli doctor");
    });

    it("warns about sensitive values", () => {
      const error = new MissingEnvVarError("SECRET_KEY", "some.path");

      expect(error.message).toContain("sensitive");
    });

    it("has correct error name", () => {
      const error = new MissingEnvVarError("MY_VAR", "path");

      expect(error.name).toBe("MissingEnvVarError");
    });
  });

  describe("CircularIncludeError", () => {
    it("shows the include chain clearly", () => {
      const chain = ["/home/user/config.json", "/home/user/base.json", "/home/user/config.json"];
      const error = new CircularIncludeError(chain);

      expect(error.chain).toEqual(chain);
      expect(error.message).toContain("/home/user/config.json");
      expect(error.message).toContain("/home/user/base.json");
    });

    it("identifies the file causing the cycle", () => {
      const chain = ["a.json", "b.json", "c.json", "a.json"];
      const error = new CircularIncludeError(chain);

      expect(error.includePath).toBe("a.json");
      expect(error.message).toContain('"a.json" creates a circular dependency');
    });

    it("provides actionable fix suggestions", () => {
      const chain = ["config.json", "base.json", "config.json"];
      const error = new CircularIncludeError(chain);

      expect(error.message).toContain("$include directives");
      expect(error.message).toContain("break the cycle");
      expect(error.message).toContain("base file");
    });

    it("has correct error name", () => {
      const error = new CircularIncludeError(["a.json", "b.json", "a.json"]);

      expect(error.name).toBe("CircularIncludeError");
    });

    it("formats multi-file chains readably", () => {
      const chain = ["root.json", "level1.json", "level2.json", "level3.json", "root.json"];
      const error = new CircularIncludeError(chain);

      // Should use newlines with arrows for readability
      expect(error.message).toContain("->");
    });
  });
});
