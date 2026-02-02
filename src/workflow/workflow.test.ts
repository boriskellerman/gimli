import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWorkflowStore: vi.fn(),
}));

vi.mock("./store.js", () => ({
  createWorkflowStore: mocks.createWorkflowStore,
}));

vi.mock("../terminal/theme.js", () => ({
  theme: {
    error: (s: string) => s,
    warn: (s: string) => s,
    success: (s: string) => s,
    info: (s: string) => s,
    muted: (s: string) => s,
    accent: (s: string) => s,
  },
}));

import { workflowCommand } from "./workflow.js";

describe("workflow command", () => {
  const mockRuntime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn() as unknown as (code: number) => never,
  };

  const mockStore = {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addStep: vi.fn(),
    updateStep: vi.fn(),
    advanceStage: vi.fn(),
    getSummary: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createWorkflowStore.mockReturnValue(mockStore);
    mockStore.list.mockReturnValue([]);
    mockStore.getSummary.mockReturnValue(null);
  });

  describe("help", () => {
    it("shows help when no subcommand provided", async () => {
      await workflowCommand({}, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });

    it("shows help with help subcommand", async () => {
      await workflowCommand({ subcommand: "help" }, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Subcommands:"));
    });
  });

  describe("create subcommand", () => {
    it("requires name", async () => {
      await workflowCommand({ subcommand: "create" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("--name is required"));
    });

    it("creates workflow with name", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.create.mockReturnValue(mockWorkflow);

      await workflowCommand({ subcommand: "create", name: "Test workflow" }, mockRuntime);

      expect(mockStore.create).toHaveBeenCalledWith({
        name: "Test workflow",
        description: "",
      });
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Workflow created"));
    });

    it("creates workflow with name and description", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "My description",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.create.mockReturnValue(mockWorkflow);

      await workflowCommand(
        { subcommand: "create", name: "Test workflow", description: "My description" },
        mockRuntime,
      );

      expect(mockStore.create).toHaveBeenCalledWith({
        name: "Test workflow",
        description: "My description",
      });
    });

    it("outputs JSON when --json flag is set", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.create.mockReturnValue(mockWorkflow);

      await workflowCommand(
        { subcommand: "create", name: "Test workflow", json: true },
        mockRuntime,
      );

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"id"'));
    });
  });

  describe("list subcommand", () => {
    it("lists workflows", async () => {
      mockStore.list.mockReturnValue([
        {
          id: "wf-test-1",
          name: "Workflow 1",
          description: "",
          currentStage: "plan",
          steps: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          status: "active",
        },
      ]);
      mockStore.getSummary.mockReturnValue({
        id: "wf-test-1",
        name: "Workflow 1",
        status: "active",
        currentStage: "plan",
        progress: { completed: 0, total: 0, percentage: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await workflowCommand({ subcommand: "list" }, mockRuntime);

      expect(mockStore.list).toHaveBeenCalled();
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Workflows (1)"));
    });

    it("shows empty message when no workflows", async () => {
      mockStore.list.mockReturnValue([]);

      await workflowCommand({ subcommand: "list" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("No workflows found"));
    });

    it("filters by stage", async () => {
      mockStore.list.mockReturnValue([]);

      await workflowCommand({ subcommand: "list", stage: "build" }, mockRuntime);

      expect(mockStore.list).toHaveBeenCalledWith({ stage: "build", limit: 20 });
    });

    it("outputs JSON when --json flag is set", async () => {
      mockStore.list.mockReturnValue([]);

      await workflowCommand({ subcommand: "list", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"count"'));
    });
  });

  describe("show subcommand", () => {
    it("requires ID", async () => {
      await workflowCommand({ subcommand: "show" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("workflow ID is required"),
      );
    });

    it("shows workflow details", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "My description",
        currentStage: "build",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.get.mockReturnValue(mockWorkflow);
      mockStore.getSummary.mockReturnValue({
        id: "wf-test-123",
        name: "Test workflow",
        status: "active",
        currentStage: "build",
        progress: { completed: 0, total: 5, percentage: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await workflowCommand({ subcommand: "show", id: "wf-test-123" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Workflow:"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("build"));
    });

    it("shows error for non-existent workflow", async () => {
      mockStore.get.mockReturnValue(null);

      await workflowCommand({ subcommand: "show", id: "non-existent" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("No workflow found"));
    });

    it("outputs JSON when --json flag is set", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.get.mockReturnValue(mockWorkflow);

      await workflowCommand({ subcommand: "show", id: "wf-test-123", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"id"'));
    });
  });

  describe("advance subcommand", () => {
    it("requires ID", async () => {
      await workflowCommand({ subcommand: "advance" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("workflow ID is required"),
      );
    });

    it("advances workflow to next stage", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.get.mockReturnValue(mockWorkflow);
      mockStore.advanceStage.mockReturnValue({
        ...mockWorkflow,
        currentStage: "build",
      });

      await workflowCommand({ subcommand: "advance", id: "wf-test-123" }, mockRuntime);

      expect(mockStore.advanceStage).toHaveBeenCalledWith("wf-test-123");
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Advanced workflow"));
    });

    it("shows completion message when workflow completes", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "document",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.get.mockReturnValue(mockWorkflow);
      mockStore.advanceStage.mockReturnValue({
        ...mockWorkflow,
        status: "completed",
        completedAt: new Date(),
      });

      await workflowCommand({ subcommand: "advance", id: "wf-test-123" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Workflow completed"));
    });

    it("shows error for non-existent workflow", async () => {
      mockStore.get.mockReturnValue(null);

      await workflowCommand({ subcommand: "advance", id: "non-existent" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("No workflow found"));
    });
  });

  describe("step subcommand", () => {
    it("requires ID", async () => {
      await workflowCommand({ subcommand: "step" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("workflow ID is required"),
      );
    });

    it("requires valid stage", async () => {
      await workflowCommand({ subcommand: "step", id: "wf-test-123" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("--stage must be one of"),
      );
    });

    it("requires description", async () => {
      await workflowCommand({ subcommand: "step", id: "wf-test-123", stage: "plan" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("--description is required"),
      );
    });

    it("adds step to workflow", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      const mockStep = {
        id: "step-test-1",
        stage: "plan",
        description: "Define requirements",
        status: "pending",
        createdAt: new Date(),
      };
      mockStore.get.mockReturnValue(mockWorkflow);
      mockStore.addStep.mockReturnValue(mockStep);

      await workflowCommand(
        {
          subcommand: "step",
          id: "wf-test-123",
          stage: "plan",
          description: "Define requirements",
        },
        mockRuntime,
      );

      expect(mockStore.addStep).toHaveBeenCalledWith("wf-test-123", "plan", "Define requirements");
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Step added"));
    });

    it("shows error for invalid stage", async () => {
      await workflowCommand(
        {
          subcommand: "step",
          id: "wf-test-123",
          stage: "invalid",
          description: "Test",
        },
        mockRuntime,
      );

      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("--stage must be one of"),
      );
    });
  });

  describe("complete subcommand", () => {
    it("requires ID", async () => {
      await workflowCommand({ subcommand: "complete" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("workflow ID is required"),
      );
    });

    it("marks workflow as completed", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "document",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.get.mockReturnValue(mockWorkflow);
      mockStore.update.mockReturnValue({
        ...mockWorkflow,
        status: "completed",
        completedAt: new Date(),
      });

      await workflowCommand({ subcommand: "complete", id: "wf-test-123" }, mockRuntime);

      expect(mockStore.update).toHaveBeenCalledWith(
        "wf-test-123",
        expect.objectContaining({ status: "completed" }),
      );
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Workflow completed"));
    });

    it("shows error for non-existent workflow", async () => {
      mockStore.get.mockReturnValue(null);

      await workflowCommand({ subcommand: "complete", id: "non-existent" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("No workflow found"));
    });
  });

  describe("delete subcommand", () => {
    it("requires ID", async () => {
      await workflowCommand({ subcommand: "delete" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("workflow ID is required"),
      );
    });

    it("deletes workflow", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.get.mockReturnValue(mockWorkflow);
      mockStore.delete.mockReturnValue(true);

      await workflowCommand({ subcommand: "delete", id: "wf-test-123" }, mockRuntime);

      expect(mockStore.delete).toHaveBeenCalledWith("wf-test-123");
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Workflow deleted"));
    });

    it("shows error for non-existent workflow", async () => {
      mockStore.get.mockReturnValue(null);

      await workflowCommand({ subcommand: "delete", id: "non-existent" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("No workflow found"));
    });

    it("outputs JSON when --json flag is set", async () => {
      const mockWorkflow = {
        id: "wf-test-123",
        name: "Test workflow",
        description: "",
        currentStage: "plan",
        steps: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "active",
      };
      mockStore.get.mockReturnValue(mockWorkflow);
      mockStore.delete.mockReturnValue(true);

      await workflowCommand({ subcommand: "delete", id: "wf-test-123", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"deleted"'));
    });
  });

  describe("unknown subcommand", () => {
    it("shows error for unknown subcommand", async () => {
      await workflowCommand({ subcommand: "unknown" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("Unknown subcommand"));
    });
  });

  describe("store cleanup", () => {
    it("closes store on success", async () => {
      await workflowCommand({ subcommand: "list" }, mockRuntime);
      expect(mockStore.close).toHaveBeenCalled();
    });

    it("closes store on error", async () => {
      await workflowCommand({ subcommand: "create" }, mockRuntime);
      expect(mockStore.close).toHaveBeenCalled();
    });
  });
});
