import { describe, expect, it } from "vitest";
import type { GimliConfig } from "../../config/config.js";
import { resolveSandboxRuntimeStatus } from "./runtime-status.js";

describe("sandbox runtime status", () => {
  describe("non-main mode sandboxes non-main sessions", () => {
    it("sandboxes sessions that do not match the main session key", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "alice" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:alice:debug",
      });

      expect(result.sandboxed).toBe(true);
      expect(result.mode).toBe("non-main");
      expect(result.agentId).toBe("alice");
    });

    it("sandboxes named sessions different from main", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:work-project",
      });

      expect(result.sandboxed).toBe(true);
      expect(result.mode).toBe("non-main");
    });

    it("sandboxes group sessions", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "group:telegram:12345",
      });

      expect(result.sandboxed).toBe(true);
    });

    it("sandboxes DM sessions", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "dm:discord:user123",
      });

      expect(result.sandboxed).toBe(true);
    });

    it("does not sandbox the main session", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:main",
      });

      expect(result.sandboxed).toBe(false);
      expect(result.mainSessionKey).toBe("agent:main:main");
    });

    it("does not sandbox custom main session key", () => {
      const cfg: GimliConfig = {
        session: { mainKey: "work" },
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "alice" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:alice:work",
      });

      expect(result.sandboxed).toBe(false);
      expect(result.mainSessionKey).toBe("agent:alice:work");
    });

    it("sandboxes sessions when main key is customized but session differs", () => {
      const cfg: GimliConfig = {
        session: { mainKey: "work" },
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "alice" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:alice:personal",
      });

      expect(result.sandboxed).toBe(true);
    });
  });

  describe("all mode sandboxes all sessions", () => {
    it("sandboxes the main session", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "all" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:main",
      });

      expect(result.sandboxed).toBe(true);
      expect(result.mode).toBe("all");
    });

    it("sandboxes non-main sessions", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "all" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:debug",
      });

      expect(result.sandboxed).toBe(true);
    });
  });

  describe("off mode sandboxes nothing", () => {
    it("does not sandbox main session", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "off" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:main",
      });

      expect(result.sandboxed).toBe(false);
      expect(result.mode).toBe("off");
    });

    it("does not sandbox non-main sessions", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "off" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:debug",
      });

      expect(result.sandboxed).toBe(false);
    });
  });

  describe("default mode is off", () => {
    it("defaults to off when no sandbox config specified", () => {
      const cfg: GimliConfig = {
        agents: {
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:debug",
      });

      expect(result.sandboxed).toBe(false);
      expect(result.mode).toBe("off");
    });

    it("defaults to off with empty config", () => {
      const cfg: GimliConfig = {};

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:debug",
      });

      expect(result.sandboxed).toBe(false);
      expect(result.mode).toBe("off");
    });
  });

  describe("agent-specific sandbox overrides", () => {
    it("uses agent-specific mode over global defaults", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "off" },
          },
          list: [
            {
              id: "secure-agent",
              sandbox: { mode: "non-main" },
            },
          ],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:secure-agent:debug",
      });

      expect(result.sandboxed).toBe(true);
      expect(result.mode).toBe("non-main");
    });

    it("applies global defaults when agent has no override", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "regular-agent" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:regular-agent:debug",
      });

      expect(result.sandboxed).toBe(true);
    });
  });

  describe("global session scope", () => {
    it("uses global main key when scope is global", () => {
      const cfg: GimliConfig = {
        session: { scope: "global" },
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "alice" }, { id: "bob" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "global",
      });

      expect(result.sandboxed).toBe(false);
      expect(result.mainSessionKey).toBe("global");
    });

    it("sandboxes non-global sessions when scope is global", () => {
      const cfg: GimliConfig = {
        session: { scope: "global" },
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "alice" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:alice:work",
      });

      expect(result.sandboxed).toBe(true);
    });
  });

  describe("tool policy in runtime status", () => {
    it("includes tool policy in result", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:debug",
      });

      expect(result.toolPolicy).toBeDefined();
      expect(result.toolPolicy.allow).toBeDefined();
      expect(result.toolPolicy.deny).toBeDefined();
    });
  });

  describe("empty or missing session key", () => {
    it("does not sandbox when session key is empty", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "",
      });

      expect(result.sandboxed).toBe(false);
    });

    it("does not sandbox when session key is undefined", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: {
            sandbox: { mode: "all" },
          },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: undefined,
      });

      expect(result.sandboxed).toBe(false);
    });
  });
});
