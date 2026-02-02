import { describe, expect, it } from "vitest";

import {
  buildOrchestratorSystemPrompt,
  buildMinimalOrchestratorPrompt,
  buildGimliOrchestratorPrompt,
} from "./orchestrator-system-prompt.js";

describe("Orchestrator System Prompt", () => {
  describe("buildOrchestratorSystemPrompt", () => {
    it("builds prompt for coordinator role", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Orchestrator Agent");
      expect(prompt).toContain("Role: Coordinator");
      expect(prompt).toContain("Delegate Work");
      expect(prompt).toContain("Spawn Agents");
      expect(prompt).toContain("any agent type");
    });

    it("builds prompt for supervisor role", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "supervisor",
        managedAgents: ["agent-1", "agent-2"],
        canCreateAgents: false,
        canDeleteAgents: true,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Role: Supervisor");
      expect(prompt).toContain("Monitor Fleet");
      expect(prompt).toContain("Terminate Agents");
      expect(prompt).not.toContain("Spawn Agents");
    });

    it("builds prompt for planner role", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "planner",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Role: Planner");
      expect(prompt).toContain("Design Plans");
    });

    it("builds prompt for executor role", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "executor",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: true,
        canTriggerADWs: true,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Role: Executor");
      expect(prompt).toContain("Execute Plans");
      expect(prompt).toContain("Trigger ADWs");
    });

    it("includes ADW section when enabled", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "executor",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: true,
        canTriggerADWs: true,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Available AI Developer Workflows");
      expect(prompt).toContain("adw_trigger");
      expect(prompt).toContain("plan-build");
    });

    it("excludes ADW section when disabled", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      expect(prompt).not.toContain("adw_trigger");
    });

    it("includes managed agent list when not wildcard", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["frontend-agent", "backend-agent"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("frontend-agent, backend-agent");
    });

    it("includes label in header", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
        label: "Feature Team Orchestrator",
      });

      expect(prompt).toContain("Feature Team Orchestrator");
    });

    it("includes workspace directory", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/home/user/project",
      });

      expect(prompt).toContain("/home/user/project");
    });

    it("includes custom instructions", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
        customInstructions: "Always prioritize security tasks first.",
      });

      expect(prompt).toContain("Custom Instructions");
      expect(prompt).toContain("Always prioritize security tasks first");
    });

    it("includes requester context", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
        requesterContext: {
          sessionKey: "agent:main:session:123",
          origin: {
            channel: "telegram",
            accountId: "user-456",
          },
        },
      });

      expect(prompt).toContain("Requester Context");
      expect(prompt).toContain("agent:main:session:123");
      expect(prompt).toContain("telegram");
    });

    it("includes available tools section", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Available Tools");
      expect(prompt).toContain("sessions_spawn");
      expect(prompt).toContain("sessions_list");
      expect(prompt).toContain("sessions_history");
    });

    it("includes best practices", () => {
      const prompt = buildOrchestratorSystemPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Best Practices");
      expect(prompt).toContain("One Agent, One Task");
    });
  });

  describe("buildMinimalOrchestratorPrompt", () => {
    it("builds minimal prompt for sub-tasks", () => {
      const prompt = buildMinimalOrchestratorPrompt({
        task: "Implement the login feature",
        managedAgents: ["frontend-agent"],
      });

      expect(prompt).toContain("sub-agent");
      expect(prompt).toContain("Implement the login feature");
      expect(prompt).toContain("frontend-agent");
    });

    it("excludes agent list for wildcard", () => {
      const prompt = buildMinimalOrchestratorPrompt({
        task: "Build the feature",
        managedAgents: ["*"],
      });

      expect(prompt).not.toContain("Available Agents");
    });

    it("includes guidelines", () => {
      const prompt = buildMinimalOrchestratorPrompt({
        task: "Test task",
        managedAgents: [],
      });

      expect(prompt).toContain("Guidelines");
      expect(prompt).toContain("Focus on completing the assigned task");
    });
  });

  describe("buildGimliOrchestratorPrompt", () => {
    it("includes Gimli-specific knowledge", () => {
      const prompt = buildGimliOrchestratorPrompt({
        role: "executor",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: true,
        canTriggerADWs: true,
        workspaceDir: "/workspace",
      });

      expect(prompt).toContain("Gimli Codebase Knowledge");
      expect(prompt).toContain("Project Structure");
      expect(prompt).toContain("src/");
      expect(prompt).toContain("Key Commands");
      expect(prompt).toContain("pnpm build");
      expect(prompt).toContain("Security Principles");
    });

    it("includes base orchestrator prompt", () => {
      const prompt = buildGimliOrchestratorPrompt({
        role: "coordinator",
        managedAgents: ["*"],
        canCreateAgents: true,
        canDeleteAgents: false,
        canTriggerADWs: false,
        workspaceDir: "/workspace",
      });

      // Should include base prompt elements
      expect(prompt).toContain("Role: Coordinator");
      expect(prompt).toContain("Orchestrator Agent");
    });
  });
});
