/**
 * Tests for the process tool - managing background shell execution sessions.
 *
 * The process tool provides 10 actions for interacting with long-running processes:
 * - list: List all running and finished sessions
 * - poll: Drain new output and check exit status
 * - log: Read aggregated output with pagination
 * - write: Send stdin data to a session
 * - send-keys: Send keyboard input (tested in bash-tools.process.send-keys.test.ts)
 * - submit: Send carriage return (tested in bash-tools.process.send-keys.test.ts)
 * - paste: Send text with bracketed paste mode
 * - kill: Terminate a running session
 * - clear: Remove finished session from memory
 * - remove: Kill if running, or clear if finished
 */

import { beforeEach, describe, expect, it } from "vitest";

import { resetProcessRegistryForTests } from "./bash-process-registry";
import { createExecTool } from "./bash-tools.exec";
import { createProcessTool } from "./bash-tools.process";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  resetProcessRegistryForTests();
});

describe("process tool - list action", () => {
  it("returns empty list when no sessions exist", async () => {
    const processTool = createProcessTool();
    const result = await processTool.execute("toolcall", { action: "list" });

    expect(result.content[0].text).toBe("No running or recent sessions.");
    expect(result.details.status).toBe("completed");
    expect(result.details.sessions).toHaveLength(0);
  });

  it("lists running sessions with correct metadata", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    // Start a background process that sleeps for a while
    const execResult = await execTool.execute("toolcall", {
      command: "sleep 10",
      background: true,
    });

    expect(execResult.details.status).toBe("running");
    const sessionId = execResult.details.sessionId;

    const listResult = await processTool.execute("toolcall", { action: "list" });

    expect(listResult.details.status).toBe("completed");
    expect(listResult.details.sessions).toHaveLength(1);

    const session = listResult.details.sessions[0];
    expect(session.sessionId).toBe(sessionId);
    expect(session.status).toBe("running");
    expect(session.command).toBe("sleep 10");
    expect(session.runtimeMs).toBeGreaterThanOrEqual(0);

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });

  it("lists finished sessions with exit code", async () => {
    const scopeKey = "test-finished-sessions";
    const execTool = createExecTool({ scopeKey });
    const processTool = createProcessTool({ scopeKey });

    // Start a quick background process
    const execResult = await execTool.execute("toolcall", {
      command: "echo done",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for process to complete
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await wait(50);
      const poll = await processTool.execute("toolcall", { action: "poll", sessionId });
      if (poll.details.status !== "running") break;
    }

    const listResult = await processTool.execute("toolcall", { action: "list" });

    expect(listResult.details.sessions).toHaveLength(1);
    const session = listResult.details.sessions[0];
    expect(session.sessionId).toBe(sessionId);
    expect(session.status).toBe("completed");
    expect(session.exitCode).toBe(0);
  });

  it("lists multiple sessions", async () => {
    const scopeKey = "test-multiple-sessions";
    const execTool = createExecTool({ scopeKey });
    const processTool = createProcessTool({ scopeKey });

    // Start first process
    const exec1 = await execTool.execute("toolcall", {
      command: "sleep 10",
      background: true,
    });
    const session1 = exec1.details.sessionId;

    // Start second process
    const exec2 = await execTool.execute("toolcall", {
      command: "sleep 20",
      background: true,
    });
    const session2 = exec2.details.sessionId;

    const listResult = await processTool.execute("toolcall", { action: "list" });

    expect(listResult.details.sessions).toHaveLength(2);

    // Verify both sessions are listed with correct IDs
    const sessionIds = listResult.details.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(sessionIds).toContain(session1);
    expect(sessionIds).toContain(session2);

    // Verify each session has expected metadata
    const sessions = listResult.details.sessions;
    for (const session of sessions) {
      expect(session.status).toBe("running");
      expect(session.startedAt).toBeGreaterThan(0);
      expect(session.runtimeMs).toBeGreaterThanOrEqual(0);
    }

    // The text output should be sorted (newest first) - verify format
    expect(listResult.content[0].text).toContain(session1);
    expect(listResult.content[0].text).toContain(session2);

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId: session1 });
    await processTool.execute("toolcall", { action: "kill", sessionId: session2 });
  });
});

