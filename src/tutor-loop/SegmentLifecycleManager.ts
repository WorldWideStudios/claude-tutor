import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Curriculum, TutorState, Progress, Segment } from "../types.js";

/**
 * Result of segment completion handling
 */
export interface SegmentCompletionResult {
  completed: boolean;
  curriculumComplete: boolean;
  nextSegment: Segment | null;
  nextProgress: Progress | null;
  prunedMessages: MessageParam[];
}

/**
 * Callbacks required by SegmentLifecycleManager
 */
export interface SegmentLifecycleCallbacks {
  saveState: (state: TutorState) => Promise<void>;
  saveProgress: (workingDir: string, progress: Progress) => Promise<void>;
  createInitialProgress: (segmentId: string, segmentIndex: number) => Progress;
  logInteraction: (
    type: "segment_completed" | "curriculum_completed",
    data: any,
  ) => Promise<void>;
  getCurrentSegment: (curriculum: Curriculum, index: number) => Segment | null;
  isCurriculumComplete: (
    curriculum: Curriculum,
    completedSegments: string[],
  ) => boolean;
  pruneContextForNewSegment: (summary: string) => MessageParam[];
  displaySegmentComplete: (summary: string, nextTitle?: string) => void;
  displayCurriculumComplete: (curriculum: Curriculum) => void;
  displaySegmentHeader: (
    curriculum: Curriculum,
    segment: Segment,
    index: number,
  ) => void;
}

/**
 * Parameters for handling segment completion
 */
export interface HandleSegmentCompletionParams {
  curriculum: Curriculum;
  state: TutorState;
  segment: Segment;
  progress: Progress;
  summary?: string;
}

/**
 * Manages segment lifecycle: completion detection, state transitions,
 * progress management, and curriculum completion.
 */
export class SegmentLifecycleManager {
  private callbacks: SegmentLifecycleCallbacks;

  constructor(callbacks: SegmentLifecycleCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Handle segment completion and transition to next segment
   */
  async handleSegmentCompletion(
    params: HandleSegmentCompletionParams,
  ): Promise<SegmentCompletionResult> {
    const { curriculum, state, segment, progress, summary } = params;

    // Update state - mark segment complete with ID tracking
    const completedSegmentId = segment.id;
    state.completedSegments = [...state.completedSegments, completedSegmentId];
    state.currentSegmentIndex++;
    state.previousSegmentSummary = summary;
    await this.callbacks.saveState(state);

    // Log segment completion
    await this.callbacks.logInteraction("segment_completed", {
      metadata: {
        segmentId: completedSegmentId,
        segmentTitle: segment.title,
        segmentIndex: state.currentSegmentIndex - 1,
        summary,
        completedStepsCount: progress.completedSteps.length,
      },
    });

    // Check if curriculum is complete
    if (
      this.callbacks.isCurriculumComplete(curriculum, state.completedSegments)
    ) {
      // Log curriculum completion
      await this.callbacks.logInteraction("curriculum_completed", {
        metadata: {
          curriculumId: curriculum.id,
          projectName: curriculum.projectName,
          totalSegments: curriculum.segments.length,
          completedSegments: state.completedSegments,
        },
      });
      this.callbacks.displayCurriculumComplete(curriculum);

      return {
        completed: true,
        curriculumComplete: true,
        nextSegment: null,
        nextProgress: null,
        prunedMessages: [],
      };
    }

    // Move to next segment
    const nextSegment = this.callbacks.getCurrentSegment(
      curriculum,
      state.currentSegmentIndex,
    );

    if (!nextSegment) {
      this.callbacks.displayCurriculumComplete(curriculum);
      return {
        completed: true,
        curriculumComplete: true,
        nextSegment: null,
        nextProgress: null,
        prunedMessages: [],
      };
    }

    // Create new progress for the next segment
    const nextProgress = this.callbacks.createInitialProgress(
      nextSegment.id,
      state.currentSegmentIndex,
    );
    await this.callbacks.saveProgress(
      curriculum.workingDirectory,
      nextProgress,
    );

    // Prune context for new segment
    const prunedMessages = this.callbacks.pruneContextForNewSegment(
      summary || "",
    );

    // Get the segment after next for display
    const segmentAfterNext = this.callbacks.getCurrentSegment(
      curriculum,
      state.currentSegmentIndex + 1,
    );

    // Display segment completion
    this.callbacks.displaySegmentComplete(
      summary || "Segment complete",
      segmentAfterNext?.title,
    );

    // Display new segment header
    this.callbacks.displaySegmentHeader(
      curriculum,
      nextSegment,
      state.currentSegmentIndex,
    );

    return {
      completed: true,
      curriculumComplete: false,
      nextSegment,
      nextProgress,
      prunedMessages,
    };
  }

  /**
   * Check if a segment should be considered complete based on progress
   */
  shouldCompleteSegment(progress: Progress): boolean {
    // A segment is complete when code is written, verified, reviewed, and committed
    return (
      progress.codeWritten &&
      progress.syntaxVerified &&
      progress.codeReviewed &&
      progress.committed
    );
  }

  /**
   * Get completion percentage for current segment
   */
  getSegmentProgress(progress: Progress): number {
    let completed = 0;
    let total = 4;

    if (progress.codeWritten) completed++;
    if (progress.syntaxVerified) completed++;
    if (progress.codeReviewed) completed++;
    if (progress.committed) completed++;

    return Math.round((completed / total) * 100);
  }
}
