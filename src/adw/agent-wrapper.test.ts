import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createAgentWrapper, createAgentStep } from "./agent-wrapper.js";
import type { AgentCallInput, AgentCallOutput } from "./types.js";

describe("AgentWrapper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic calls", () => {
    it("executes a simple agent call with stub executor", async () => {
      const wrapper = createAgentWrapper();

      const callPromise = wrapper.call({
        prompt: "Hello, world!",
      });
      await vi.runAllTimersAsync();
      const result = await callPromise;

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.output.text).toContain("Stub response");
        expect(result.output.provider).toBe("stub");
        expect(result.attempts).toBe(1);
      }
    });

    it("uses custom executor when provided", async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        text: "Custom response",
        model: "test-model",
        provider: "test-provider",
      });

      const wrapper = createAgentWrapper({ executor: mockExecutor });

      const input: AgentCallInput = {
        prompt: "Test prompt",
        config: { model: "custom-model" },
      };

      const callPromise = wrapper.call(input);
      await vi.runAllTimersAsync();
      const result = await callPromise;

      expect(mockExecutor).toHaveBeenCalledWith(input);
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.output.text).toBe("Custom response");
      }
    });

    it("merges default config with call config", async () => {
      const receivedInput: AgentCallInput[] = [];

      const mockExecutor = vi.fn().mockImplementation((input: AgentCallInput) => {
        receivedInput.push(input);
        return Promise.resolve({ text: "Response", model: "test" });
      });

      const wrapper = createAgentWrapper({
        executor: mockExecutor,
        defaultConfig: {
          model: "default-model",
          provider: "default-provider",
          temperature: 0.5,
        },
      });

      const callPromise = wrapper.call({
        prompt: "Test",
        config: { model: "override-model" },
      });
      await vi.runAllTimersAsync();
      await callPromise;

      expect(receivedInput[0]?.config).toEqual({
        model: "override-model",
        provider: "default-provider",
        temperature: 0.5,
      });
    });
  });

  describe("validation", () => {
    it("validates input before execution", async () => {
      const wrapper = createAgentWrapper({
        validateInput: (input) => {
          if (!input.prompt.trim()) {
            return "Prompt cannot be empty";
          }
          return true;
        },
      });

      // Valid input
      const validPromise = wrapper.call({ prompt: "Hello" });
      await vi.runAllTimersAsync();
      const validResult = await validPromise;
      expect(validResult.status).toBe("success");

      // Invalid input
      const invalidPromise = wrapper.call({ prompt: "   " });
      await vi.runAllTimersAsync();
      const invalidResult = await invalidPromise;
      expect(invalidResult.status).toBe("error");
      if (invalidResult.status === "error") {
        expect(invalidResult.error).toBe("Prompt cannot be empty");
        expect(invalidResult.attempts).toBe(0);
      }
    });

    it("validates output after execution", async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({ text: "", model: "test" })
        .mockResolvedValueOnce({ text: "Valid response", model: "test" });

      const wrapper = createAgentWrapper({
        executor: mockExecutor,
        validateOutput: (output) => {
          if (!output.text.trim()) {
            return "Response cannot be empty";
          }
          return true;
        },
        defaultRetry: { maxAttempts: 1 },
      });

      // First call returns empty, should fail validation
      const failPromise = wrapper.call({ prompt: "Test" });
      await vi.runAllTimersAsync();
      const failResult = await failPromise;
      expect(failResult.status).toBe("error");
      if (failResult.status === "error") {
        expect(failResult.error).toBe("Response cannot be empty");
      }
    });
  });

  describe("retry logic", () => {
    it("retries on transient errors", async () => {
      let attempts = 0;

      const mockExecutor = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          const error = new Error("rate limit exceeded");
          return Promise.reject(error);
        }
        return Promise.resolve({ text: "Success", model: "test" });
      });

      const wrapper = createAgentWrapper({
        executor: mockExecutor,
        defaultRetry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          jitter: 0,
        },
      });

      const callPromise = wrapper.call({ prompt: "Test" });
      await vi.runAllTimersAsync();
      const result = await callPromise;

      expect(result.status).toBe("success");
      expect(result.attempts).toBe(3);
    });

    it("does not retry non-retryable errors", async () => {
      let attempts = 0;

      const mockExecutor = vi.fn().mockImplementation(() => {
        attempts++;
        return Promise.reject(new Error("Invalid API key"));
      });

      const wrapper = createAgentWrapper({
        executor: mockExecutor,
        defaultRetry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          jitter: 0,
          isRetryable: (error) => {
            const message = error instanceof Error ? error.message : String(error);
            return !message.includes("Invalid API key");
          },
        },
      });

      const callPromise = wrapper.call({ prompt: "Test" });
      await vi.runAllTimersAsync();
      const result = await callPromise;

      expect(result.status).toBe("error");
      expect(attempts).toBe(1);
    });

    it("calls onRetry callback", async () => {
      let attempts = 0;
      const retryEvents: { attempt: number; maxAttempts: number }[] = [];

      const mockExecutor = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new Error("timeout"));
        }
        return Promise.resolve({ text: "Success", model: "test" });
      });

      const wrapper = createAgentWrapper({
        executor: mockExecutor,
        defaultRetry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          jitter: 0,
        },
        onRetry: (_, attempt, maxAttempts) => {
          retryEvents.push({ attempt, maxAttempts });
        },
      });

      const callPromise = wrapper.call({ prompt: "Test" });
      await vi.runAllTimersAsync();
      await callPromise;

      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0]).toEqual({ attempt: 1, maxAttempts: 3 });
    });
  });

  describe("callbacks", () => {
    it("calls onBeforeCall before execution", async () => {
      const beforeCalls: string[] = [];

      const wrapper = createAgentWrapper({
        onBeforeCall: (input, callId) => {
          beforeCalls.push(`${input.prompt}:${callId}`);
        },
      });

      const callPromise = wrapper.call({ prompt: "Test" });
      await vi.runAllTimersAsync();
      await callPromise;

      expect(beforeCalls).toHaveLength(1);
      expect(beforeCalls[0]).toContain("Test:");
    });

    it("calls onAfterCall after execution", async () => {
      const afterCalls: { prompt: string; status: string }[] = [];

      const wrapper = createAgentWrapper({
        onAfterCall: (log) => {
          afterCalls.push({
            prompt: log.input.prompt,
            status: log.result.status,
          });
        },
      });

      const callPromise = wrapper.call({ prompt: "Test" });
      await vi.runAllTimersAsync();
      await callPromise;

      expect(afterCalls).toHaveLength(1);
      expect(afterCalls[0]).toEqual({ prompt: "Test", status: "success" });
    });
  });

  describe("call logs", () => {
    it("maintains call history", async () => {
      const wrapper = createAgentWrapper();

      await vi.runAllTimersAsync();
      const call1Promise = wrapper.call({ prompt: "First" });
      await vi.runAllTimersAsync();
      await call1Promise;

      const call2Promise = wrapper.call({ prompt: "Second" });
      await vi.runAllTimersAsync();
      await call2Promise;

      const logs = wrapper.getCallLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0]?.input.prompt).toBe("First");
      expect(logs[1]?.input.prompt).toBe("Second");
    });

    it("clears call logs", async () => {
      const wrapper = createAgentWrapper();

      const callPromise = wrapper.call({ prompt: "Test" });
      await vi.runAllTimersAsync();
      await callPromise;

      expect(wrapper.getCallLogs()).toHaveLength(1);

      wrapper.clearCallLogs();
      expect(wrapper.getCallLogs()).toHaveLength(0);
    });
  });

  describe("sequence calls", () => {
    it("executes calls in sequence", async () => {
      const executionOrder: string[] = [];

      const mockExecutor = vi.fn().mockImplementation((input: AgentCallInput) => {
        executionOrder.push(input.prompt);
        return Promise.resolve({ text: `Response to ${input.prompt}`, model: "test" });
      });

      const wrapper = createAgentWrapper({ executor: mockExecutor });

      const callPromise = wrapper.callSequence([
        { prompt: "First" },
        { prompt: "Second" },
        { prompt: "Third" },
      ]);
      await vi.runAllTimersAsync();
      const results = await callPromise;

      expect(results).toHaveLength(3);
      expect(executionOrder).toEqual(["First", "Second", "Third"]);
      expect(results.every((r) => r.status === "success")).toBe(true);
    });

    it("stops on error when stopOnError is true", async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({ text: "First", model: "test" })
        .mockRejectedValueOnce(new Error("Second failed"))
        .mockResolvedValueOnce({ text: "Third", model: "test" });

      const wrapper = createAgentWrapper({
        executor: mockExecutor,
        defaultRetry: { maxAttempts: 1 },
      });

      const callPromise = wrapper.callSequence(
        [{ prompt: "First" }, { prompt: "Second" }, { prompt: "Third" }],
        { stopOnError: true },
      );
      await vi.runAllTimersAsync();
      const results = await callPromise;

      expect(results).toHaveLength(2);
      expect(results[0]?.status).toBe("success");
      expect(results[1]?.status).toBe("error");
    });

    it("continues on error when stopOnError is false", async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({ text: "First", model: "test" })
        .mockRejectedValueOnce(new Error("Second failed"))
        .mockResolvedValueOnce({ text: "Third", model: "test" });

      const wrapper = createAgentWrapper({
        executor: mockExecutor,
        defaultRetry: { maxAttempts: 1 },
      });

      const callPromise = wrapper.callSequence(
        [{ prompt: "First" }, { prompt: "Second" }, { prompt: "Third" }],
        { stopOnError: false },
      );
      await vi.runAllTimersAsync();
      const results = await callPromise;

      expect(results).toHaveLength(3);
      expect(results[0]?.status).toBe("success");
      expect(results[1]?.status).toBe("error");
      expect(results[2]?.status).toBe("success");
    });
  });

  describe("parallel calls", () => {
    it("executes calls in parallel", async () => {
      const mockExecutor = vi.fn().mockImplementation((input: AgentCallInput) => {
        return Promise.resolve({ text: `Response to ${input.prompt}`, model: "test" });
      });

      const wrapper = createAgentWrapper({ executor: mockExecutor });

      const callPromise = wrapper.callParallel([
        { prompt: "First" },
        { prompt: "Second" },
        { prompt: "Third" },
      ]);
      await vi.runAllTimersAsync();
      const results = await callPromise;

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "success")).toBe(true);
    });

    it("respects maxConcurrency limit", async () => {
      const concurrentCalls: number[] = [];
      let currentConcurrent = 0;

      const mockExecutor = vi.fn().mockImplementation(async (input: AgentCallInput) => {
        currentConcurrent++;
        concurrentCalls.push(currentConcurrent);
        await new Promise((resolve) => setTimeout(resolve, 50));
        currentConcurrent--;
        return { text: `Response to ${input.prompt}`, model: "test" };
      });

      const wrapper = createAgentWrapper({ executor: mockExecutor });

      const callPromise = wrapper.callParallel(
        [{ prompt: "1" }, { prompt: "2" }, { prompt: "3" }, { prompt: "4" }, { prompt: "5" }],
        { maxConcurrency: 2 },
      );
      await vi.runAllTimersAsync();
      const results = await callPromise;

      expect(results).toHaveLength(5);
      // Max concurrent should never exceed 2
      expect(Math.max(...concurrentCalls)).toBeLessThanOrEqual(2);
    });
  });

  describe("createAgentStep", () => {
    it("creates a step for workflow integration", async () => {
      const wrapper = createAgentWrapper();
      const step = createAgentStep("test-step", "Test Step", "Generate a greeting");

      expect(step.id).toBe("test-step");
      expect(step.name).toBe("Test Step");

      const context = { wrapper };
      const executePromise = step.execute(undefined, context);
      await vi.runAllTimersAsync();
      const result = (await executePromise) as AgentCallOutput;

      expect(result.text).toContain("Stub response");
    });

    it("uses template function for dynamic prompts", async () => {
      const receivedPrompts: string[] = [];

      const mockExecutor = vi.fn().mockImplementation((input: AgentCallInput) => {
        receivedPrompts.push(input.prompt);
        return Promise.resolve({ text: "Response", model: "test" });
      });

      const wrapper = createAgentWrapper({ executor: mockExecutor });
      const step = createAgentStep(
        "dynamic-step",
        "Dynamic Step",
        (input: { name: string }) => `Hello, ${input.name}!`,
      );

      const context = { wrapper };
      const executePromise = step.execute({ name: "World" }, context);
      await vi.runAllTimersAsync();
      await executePromise;

      expect(receivedPrompts[0]).toBe("Hello, World!");
    });

    it("validates and transforms output", async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        text: '{"result": 42}',
        model: "test",
      });

      const wrapper = createAgentWrapper({ executor: mockExecutor });
      const step = createAgentStep("validated-step", "Validated Step", "Generate JSON", {
        validate: (output) => (output.text.startsWith("{") ? true : "Expected JSON"),
        transform: (output) => JSON.parse(output.text),
      });

      const context = { wrapper };
      const executePromise = step.execute(undefined, context);
      await vi.runAllTimersAsync();
      const result = await executePromise;

      expect(result).toEqual({ result: 42 });
    });
  });
});