describe("process tool - poll action", () => {
  it("returns new output from running session", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: 'echo "hello world"; sleep 5',
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for output
    await wait(200);

    const pollResult = await processTool.execute("toolcall", {
      action: "poll",
      sessionId,
    });

    expect(pollResult.details.status).toBe("running");
    expect(pollResult.content[0].text).toContain("hello world");
    expect(pollResult.content[0].text).toContain("Process still running.");

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });

  it("returns exit code when process completes", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: 'echo "done"',
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for completion
    const deadline = Date.now() + 3000;
    let pollResult;
    while (Date.now() < deadline) {
      await wait(50);
      pollResult = await processTool.execute("toolcall", { action: "poll", sessionId });
      if (pollResult.details.status !== "running") break;
    }

    expect(pollResult.details.status).toBe("completed");
    expect(pollResult.details.exitCode).toBe(0);
    expect(pollResult.content[0].text).toContain("done");
    expect(pollResult.content[0].text).toContain("Process exited with code 0");
  });

  it("returns failed status for non-zero exit code", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: "exit 42",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for completion
    const deadline = Date.now() + 3000;
    let pollResult;
    while (Date.now() < deadline) {
      await wait(50);
      pollResult = await processTool.execute("toolcall", { action: "poll", sessionId });
      if (pollResult.details.status !== "running") break;
    }

    expect(pollResult.details.status).toBe("failed");
    expect(pollResult.details.exitCode).toBe(42);
    expect(pollResult.content[0].text).toContain("code 42");
  });

  it("requires sessionId parameter", async () => {
    const processTool = createProcessTool();

    const result = await processTool.execute("toolcall", { action: "poll" });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toBe("sessionId is required for this action.");
  });

  it("returns error for non-existent session", async () => {
    const processTool = createProcessTool();

    const result = await processTool.execute("toolcall", {
      action: "poll",
      sessionId: "non-existent-id",
    });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toContain("No session found");
  });
});

describe("process tool - log action", () => {
  it("returns full output from running session", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: 'echo "line1"; echo "line2"; echo "line3"; sleep 5',
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for output
    await wait(200);

    // Poll to populate aggregated output
    await processTool.execute("toolcall", { action: "poll", sessionId });

    const logResult = await processTool.execute("toolcall", {
      action: "log",
      sessionId,
    });

    expect(logResult.details.status).toBe("running");
    expect(logResult.content[0].text).toContain("line1");
    expect(logResult.content[0].text).toContain("line2");
    expect(logResult.content[0].text).toContain("line3");

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });

  it("supports offset and limit pagination", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: 'for i in $(seq 1 10); do echo "line$i"; done; sleep 5',
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for output
    await wait(300);

    // Poll to populate aggregated output
    await processTool.execute("toolcall", { action: "poll", sessionId });

    const logResult = await processTool.execute("toolcall", {
      action: "log",
      sessionId,
      offset: 2,
      limit: 3,
    });

    expect(logResult.details.status).toBe("running");
    // Should contain lines 3, 4, 5 (0-indexed offset 2, limit 3)
    expect(logResult.content[0].text).toContain("line3");
    expect(logResult.content[0].text).toContain("line4");
    expect(logResult.content[0].text).toContain("line5");
    expect(logResult.content[0].text).not.toContain("line1");
    expect(logResult.content[0].text).not.toContain("line2");

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });

  it("returns log from finished session", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: 'echo "finished output"',
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for completion
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await wait(50);
      const poll = await processTool.execute("toolcall", { action: "poll", sessionId });
      if (poll.details.status !== "running") break;
    }

    const logResult = await processTool.execute("toolcall", {
      action: "log",
      sessionId,
    });

    expect(logResult.details.status).toBe("completed");
    expect(logResult.content[0].text).toContain("finished output");
    expect(logResult.details.exitCode).toBe(0);
  });

  it("requires sessionId parameter", async () => {
    const processTool = createProcessTool();

    const result = await processTool.execute("toolcall", { action: "log" });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toBe("sessionId is required for this action.");
  });
});

