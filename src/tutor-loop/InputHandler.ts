import type { Interface as ReadlineInterface } from "readline";
import type { Segment } from "../types.js";
import type { ExtractedCode } from "../input.js";
import {
  createTyperSharkInput,
  createMultiLineTyperSharkInput,
  createFreeFormInput,
} from "../input.js";
import { isDiscussMode, isBlockMode, isTutorMode } from "../mode.js";
import { displayContinuationPrompt } from "../display.js";
import type { GoldenCodeManager } from "./GoldenCodeManager.js";
import type { CommandExecutor } from "./CommandExecutor.js";

/**
 * Manages user input based on current mode (tutor/block/discuss).
 * Handles mode transitions, Typer Shark guidance, and heredoc continuation.
 */
export class InputHandler {
  private rl: ReadlineInterface;
  private goldenCodeManager: GoldenCodeManager;
  private commandExecutor: CommandExecutor;
  private segment: Segment | null = null;

  constructor(
    rl: ReadlineInterface,
    goldenCodeManager: GoldenCodeManager,
    commandExecutor: CommandExecutor,
  ) {
    this.rl = rl;
    this.goldenCodeManager = goldenCodeManager;
    this.commandExecutor = commandExecutor;
  }

  /**
   * Set the current segment context
   */
  setSegment(segment: Segment | null): void {
    this.segment = segment;
  }

  /**
   * Get user input based on current mode
   */
  async getInput(): Promise<string> {
    // Check mode first - discuss and code modes use free-form input with shift+tab support
    // DISCUSS MODE: Free-form natural language input, send directly to LLM
    if (isDiscussMode() && !this.commandExecutor.isHeredocActive()) {
      const result = await createFreeFormInput(this.rl, null);
      this.goldenCodeManager.clear(); // Clear any expected code in discuss mode
      return result;
    }

    // CODE MODE: Regular terminal behavior - show expected code as reference, type freely
    if (isBlockMode() && !this.commandExecutor.isHeredocActive()) {
      const currentExpectedCode = this.goldenCodeManager.getCurrentCode();
      const expectedCodeStr =
        currentExpectedCode?.isMultiLine && currentExpectedCode?.lines
          ? currentExpectedCode.lines.map((l) => l.code).join("\n")
          : currentExpectedCode?.code || null;
      const result = await createFreeFormInput(this.rl, expectedCodeStr);
      this.goldenCodeManager.clear(); // Clear expected code after input
      return result;
    }

    // TUTOR MODE: Use Typer Shark for guided typing
    // Don't use Typer Shark for heredoc continuation lines
    // Lazy load golden code if not already loaded
    let currentExpectedCode = this.goldenCodeManager.getCurrentCode();
    if (
      !currentExpectedCode &&
      !this.commandExecutor.isHeredocActive() &&
      this.segment?.goldenCode
    ) {
      currentExpectedCode = await this.goldenCodeManager.loadCurrentStep();
    }

    if (currentExpectedCode && !this.commandExecutor.isHeredocActive()) {
      if (currentExpectedCode.isMultiLine && currentExpectedCode.lines) {
        // Multi-line Typer Shark for heredocs with interleaved comments
        // Calculate lines to clear: each line has comment + code in the raw stream
        // Plus extra lines for the initial explanation text from Claude
        const linesToClear = currentExpectedCode.lines.length * 2 + 4;

        const results = await createMultiLineTyperSharkInput(
          this.rl,
          currentExpectedCode.lines,
          currentExpectedCode.explanation || "Type each line below:",
          linesToClear,
        );
        // Clear expected code after input
        this.goldenCodeManager.clear();

        // Check if user asked a question instead of typing code
        if (results.length === 1 && results[0].startsWith("__QUESTION__:")) {
          // Extract the question and return it as natural language
          return results[0].slice("__QUESTION__:".length);
        }

        // Advance to next golden step after successful multi-line input
        await this.goldenCodeManager.advance();

        // Return all lines joined for command execution
        return results.join("\n");
      } else {
        // Single-line Typer Shark input with real-time character feedback
        const result = await createTyperSharkInput(
          this.rl,
          currentExpectedCode.code,
          currentExpectedCode.explanation,
        );
        // Clear expected code after Typer Shark input (user typed something)
        this.goldenCodeManager.clear();

        // Advance to next golden step after successful single-line input
        await this.goldenCodeManager.advance();

        return result;
      }
    } else if (this.commandExecutor.isHeredocActive()) {
      // Heredoc continuation - use regular readline
      displayContinuationPrompt();
      return new Promise((resolve) => {
        this.rl.once("line", resolve);
      });
    } else {
      // TUTOR MODE without expected code - use free-form input with hint
      // This allows mode cycling and shows the user they can press Enter to continue
      const result = await createFreeFormInput(
        this.rl,
        null,
        "Press Enter to continue, or type a question",
      );
      return result;
    }
  }

  /**
   * Handle mode transition - reload or clear expected code as needed
   */
  async handleModeTransition(fromMode: string, toMode: string): Promise<void> {
    if (toMode === "tutor" && this.segment?.goldenCode) {
      // Reload current step from plan when switching to tutor mode
      await this.goldenCodeManager.loadCurrentStep();
    } else if (fromMode === "tutor" && toMode !== "tutor") {
      // Clear expected code when leaving tutor mode
      this.goldenCodeManager.clear();
    }
  }
}
