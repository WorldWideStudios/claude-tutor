import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { SegmentLifecycleManager } from "../SegmentLifecycleManager.js";
import type { Curriculum, TutorState, Progress, Segment } from "../../types.js";

describe("SegmentLifecycleManager", () => {
  let manager: SegmentLifecycleManager;
  let mockCurriculum: Curriculum;
  let mockState: TutorState;
  let mockProgress: Progress;
  let mockSegment: Segment;
  let mockCallbacks: any;

  beforeEach(() => {
    mockSegment = {
      id: "segment-1",
      type: "build",
      title: "First Segment",
      goldenCode: "mkdir src",
      targetFile: "src/index.ts",
      explanation: "Test",
      engineeringFocus: "Test",
      checkpoints: [],
    };

    mockCurriculum = {
      id: "test-curriculum",
      projectName: "Test Project",
      projectGoal: "Test goal",
      segments: [
        mockSegment,
        {
          id: "segment-2",
          type: "build",
          title: "Second Segment",
          goldenCode: "touch file.ts",
          targetFile: "file.ts",
          explanation: "Test 2",
          engineeringFocus: "Test 2",
          checkpoints: [],
        },
      ],
      workingDirectory: "/test/project",
      createdAt: new Date().toISOString(),
    };

    mockState = {
      curriculumPath: "/path/to/curriculum.json",
      currentSegmentIndex: 0,
      completedSegments: [],
      totalMinutesSpent: 0,
      lastAccessedAt: new Date().toISOString(),
      previousSegmentSummary: undefined,
    };

    mockProgress = {
      version: 2,
      currentSegmentId: "segment-1",
      currentSegmentIndex: 0,
      completedSteps: ["step 1", "step 2"],
      codeWritten: true,
      syntaxVerified: false,
      codeReviewed: false,
      committed: false,
      currentGoldenStep: 0,
      totalGoldenSteps: 5,
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };

    mockCallbacks = {
      saveState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      saveProgress: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      createInitialProgress: jest.fn().mockReturnValue(mockProgress),
      logInteraction: jest
        .fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
      getCurrentSegment: jest.fn((curr: Curriculum, index: number) => {
        return curr.segments[index] || null;
      }),
      isCurriculumComplete: jest.fn().mockReturnValue(false),
      pruneContextForNewSegment: jest.fn((summary: string) => []),
      displaySegmentComplete: jest.fn(),
      displayCurriculumComplete: jest.fn(),
      displaySegmentHeader: jest.fn(),
    };

    manager = new SegmentLifecycleManager(mockCallbacks);
  });

  describe("segment completion", () => {
    it("should handle segment completion", async () => {
      const result = await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Completed first segment",
      });

      expect(result.completed).toBe(true);
      expect(result.curriculumComplete).toBe(false);
      expect(mockCallbacks.saveState).toHaveBeenCalled();
      expect(mockCallbacks.logInteraction).toHaveBeenCalledWith(
        "segment_completed",
        expect.any(Object),
      );
    });

    it("should update state with completed segment ID", async () => {
      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(mockState.completedSegments).toContain("segment-1");
      expect(mockState.currentSegmentIndex).toBe(1);
      expect(mockState.previousSegmentSummary).toBe("Done");
    });

    it("should log completed steps count", async () => {
      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(mockCallbacks.logInteraction).toHaveBeenCalledWith(
        "segment_completed",
        expect.objectContaining({
          metadata: expect.objectContaining({
            completedStepsCount: 2,
          }),
        }),
      );
    });
  });

  describe("curriculum completion", () => {
    it("should detect when curriculum is complete", async () => {
      mockCallbacks.isCurriculumComplete.mockReturnValue(true);

      const result = await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Final segment done",
      });

      expect(result.curriculumComplete).toBe(true);
      expect(mockCallbacks.logInteraction).toHaveBeenCalledWith(
        "curriculum_completed",
        expect.any(Object),
      );
      expect(mockCallbacks.displayCurriculumComplete).toHaveBeenCalled();
    });

    it("should log curriculum completion with metadata", async () => {
      mockCallbacks.isCurriculumComplete.mockReturnValue(true);

      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(mockCallbacks.logInteraction).toHaveBeenCalledWith(
        "curriculum_completed",
        expect.objectContaining({
          metadata: expect.objectContaining({
            curriculumId: "test-curriculum",
            projectName: "Test Project",
            totalSegments: 2,
          }),
        }),
      );
    });
  });

  describe("next segment transition", () => {
    it("should prepare next segment", async () => {
      const result = await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(result.nextSegment).toBeDefined();
      expect(result.nextSegment?.id).toBe("segment-2");
    });

    it("should create progress for next segment", async () => {
      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(mockCallbacks.createInitialProgress).toHaveBeenCalledWith(
        "segment-2",
        1,
      );
      expect(mockCallbacks.saveProgress).toHaveBeenCalled();
    });

    it("should prune context for next segment", async () => {
      const result = await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Summary text",
      });

      expect(mockCallbacks.pruneContextForNewSegment).toHaveBeenCalledWith(
        "Summary text",
      );
      expect(result.prunedMessages).toBeDefined();
    });

    it("should display segment completion", async () => {
      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Summary",
      });

      // Shows the segment AFTER next (index + 1), which doesn't exist in this test
      expect(mockCallbacks.displaySegmentComplete).toHaveBeenCalledWith(
        "Summary",
        undefined, // No third segment exists
      );
    });

    it("should display new segment header", async () => {
      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(mockCallbacks.displaySegmentHeader).toHaveBeenCalledWith(
        mockCurriculum,
        expect.objectContaining({ id: "segment-2" }),
        1,
      );
    });
  });

  describe("error handling", () => {
    it("should handle missing next segment", async () => {
      mockCallbacks.getCurrentSegment.mockReturnValue(null);

      const result = await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(result.nextSegment).toBeNull();
      expect(mockCallbacks.displayCurriculumComplete).toHaveBeenCalled();
    });

    it("should handle saveState failures gracefully", async () => {
      mockCallbacks.saveState.mockRejectedValue(new Error("Save failed"));

      await expect(
        manager.handleSegmentCompletion({
          curriculum: mockCurriculum,
          state: mockState,
          segment: mockSegment,
          progress: mockProgress,
          summary: "Done",
        }),
      ).rejects.toThrow("Save failed");
    });
  });

  describe("state updates", () => {
    it("should increment segment index", async () => {
      const initialIndex = mockState.currentSegmentIndex;

      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(mockState.currentSegmentIndex).toBe(initialIndex + 1);
    });

    it("should preserve previous completed segments", async () => {
      mockState.completedSegments = ["segment-0"];

      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Done",
      });

      expect(mockState.completedSegments).toEqual(["segment-0", "segment-1"]);
    });

    it("should store summary for next segment", async () => {
      await manager.handleSegmentCompletion({
        curriculum: mockCurriculum,
        state: mockState,
        segment: mockSegment,
        progress: mockProgress,
        summary: "Important summary",
      });

      expect(mockState.previousSegmentSummary).toBe("Important summary");
    });
  });
});