describe("process tool - write action", () => {
  it("writes data to session stdin", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    // Start a cat process that echoes stdin to stdout
    const execResult = await execTool.execute("toolcall", {
      command: "cat",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Write data to stdin
    const writeResult = await processTool.execute("toolcall", {
      action: "write",
      sessionId,
      data: "hello from stdin\n",
    });

    expect(writeResult.details.status).toBe("running");
    expect(writeResult.content[0].text).toContain("Wrote 17 bytes");

    // Wait for output
    await wait(200);

    // Poll to get output
    const pollResult = await processTool.execute("toolcall", {
      action: "poll",
      sessionId,
    });

    expect(pollResult.content[0].text).toContain("hello from stdin");

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });

  it("closes stdin with eof flag", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    // Start a cat process
    const execResult = await execTool.execute("toolcall", {
      command: "cat",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Write data and close stdin
    const writeResult = await processTool.execute("toolcall", {
      action: "write",
      sessionId,
      data: "final data",
      eof: true,
    });

    expect(writeResult.content[0].text).toContain("stdin closed");

    // Wait for process to finish (cat exits when stdin closes)
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await wait(50);
      const poll = await processTool.execute("toolcall", { action: "poll", sessionId });
      if (poll.details.status !== "running") break;
    }

    const finalPoll = await processTool.execute("toolcall", {
      action: "poll",
      sessionId,
    });

    expect(finalPoll.details.status).toBe("completed");
  });

  it("returns error for non-existent session", async () => {
    const processTool = createProcessTool();

    const result = await processTool.execute("toolcall", {
      action: "write",
      sessionId: "non-existent",
      data: "test",
    });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toContain("No active session found");
  });
});

describe("process tool - paste action", () => {
  it("pastes text with bracketed paste mode by default", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: "cat",
      background: true,
      pty: true,
    });

    const sessionId = execResult.details.sessionId;

    const pasteResult = await processTool.execute("toolcall", {
      action: "paste",
      sessionId,
      text: "pasted content",
    });

    expect(pasteResult.details.status).toBe("running");
    expect(pasteResult.content[0].text).toContain("Pasted 14 chars");

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });

  it("pastes empty text with bracketed paste markers", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: "cat",
      background: true,
      pty: true,
    });

    const sessionId = execResult.details.sessionId;

    // Empty text still sends bracketed paste markers (ESC[200~ ESC[201~)
    const pasteResult = await processTool.execute("toolcall", {
      action: "paste",
      sessionId,
      text: "",
    });

    expect(pasteResult.details.status).toBe("running");
    expect(pasteResult.content[0].text).toContain("Pasted 0 chars");

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });
});

