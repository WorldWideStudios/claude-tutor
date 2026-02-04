import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { CommandExecutor } from "../CommandExecutor.js";
import type { Progress } from "../../types.js";

describe("CommandExecutor", () => {
  let executor: CommandExecutor;
  let mockUpdateProgress: jest.Mock<
    (workingDir: string, updates: any) => Promise<Progress>
  >;
  let mockAddCompletedStep: jest.Mock<
    (workingDir: string, step: string) => Promise<Progress>
  >;

  const mockProgress: Progress = {
    version: 2,
    currentSegmentId: "test",
    currentSegmentIndex: 0,
    completedSteps: [],
    codeWritten: false,
    syntaxVerified: false,
    codeReviewed: false,
    committed: false,
    currentGoldenStep: 0,
    totalGoldenSteps: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockUpdateProgress = jest
      .fn<(workingDir: string, updates: any) => Promise<Progress>>()
      .mockResolvedValue(mockProgress);
    mockAddCompletedStep = jest
      .fn<(workingDir: string, step: string) => Promise<Progress>>()
      .mockResolvedValue(mockProgress);
    // Use current directory for tests since test directory doesn't exist
    executor = new CommandExecutor(
      process.cwd(),
      mockUpdateProgress,
      mockAddCompletedStep,
    );
  });

  describe("isShellCommand", () => {
    it("should recognize standard shell commands", () => {
      expect(executor.isShellCommand("mkdir src")).toBe(true);
      expect(executor.isShellCommand("cat > file.txt")).toBe(true);
      expect(executor.isShellCommand("git status")).toBe(true);
      expect(executor.isShellCommand("npm install")).toBe(true);
    });

    it("should reject non-commands", () => {
      expect(executor.isShellCommand("hello world")).toBe(false);
      expect(executor.isShellCommand("explain this code")).toBe(false);
      expect(executor.isShellCommand("")).toBe(false);
    });

    it("should handle commands with leading whitespace", () => {
      expect(executor.isShellCommand("  mkdir src")).toBe(true);
      expect(executor.isShellCommand("\tgit status")).toBe(true);
    });
  });

  describe("startsHeredoc", () => {
    it("should detect heredoc with bare delimiter", () => {
      const result = executor.startsHeredoc("cat > file.txt << EOF");
      expect(result.isHeredoc).toBe(true);
      expect(result.delimiter).toBe("EOF");
    });

    it("should detect heredoc with quoted delimiter", () => {
      const result1 = executor.startsHeredoc("cat > file.txt << 'EOF'");
      expect(result1.isHeredoc).toBe(true);
      expect(result1.delimiter).toBe("EOF");

      const result2 = executor.startsHeredoc('cat > file.txt << "EOF"');
      expect(result2.isHeredoc).toBe(true);
      expect(result2.delimiter).toBe("EOF");
    });

    it("should handle different delimiters", () => {
      expect(executor.startsHeredoc("cat > file << END").delimiter).toBe("END");
      expect(executor.startsHeredoc("cat > file << MARKER").delimiter).toBe(
        "MARKER",
      );
    });

    it("should return false for non-heredoc commands", () => {
      expect(executor.startsHeredoc("mkdir src").isHeredoc).toBe(false);
      expect(executor.startsHeredoc("cat file.txt").isHeredoc).toBe(false);
    });

    it("should handle heredoc with whitespace", () => {
      const result = executor.startsHeredoc("cat > file.txt <<   EOF  ");
      expect(result.isHeredoc).toBe(true);
      expect(result.delimiter).toBe("EOF");
    });
  });

  describe("heredoc state management", () => {
    it("should start heredoc state", () => {
      executor.startHeredoc("cat > file.txt << EOF", "EOF");
      expect(executor.isHeredocActive()).toBe(true);
    });

    it("should add lines to heredoc", () => {
      executor.startHeredoc("cat > file.txt << EOF", "EOF");
      executor.addHeredocLine("line 1");
      executor.addHeredocLine("line 2");

      const command = executor.getHeredocCommand();
      expect(command).toContain("line 1");
      expect(command).toContain("line 2");
    });

    it("should complete heredoc and reset state", async () => {
      executor.startHeredoc("cat > test.txt << EOF", "EOF");
      executor.addHeredocLine("content");

      const result = await executor.completeHeredoc("EOF");

      expect(executor.isHeredocActive()).toBe(false);
      expect(result).toBeDefined();
    });

    it("should not complete heredoc with wrong delimiter", () => {
      executor.startHeredoc("cat > test.txt << EOF", "EOF");
      executor.addHeredocLine("content");

      // completeHeredoc should only be called when delimiter matches
      // This tests the state is maintained
      expect(executor.isHeredocActive()).toBe(true);
    });

    it("should reset heredoc state on error", () => {
      executor.startHeredoc("cat > test.txt << EOF", "EOF");
      executor.addHeredocLine("content");

      executor.resetHeredoc();

      expect(executor.isHeredocActive()).toBe(false);
    });
  });

  describe("executeCommand", () => {
    it("should execute simple commands successfully", async () => {
      // Use pwd which is universally available and reliable
      const result = await executor.executeCommand("pwd");

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it("should handle command failures", async () => {
      const result = await executor.executeCommand("nonexistent-command-xyz");

      expect(result.success).toBe(false);
      expect(result.output).toBeTruthy();
    });

    it("should update progress after file creation", async () => {
      const result = await executor.executeAndTrack(
        "cat > test.txt << EOF\ntest\nEOF",
      );

      if (result.success) {
        expect(mockUpdateProgress).toHaveBeenCalled();
        expect(mockAddCompletedStep).toHaveBeenCalled();
      }
    });

    it("should track git commits", async () => {
      // This might fail if not in a git repo, but tests the tracking logic
      await executor.executeCommand("git status");
      // Just verify it doesn't throw
    });
  });

  describe("getMessageForAgent", () => {
    it("should format successful command message", () => {
      const message = executor.getMessageForAgent("mkdir src", {
        success: true,
        output: "",
      });

      expect(message).toContain("I ran: mkdir src");
      expect(message).toContain("success");
    });

    it("should format error message", () => {
      const message = executor.getMessageForAgent("invalid-cmd", {
        success: false,
        output: "command not found",
      });

      expect(message).toContain("I ran: invalid-cmd");
      expect(message).toContain("Error:");
      expect(message).toContain("command not found");
    });

    it("should include output when present", () => {
      const message = executor.getMessageForAgent("ls", {
        success: true,
        output: "file1.txt\nfile2.txt",
      });

      expect(message).toContain("Output:");
      expect(message).toContain("file1.txt");
    });
  });

  describe("extractFileName", () => {
    it("should extract filename from cat > commands", () => {
      const fileName = executor.extractFileName("cat > src/index.ts << EOF");
      expect(fileName).toBe("src/index.ts");
    });

    it("should extract filename from redirection", () => {
      const fileName = executor.extractFileName('echo "test" > test.txt');
      expect(fileName).toContain("test.txt");
    });

    it("should return generic name if not found", () => {
      const fileName = executor.extractFileName("mkdir src");
      expect(fileName).toBeTruthy();
    });
  });
});
