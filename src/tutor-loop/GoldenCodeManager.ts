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
 * Fixes the off-by-one bug and provides clear step index semantics:
 * - Step 0 is the first step
 * - currentIndex always points to the "current step to complete"
 * - Advancement happens after successful completion
 */
export class GoldenCodeManager {
  private currentIndex: number;
  private currentExpectedCode: ExtractedCode | null = null;
  private lastLoadedIndex: number = -1; // Track last loaded step to prevent duplicates
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
   * - No segment
   * - No golden code
   * - Index out of bounds
   * - Index is negative
   * - Step was already loaded (prevents duplicate displays)
   */
  async loadCurrentStep(): Promise<ExtractedCode | null> {
    if (!this.segment?.goldenCode) {
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

    // Prevent loading the same step twice in a row
    if (this.currentIndex === this.lastLoadedIndex) {
      debugLog(
        `[GoldenCodeManager] Skipping reload of step ${this.currentIndex} (already loaded)`,
      );
      return this.currentExpectedCode;
    }

    debugLog(
      `[GoldenCodeManager] Loading step ${this.currentIndex}/${totalSteps}`,
    );

    // Load the step at currentIndex (fixes off-by-one bug - no +1 here!)
    this.currentExpectedCode = goldenCodeToExtractedCode(
      this.segment.goldenCode,
      this.currentIndex,
    );

    this.lastLoadedIndex = this.currentIndex;

    return this.currentExpectedCode;
  }

  /**
   * Advance to the next step if available.
   * Updates progress file with new index.
   */
  async advance(): Promise<void> {
    if (!this.segment?.goldenCode) {
      return;
    }

    // Only advance if there are more steps
    if (this.hasMoreSteps()) {
      this.currentIndex++;
      this.lastLoadedIndex = -1; // Reset to allow loading the new step
      debugLog(
        `[GoldenCodeManager] Advanced to step ${this.currentIndex}/${this.getTotalSteps()}`,
      );
      await this.updateProgress(this.projectDir, {
        currentGoldenStep: this.currentIndex,
      });
    } else {
      debugLog(
        `[GoldenCodeManager] At final step ${this.currentIndex}/${this.getTotalSteps()}, not advancing`,
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
    // Don't reset lastLoadedIndex - we want to prevent reloading the same step
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
   * Update to a new segment, resetting to step 0.
   * Used when transitioning between curriculum segments.
   */
  async updateSegment(newSegment: Segment | null): Promise<void> {
    this.segment = newSegment;
    this.currentIndex = 0;
    this.currentExpectedCode = null;

    if (newSegment?.goldenCode) {
      await this.updateProgress(this.projectDir, {
        currentGoldenStep: 0,
        totalGoldenSteps: this.getTotalSteps(),
      });
    }
  }
}