describe("process tool - kill action", () => {
  it("terminates a running session", async () => {
    const execTool = createExecTool();
    const processTool = createProcessTool();

    const execResult = await execTool.execute("toolcall", {
      command: "sleep 60",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Verify running
    const listBefore = await processTool.execute("toolcall", { action: "list" });
    expect(listBefore.details.sessions[0].status).toBe("running");

    // Kill it
    const killResult = await processTool.execute("toolcall", {
      action: "kill",
      sessionId,
    });

    expect(killResult.content[0].text).toContain("Killed session");
    expect(killResult.details.status).toBe("failed"); // Kill results in failed status

    // Verify finished
    const listAfter = await processTool.execute("toolcall", { action: "list" });
    expect(listAfter.details.sessions[0].status).toBe("failed");
    expect(listAfter.details.sessions[0].exitSignal).toBe("SIGKILL");
  });

  it("returns error for non-existent session", async () => {
    const processTool = createProcessTool();

    const result = await processTool.execute("toolcall", {
      action: "kill",
      sessionId: "non-existent",
    });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toContain("No active session found");
  });
});

describe("process tool - clear action", () => {
  it("removes a finished session from memory", async () => {
    const scopeKey = "test-clear-finished";
    const execTool = createExecTool({ scopeKey });
    const processTool = createProcessTool({ scopeKey });

    // Create and complete a session
    const execResult = await execTool.execute("toolcall", {
      command: "echo done",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for completion
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await wait(50);
      const poll = await processTool.execute("toolcall", { action: "poll", sessionId });
      if (poll.details.status !== "running") break;
    }

    // Verify session exists
    const listBefore = await processTool.execute("toolcall", { action: "list" });
    expect(listBefore.details.sessions).toHaveLength(1);

    // Clear it
    const clearResult = await processTool.execute("toolcall", {
      action: "clear",
      sessionId,
    });

    expect(clearResult.content[0].text).toContain("Cleared session");
    expect(clearResult.details.status).toBe("completed");

    // Verify removed
    const listAfter = await processTool.execute("toolcall", { action: "list" });
    expect(listAfter.details.sessions).toHaveLength(0);
  });

  it("returns error when clearing running session", async () => {
    const scopeKey = "test-clear-running";
    const execTool = createExecTool({ scopeKey });
    const processTool = createProcessTool({ scopeKey });

    const execResult = await execTool.execute("toolcall", {
      command: "sleep 60",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    const clearResult = await processTool.execute("toolcall", {
      action: "clear",
      sessionId,
    });

    expect(clearResult.details.status).toBe("failed");
    expect(clearResult.content[0].text).toContain("No finished session found");

    // Clean up
    await processTool.execute("toolcall", { action: "kill", sessionId });
  });
});

describe("process tool - remove action", () => {
  it("kills and removes a running session", async () => {
    const scopeKey = "test-remove-running";
    const execTool = createExecTool({ scopeKey });
    const processTool = createProcessTool({ scopeKey });

    const execResult = await execTool.execute("toolcall", {
      command: "sleep 60",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    const removeResult = await processTool.execute("toolcall", {
      action: "remove",
      sessionId,
    });

    expect(removeResult.content[0].text).toContain("Removed session");
    expect(removeResult.details.status).toBe("failed"); // Killed = failed status

    // The session should now be in finished list
    const listResult = await processTool.execute("toolcall", { action: "list" });
    expect(listResult.details.sessions[0].status).toBe("failed");
  });

  it("clears a finished session", async () => {
    const scopeKey = "test-remove-finished";
    const execTool = createExecTool({ scopeKey });
    const processTool = createProcessTool({ scopeKey });

    // Create and complete a session
    const execResult = await execTool.execute("toolcall", {
      command: "echo done",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Wait for completion
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      await wait(50);
      const poll = await processTool.execute("toolcall", { action: "poll", sessionId });
      if (poll.details.status !== "running") break;
    }

    const removeResult = await processTool.execute("toolcall", {
      action: "remove",
      sessionId,
    });

    expect(removeResult.content[0].text).toContain("Removed session");
    expect(removeResult.details.status).toBe("completed");

    // Verify removed
    const listAfter = await processTool.execute("toolcall", { action: "list" });
    expect(listAfter.details.sessions).toHaveLength(0);
  });

  it("returns error for non-existent session", async () => {
    const processTool = createProcessTool();

    const result = await processTool.execute("toolcall", {
      action: "remove",
      sessionId: "non-existent",
    });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toContain("No session found");
  });
});

describe("process tool - unknown action", () => {
  it("returns error for unknown action", async () => {
    const processTool = createProcessTool();

    // Need to provide a sessionId to get past the sessionId check
    const result = await processTool.execute("toolcall", {
      action: "unknown-action",
      sessionId: "any-id",
    });

    expect(result.details.status).toBe("failed");
    expect(result.content[0].text).toContain("Unknown action");
  });
});

describe("process tool - scope isolation", () => {
  it("sessions are isolated by scope key", async () => {
    const execTool = createExecTool({ scopeKey: "agent1" });
    const processToolAgent1 = createProcessTool({ scopeKey: "agent1" });
    const processToolAgent2 = createProcessTool({ scopeKey: "agent2" });

    // Create a session scoped to agent1
    const execResult = await execTool.execute("toolcall", {
      command: "sleep 60",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Agent1 can see the session
    const list1 = await processToolAgent1.execute("toolcall", { action: "list" });
    expect(list1.details.sessions).toHaveLength(1);

    // Agent2 cannot see the session
    const list2 = await processToolAgent2.execute("toolcall", { action: "list" });
    expect(list2.details.sessions).toHaveLength(0);

    // Agent2 cannot poll the session
    const poll2 = await processToolAgent2.execute("toolcall", {
      action: "poll",
      sessionId,
    });
    expect(poll2.details.status).toBe("failed");
    expect(poll2.content[0].text).toContain("No session found");

    // Clean up with agent1
    await processToolAgent1.execute("toolcall", { action: "kill", sessionId });
  });

  it("no scope key sees all sessions", async () => {
    const execToolScoped = createExecTool({ scopeKey: "scoped-agent" });
    const processToolGlobal = createProcessTool(); // No scope key

    const execResult = await execToolScoped.execute("toolcall", {
      command: "sleep 60",
      background: true,
    });

    const sessionId = execResult.details.sessionId;

    // Global process tool can see all sessions
    const listResult = await processToolGlobal.execute("toolcall", { action: "list" });
    expect(listResult.details.sessions).toHaveLength(1);

    // Clean up
    await processToolGlobal.execute("toolcall", { action: "kill", sessionId });
  });
});
