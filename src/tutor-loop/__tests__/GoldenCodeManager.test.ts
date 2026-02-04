import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { GoldenCodeManager } from "../GoldenCodeManager.js";
import type { Segment, Progress } from "../../types.js";

describe("GoldenCodeManager", () => {
  const mockSegment: Segment = {
    id: "test-segment",
    type: "build",
    title: "Test Segment",
    goldenCode: `mkdir src
touch src/index.ts
cat > src/index.ts << 'EOF'
console.log("hello");
EOF
npm install`,
    targetFile: "src/index.ts",
    explanation: "Test",
    engineeringFocus: "Test",
    checkpoints: [],
  };

  const mockProgress: Progress = {
    version: 2,
    currentSegmentId: "test-segment",
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

  let mockUpdateProgress: jest.Mock<
    (workingDir: string, updates: any) => Promise<Progress>
  >;

  beforeEach(() => {
    mockUpdateProgress = jest
      .fn<(workingDir: string, updates: any) => Promise<Progress>>()
      .mockResolvedValue(mockProgress);
  });

  describe("initialization", () => {
    it("should start at step 0", () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
      );
      expect(manager.getCurrentIndex()).toBe(0);
    });

    it("should initialize with provided step index", () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        2,
      );
      expect(manager.getCurrentIndex()).toBe(2);
    });

    it("should handle null segment", () => {
      const manager = new GoldenCodeManager(
        null,
        "/test/project",
        mockUpdateProgress,
      );
      expect(manager.getCurrentIndex()).toBe(0);
      expect(manager.getCurrentCode()).toBeNull();
    });
  });

  describe("loadCurrentStep", () => {
    it("should load step 0 as first step", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        0,
      );

      const code = await manager.loadCurrentStep();

      expect(code).not.toBeNull();
      expect(code?.code).toBe("mkdir src");
      expect(code?.explanation).toBe("creates directory src");
    });

    it("should load step 1 as second step", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        1,
      );

      const code = await manager.loadCurrentStep();

      expect(code).not.toBeNull();
      expect(code?.code).toBe("touch src/index.ts");
    });

    it("should return null when no segment", async () => {
      const manager = new GoldenCodeManager(
        null,
        "/test/project",
        mockUpdateProgress,
      );

      const code = await manager.loadCurrentStep();
      expect(code).toBeNull();
    });

    it("should return null when no golden code", async () => {
      const segmentWithoutCode: Segment = {
        ...mockSegment,
        goldenCode: "",
      };
      const manager = new GoldenCodeManager(
        segmentWithoutCode,
        "/test/project",
        mockUpdateProgress,
      );

      const code = await manager.loadCurrentStep();
      expect(code).toBeNull();
    });

    it("should return null when index is out of bounds", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        999, // Way beyond available steps
      );

      const code = await manager.loadCurrentStep();
      expect(code).toBeNull();
    });

    it("should return null for negative index", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        -1,
      );

      const code = await manager.loadCurrentStep();
      expect(code).toBeNull();
    });
  });

  describe("advance", () => {
    it("should advance to next step and update progress", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        0,
      );

      await manager.advance();

      expect(manager.getCurrentIndex()).toBe(1);
      expect(mockUpdateProgress).toHaveBeenCalledWith("/test/project", {
        currentGoldenStep: 1,
      });
    });

    it("should not advance beyond last step", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        3, // Last step (0-indexed, total 4 steps)
      );

      await manager.advance();

      // Should stay at step 3
      expect(manager.getCurrentIndex()).toBe(3);
      expect(mockUpdateProgress).not.toHaveBeenCalled();
    });

    it("should handle null segment gracefully", async () => {
      const manager = new GoldenCodeManager(
        null,
        "/test/project",
        mockUpdateProgress,
      );

      await manager.advance();

      expect(manager.getCurrentIndex()).toBe(0);
      expect(mockUpdateProgress).not.toHaveBeenCalled();
    });

    it("should handle corrupted progress with large index", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        1000, // Corrupted value way beyond steps
      );

      // Should cap at max valid index
      expect(manager.getCurrentIndex()).toBe(1000);

      await manager.advance();

      // Should not advance beyond bounds
      expect(manager.getCurrentIndex()).toBe(1000);
      expect(mockUpdateProgress).not.toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("should clear current expected code", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        0,
      );

      await manager.loadCurrentStep();
      expect(manager.getCurrentCode()).not.toBeNull();

      manager.clear();
      expect(manager.getCurrentCode()).toBeNull();
    });
  });

  describe("hasMoreSteps", () => {
    it("should return true when there are more steps", () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        0,
      );

      expect(manager.hasMoreSteps()).toBe(true);
    });

    it("should return false at last step", () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        3, // Last step
      );

      expect(manager.hasMoreSteps()).toBe(false);
    });

    it("should return false with no segment", () => {
      const manager = new GoldenCodeManager(
        null,
        "/test/project",
        mockUpdateProgress,
      );

      expect(manager.hasMoreSteps()).toBe(false);
    });
  });

  describe("getTotalSteps", () => {
    it("should return correct total number of steps", () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
      );

      expect(manager.getTotalSteps()).toBe(4);
    });

    it("should return 0 for null segment", () => {
      const manager = new GoldenCodeManager(
        null,
        "/test/project",
        mockUpdateProgress,
      );

      expect(manager.getTotalSteps()).toBe(0);
    });
  });

  describe("updateSegment", () => {
    it("should reset to step 0 when segment changes", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        2,
      );

      const newSegment: Segment = {
        ...mockSegment,
        id: "new-segment",
        goldenCode: "mkdir test\ntouch test.txt",
      };

      await manager.updateSegment(newSegment);

      expect(manager.getCurrentIndex()).toBe(0);
      expect(mockUpdateProgress).toHaveBeenCalledWith("/test/project", {
        currentGoldenStep: 0,
        totalGoldenSteps: 2,
      });
    });

    it("should clear current code on segment change", async () => {
      const manager = new GoldenCodeManager(
        mockSegment,
        "/test/project",
        mockUpdateProgress,
        0,
      );

      await manager.loadCurrentStep();
      expect(manager.getCurrentCode()).not.toBeNull();

      const newSegment: Segment = {
        ...mockSegment,
        id: "new-segment",
      };

      await manager.updateSegment(newSegment);
      expect(manager.getCurrentCode()).toBeNull();
    });
  });
});
