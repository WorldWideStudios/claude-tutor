import type { Segment, Progress } from "../types.js";
import type { ExtractedCode } from "../input.js";
import {
  goldenCodeToExtractedCode,
  getGoldenCodeStepCount,
  hasMoreGoldenSteps,
} from "../golden-code.js";
import { debugLog } from "../logging.js";

/**
 * Manages golden code step progression and state.
 * - Step 0 is the first step
 * - currentIndex always points to the "current step to complete"
 * - Advancement happens after successful completion
 * - allStepsCompleted prevents reloading after the final step is done
 */
export class GoldenCodeManager {
  private currentIndex: number;
  private currentExpectedCode: ExtractedCode | null = null;
  private allStepsCompleted: boolean = false;
  private segment: Segment | null;
  private projectDir: string;
  private updateProgress: (
    workingDir: string,
    updates: any,
  ) => Promise<Progress>;

  constructor(
    segment: Segment | null,
    projectDir: string,
    updateProgress: (workingDir: string, updates: any) => Promise<Progress>,
    initialIndex: number = 0,
  ) {
    this.segment = segment;
    this.projectDir = projectDir;
    this.updateProgress = updateProgress;
    this.currentIndex = initialIndex;
  }

  /**
   * Load the current step's code. Returns null if:
   * - No segment or no golden code
   * - All steps already completed
   * - Index out of bounds or negative
   */
  async loadCurrentStep(): Promise<ExtractedCode | null> {
    if (!this.segment?.goldenCode) {
      this.currentExpectedCode = null;
      return null;
    }

    if (this.allStepsCompleted) {
      debugLog(
        `[GoldenCodeManager] All steps completed, not loading`,
      );
      this.currentExpectedCode = null;
      return null;
    }

    // Validate index bounds
    if (this.currentIndex < 0) {
      debugLog(
        `[GoldenCodeManager] Cannot load step: index ${this.currentIndex} is negative`,
      );
      this.currentExpectedCode = null;
      return null;
    }

    const totalSteps = this.getTotalSteps();
    if (this.currentIndex >= totalSteps) {
      debugLog(
        `[GoldenCodeManager] Cannot load step: index ${this.currentIndex} >= totalSteps ${totalSteps}`,
      );
      this.currentExpectedCode = null;
      return null;
    }

    debugLog(
      `[GoldenCodeManager] Loading step ${this.currentIndex}/${totalSteps}`,
    );

    this.currentExpectedCode = goldenCodeToExtractedCode(
      this.segment.goldenCode,
      this.currentIndex,
    );

    return this.currentExpectedCode;
  }

  /**
   * Advance to the next step if available.
   * If at the final step, marks all steps as completed.
   * Updates progress file with new index.
   */
  async advance(): Promise<void> {
    if (!this.segment?.goldenCode) {
      return;
    }

    if (this.hasMoreSteps()) {
      this.currentIndex++;
      debugLog(
        `[GoldenCodeManager] Advanced to step ${this.currentIndex}/${this.getTotalSteps()}`,
      );
      await this.updateProgress(this.projectDir, {
        currentGoldenStep: this.currentIndex,
      });
    } else {
      this.allStepsCompleted = true;
      debugLog(
        `[GoldenCodeManager] Final step ${this.currentIndex}/${this.getTotalSteps()} done, marking all complete`,
      );
    }
  }

  /**
   * Clear the currently loaded code without changing index.
   * Useful when switching modes or contexts.
   */
  clear(): void {
    debugLog(
      `[GoldenCodeManager] Clearing current code (index remains ${this.currentIndex})`,
    );
    this.currentExpectedCode = null;
  }

  /**
   * Get the currently loaded code (or null if not loaded).
   */
  getCurrentCode(): ExtractedCode | null {
    return this.currentExpectedCode;
  }

  /**
   * Get the current step index.
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Check if there are more steps after the current one.
   */
  hasMoreSteps(): boolean {
    if (!this.segment?.goldenCode) {
      return false;
    }

    return hasMoreGoldenSteps(this.segment.goldenCode, this.currentIndex);
  }

  /**
   * Get the total number of steps in the golden code.
   */
  getTotalSteps(): number {
    if (!this.segment?.goldenCode) {
      return 0;
    }

    return getGoldenCodeStepCount(this.segment.goldenCode);
  }

  /**
   * Mark all steps as complete. Used when resuming at a completed final step.
   */
  markAllStepsComplete(): void {
    this.allStepsCompleted = true;
    this.currentExpectedCode = null;
  }

  /**
   * Update to a new segment, resetting to step 0.
   * Used when transitioning between curriculum segments.
   */
  async updateSegment(newSegment: Segment | null): Promise<void> {
    this.segment = newSegment;
    this.currentIndex = 0;
    this.currentExpectedCode = null;
    this.allStepsCompleted = false;

    if (newSegment?.goldenCode) {
      await this.updateProgress(this.projectDir, {
        currentGoldenStep: 0,
        totalGoldenSteps: this.getTotalSteps(),
      });
    }
  }
}
