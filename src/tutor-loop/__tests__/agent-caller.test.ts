import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { AgentCaller, type AgentResult } from "../agent-caller.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

describe("AgentCaller", () => {
  let mockRunAgentTurn: jest.Mock<
    (
      message: string,
      messages: MessageParam[],
      context: any,
    ) => Promise<AgentResult>
  >;
  let mockDisplayText: jest.Mock<(text: string) => void>;
  let mockDisplayToolStatus: jest.Mock<
    (toolName: string, status: "start" | "end") => void
  >;
  let mockDisplayError: jest.Mock<(message: string) => void>;
  let mockStartLoading: jest.Mock<() => void>;
  let mockStopLoading: jest.Mock<() => void>;
  let mockSetAgentRunning: jest.Mock<(running: boolean) => void>;
  let mockResetStreamState: jest.Mock<() => void>;

  beforeEach(() => {
    mockRunAgentTurn =
      jest.fn<
        (
          message: string,
          messages: MessageParam[],
          context: any,
        ) => Promise<AgentResult>
      >();
    mockDisplayText = jest.fn<(text: string) => void>();
    mockDisplayToolStatus =
      jest.fn<(toolName: string, status: "start" | "end") => void>();
    mockDisplayError = jest.fn<(message: string) => void>();
    mockStartLoading = jest.fn<() => void>();
    mockStopLoading = jest.fn<() => void>();
    mockSetAgentRunning = jest.fn<(running: boolean) => void>();
    mockResetStreamState = jest.fn<() => void>();
  });

  describe("callAgent", () => {
    it("should prevent concurrent agent calls", async () => {
      const caller = new AgentCaller({
        runAgentTurn: mockRunAgentTurn,
        displayText: mockDisplayText,
        displayToolStatus: mockDisplayToolStatus,
        displayError: mockDisplayError,
        startLoading: mockStartLoading,
        stopLoading: mockStopLoading,
        setAgentRunning: mockSetAgentRunning,
        resetStreamState: mockResetStreamState,
      });

      // First call - slow
      mockRunAgentTurn.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ messages: [] }), 100),
          ),
      );

      const messages: MessageParam[] = [];
      const context = {
        curriculum: {} as any,
        state: {} as any,
        segment: {} as any,
        segmentIndex: 0,
      };

      // Start first call
      const call1Promise = caller.callAgent("test1", messages, context);

      // Try to start second call immediately
      const call2Promise = caller.callAgent("test2", messages, context);

      // Both should resolve
      const [result1, result2] = await Promise.all([
        call1Promise,
        call2Promise,
      ]);

      // runAgentTurn should be called twice, but sequentially
      expect(mockRunAgentTurn).toHaveBeenCalledTimes(2);
      expect(result1.messages).toBeDefined();
      expect(result2.messages).toBeDefined();
    });

    it("should handle errors and reset state", async () => {
      const caller = new AgentCaller({
        runAgentTurn: mockRunAgentTurn,
        displayText: mockDisplayText,
        displayToolStatus: mockDisplayToolStatus,
        displayError: mockDisplayError,
        startLoading: mockStartLoading,
        stopLoading: mockStopLoading,
        setAgentRunning: mockSetAgentRunning,
        resetStreamState: mockResetStreamState,
      });

      const error = new Error("Agent failed");
      mockRunAgentTurn.mockRejectedValue(error);

      const messages: MessageParam[] = [];
      const context = {
        curriculum: {} as any,
        state: {} as any,
        segment: {} as any,
        segmentIndex: 0,
      };

      await expect(caller.callAgent("test", messages, context)).rejects.toThrow(
        "Agent failed",
      );

      // Should have called cleanup
      expect(mockStopLoading).toHaveBeenCalled();
      expect(mockSetAgentRunning).toHaveBeenCalledWith(false);
      expect(mockDisplayError).toHaveBeenCalledWith("Agent failed");
    });

    it("should stop loading when first text arrives", async () => {
      const caller = new AgentCaller({
        runAgentTurn: mockRunAgentTurn,
        displayText: mockDisplayText,
        displayToolStatus: mockDisplayToolStatus,
        displayError: mockDisplayError,
        startLoading: mockStartLoading,
        stopLoading: mockStopLoading,
        setAgentRunning: mockSetAgentRunning,
        resetStreamState: mockResetStreamState,
      });

      let capturedOnText: ((text: string) => void) | undefined;
      mockRunAgentTurn.mockImplementation(
        (msg: string, msgs: MessageParam[], opts: any) => {
          capturedOnText = opts.onText;
          return Promise.resolve({ messages: [] });
        },
      );

      const messages: MessageParam[] = [];
      const context = {
        curriculum: {} as any,
        state: {} as any,
        segment: {} as any,
        segmentIndex: 0,
      };

      const promise = caller.callAgent("test", messages, context);

      // Simulate text arrival
      if (capturedOnText) {
        capturedOnText("First text");
        expect(mockStopLoading).toHaveBeenCalledTimes(1);

        // Second text should not stop loading again
        capturedOnText("Second text");
        expect(mockStopLoading).toHaveBeenCalledTimes(1);
      }

      await promise;
    });

    it("should forward text to display callback", async () => {
      const caller = new AgentCaller({
        runAgentTurn: mockRunAgentTurn,
        displayText: mockDisplayText,
        displayToolStatus: mockDisplayToolStatus,
        displayError: mockDisplayError,
        startLoading: mockStartLoading,
        stopLoading: mockStopLoading,
        setAgentRunning: mockSetAgentRunning,
        resetStreamState: mockResetStreamState,
      });

      let capturedOnText: ((text: string) => void) | undefined;
      mockRunAgentTurn.mockImplementation(
        (msg: string, msgs: MessageParam[], opts: any) => {
          capturedOnText = opts.onText;
          return Promise.resolve({ messages: [] });
        },
      );

      const messages: MessageParam[] = [];
      const context = {
        curriculum: {} as any,
        state: {} as any,
        segment: {} as any,
        segmentIndex: 0,
      };

      await caller.callAgent("test", messages, context);

      // Simulate text
      capturedOnText?.("Hello world");
      expect(mockDisplayText).toHaveBeenCalledWith("Hello world");
    });

    it("should forward tool use events", async () => {
      const caller = new AgentCaller({
        runAgentTurn: mockRunAgentTurn,
        displayText: mockDisplayText,
        displayToolStatus: mockDisplayToolStatus,
        displayError: mockDisplayError,
        startLoading: mockStartLoading,
        stopLoading: mockStopLoading,
        setAgentRunning: mockSetAgentRunning,
        resetStreamState: mockResetStreamState,
      });

      let capturedOnToolUse:
        | ((tool: string, status: string) => void)
        | undefined;
      mockRunAgentTurn.mockImplementation(
        (msg: string, msgs: MessageParam[], opts: any) => {
          capturedOnToolUse = opts.onToolUse;
          return Promise.resolve({ messages: [] });
        },
      );

      const messages: MessageParam[] = [];
      const context = {
        curriculum: {} as any,
        state: {} as any,
        segment: {} as any,
        segmentIndex: 0,
      };

      await caller.callAgent("test", messages, context);

      capturedOnToolUse?.("read_file", "running");
      expect(mockDisplayToolStatus).toHaveBeenCalledWith(
        "read_file",
        "running",
      );
    });
  });

  describe("SIGINT handling", () => {
    it("should set up SIGINT handler when enabled", () => {
      const mockSaveState = jest
        .fn<(state: any) => Promise<void>>()
        .mockResolvedValue(undefined);
      const mockSaveProgress = jest
        .fn<(dir: string, progress: any) => Promise<void>>()
        .mockResolvedValue(undefined);
      const mockClose = jest.fn<() => void>();
      const mockExit = jest.fn<(code: number) => never>();

      // Mock process
      const listeners: Record<string, Function> = {};
      const originalOn = process.on;
      process.on = jest.fn<any>((event: string, handler: Function) => {
        listeners[event] = handler;
        return process;
      }) as any;
      const originalExit = process.exit;
      process.exit = mockExit as any;

      const caller = new AgentCaller({
        runAgentTurn: mockRunAgentTurn,
        displayText: mockDisplayText,
        displayToolStatus: mockDisplayToolStatus,
        displayError: mockDisplayError,
        startLoading: mockStartLoading,
        stopLoading: mockStopLoading,
        setAgentRunning: mockSetAgentRunning,
        resetStreamState: mockResetStreamState,
      });

      caller.setupSigintHandler({
        saveState: mockSaveState,
        saveProgress: mockSaveProgress,
        readlineClose: mockClose,
        state: {} as any,
        workingDirectory: "/test",
        progress: {} as any,
      });

      expect(process.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));

      // Restore
      process.on = originalOn;
      process.exit = originalExit;
    });
  });
});
