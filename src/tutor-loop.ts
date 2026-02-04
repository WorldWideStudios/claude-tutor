#!/usr/bin/env node

import * as readline from "readline";
import { logInteraction } from "./logging.js";
import { getCurrentSegment, isCurriculumComplete } from "./curriculum.js";
import {
  loadProgress,
  saveProgress,
  createInitialProgress,
  updateProgress,
  addCompletedStep,
  saveState,
} from "./storage.js";
import {
  runAgentTurn,
  createInitialMessages,
  pruneContextForNewSegment,
} from "./agent.js";
import {
  createTyperSharkInput,
  createMultiLineTyperSharkInput,
  createFreeFormInput,
  type ExtractedCode,
} from "./input.js";
import { isDiscussMode, isBlockMode, isTutorMode, getMode } from "./mode.js";
import {
  goldenCodeToExtractedCode,
  getGoldenCodeStepCount,
  hasMoreGoldenSteps,
} from "./golden-code.js";
import {
  displaySegmentHeader,
  displayTutorText,
  displaySegmentComplete,
  displayCurriculumComplete,
  displayError,
  displayCommand,
  displayCommandOutput,
  displayContinuationPrompt,
  displayToolStatus,
  setAgentRunning,
  resetStreamState,
  startLoading,
  stopLoading,
  newLine,
  colors,
  displayInfo,
  displayPreflightError,
} from "./display.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Curriculum, TutorState, Progress } from "./types.js";
import { execSync } from "child_process";
import { runPreflightChecks } from "./preflight.js";
import { AgentCaller } from "./tutor-loop/agent-caller.js";
import { GoldenCodeManager } from "./tutor-loop/GoldenCodeManager.js";

// Shell commands that should be executed directly
const SHELL_COMMANDS = [
  "mkdir",
  "cat",
  "echo",
  "touch",
  "rm",
  "mv",
  "cp",
  "ls",
  "cd",
  "git",
  "npm",
  "npx",
  "node",
  "tsc",
  "pwd",
  "chmod",
  "grep",
  "find",
];

// Heredoc state tracking
let heredocState: {
  active: boolean;
  delimiter: string;
  command: string;
  lines: string[];
} = { active: false, delimiter: "", command: "", lines: [] };

/**
 * Check if input looks like a shell command
 */
function isShellCommand(input: string): boolean {
  const firstWord = input.trim().split(/\s+/)[0];
  return SHELL_COMMANDS.includes(firstWord);
}

/**
 * Check if command starts a heredoc
 */
function startsHeredoc(input: string): {
  isHeredoc: boolean;
  delimiter: string;
} {
  const heredocMatch = input.match(/<<\s*['"]?(\w+)['"]?\s*$/);
  if (heredocMatch) {
    return { isHeredoc: true, delimiter: heredocMatch[1] };
  }
  return { isHeredoc: false, delimiter: "" };
}

/**
 * Execute a shell command and return the result
 */
function executeCommand(
  command: string,
  cwd: string,
): { success: boolean; output: string } {
  try {
    const output = execSync(command, { cwd, encoding: "utf-8" });
    return { success: true, output: output.trim() };
  } catch (error: any) {
    return {
      success: false,
      output: error.stderr || error.stdout || error.message,
    };
  }
}

/**
 * Main tutor conversation loop
 */
export async function runTutorLoop(
  curriculum: Curriculum,
  state: TutorState,
): Promise<void> {
  // Run preflight checks before starting
  const preflight = runPreflightChecks(curriculum.workingDirectory);
  if (!preflight.ok) {
    displayPreflightError(preflight.error!);
    throw new Error(`Preflight check failed: ${preflight.error}`);
  }

  let messages: MessageParam[] = createInitialMessages();
  let previousSummary: string | undefined;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Note: We intentionally do NOT call readline.emitKeypressEvents() here
  // because it adds an internal data listener that interferes with our
  // raw mode input handlers, causing doubled character input.

  // Setup agent caller with SIGINT handler
  const agentCaller = new AgentCaller({
    runAgentTurn,
    displayText: displayTutorText,
    displayToolStatus,
    displayError,
    startLoading,
    stopLoading,
    setAgentRunning,
    resetStreamState,
  });

  // Get current segment
  let segment = getCurrentSegment(curriculum, state.currentSegmentIndex);
  if (!segment) {
    displayCurriculumComplete(curriculum);
    rl.close();
    return;
  }

  // Load or create progress for this segment
  let progress: Progress | null = await loadProgress(
    curriculum.workingDirectory,
  );
  const isResuming =
    progress !== null && progress.currentSegmentId === segment.id;

  if (!progress || progress.currentSegmentId !== segment.id) {
    // Create new progress for this segment
    progress = createInitialProgress(segment.id, state.currentSegmentIndex);
    await saveProgress(curriculum.workingDirectory, progress);
  }

  // Setup golden code manager
  const goldenCodeManager = new GoldenCodeManager(
    segment,
    curriculum.workingDirectory,
    updateProgress,
    progress.currentGoldenStep || 0
  );

  // Setup SIGINT handler to save progress on Ctrl+C
  agentCaller.setupSigintHandler({
    saveState,
    saveProgress,
    readlineClose: () => rl.close(),
    state,
    workingDirectory: curriculum.workingDirectory,
    progress,
  });

  displaySegmentHeader(curriculum, segment, state.currentSegmentIndex);

  // Send initial "start" or "resume" message to kick off the segment
  try {
    const startMessage = isResuming ? "resume" : "start";
    const result = await agentCaller.callAgent(startMessage, messages, {
      curriculum,
      state,
      segment,
      segmentIndex: state.currentSegmentIndex,
      previousSummary,
      progress: isResuming ? progress : undefined, // Only pass progress if resuming
      onSegmentComplete: (summary) => {
        const nextSegment = getCurrentSegment(
          curriculum,
          state.currentSegmentIndex + 1,
        );
        displaySegmentComplete(summary || "", nextSegment?.title);
      },
    });
    messages = result.messages;
    // Save the tutor's initial message to progress
    if (result.lastResponse) {
      await updateProgress(curriculum.workingDirectory, {
        lastTutorMessage: result.lastResponse.slice(0, 500),
        totalGoldenSteps: goldenCodeManager.getTotalSteps(),
      });
    }
    newLine();
  } catch (error: any) {
    displayError(`Failed to start segment: ${error.message}`);
    rl.close();
    process.exit(1);
  }

  // Helper to get input - mode determines behavior
  const getInput = async (): Promise<string> => {
    // Check mode first - discuss and code modes use free-form input with shift+tab support
    // DISCUSS MODE: Free-form natural language input, send directly to LLM
    if (isDiscussMode() && !heredocState.active) {
      const result = await createFreeFormInput(rl, null);
      goldenCodeManager.clear(); // Clear any expected code in discuss mode
      return result;
    }

    // CODE MODE: Regular terminal behavior - show expected code as reference, type freely
    if (isBlockMode() && !heredocState.active) {
      const currentExpectedCode = goldenCodeManager.getCurrentCode();
      const expectedCodeStr =
        currentExpectedCode?.isMultiLine && currentExpectedCode?.lines
          ? currentExpectedCode.lines.map((l) => l.code).join("\n")
          : currentExpectedCode?.code || null;
      const result = await createFreeFormInput(rl, expectedCodeStr);
      goldenCodeManager.clear(); // Clear expected code after input
      return result;
    }

    // TUTOR MODE: Use Typer Shark for guided typing
    // Don't use Typer Shark for heredoc continuation lines
    // Lazy load golden code if not already loaded
    let currentExpectedCode = goldenCodeManager.getCurrentCode();
    if (!currentExpectedCode && !heredocState.active && segment?.goldenCode) {
      currentExpectedCode = await goldenCodeManager.loadCurrentStep();
    }

    if (currentExpectedCode && !heredocState.active) {
      if (currentExpectedCode.isMultiLine && currentExpectedCode.lines) {
        // Multi-line Typer Shark for heredocs with interleaved comments
        // Calculate lines to clear: each line has comment + code in the raw stream
        // Plus extra lines for the initial explanation text from Claude
        const linesToClear = currentExpectedCode.lines.length * 2 + 4;

        const results = await createMultiLineTyperSharkInput(
          rl,
          currentExpectedCode.lines,
          currentExpectedCode.explanation || "Type each line below:",
          linesToClear,
        );
        // Clear expected code after input
        goldenCodeManager.clear();

        // Check if user asked a question instead of typing code
        if (results.length === 1 && results[0].startsWith("__QUESTION__:")) {
          // Extract the question and return it as natural language
          return results[0].slice("__QUESTION__:".length);
        }

        // Advance to next golden step after successful multi-line input
        await goldenCodeManager.advance();

        // Return all lines joined for command execution
        return results.join("\n");
      } else {
        // Single-line Typer Shark input with real-time character feedback
        const result = await createTyperSharkInput(
          rl,
          currentExpectedCode.code,
          currentExpectedCode.explanation,
        );
        // Clear expected code after Typer Shark input (user typed something)
        goldenCodeManager.clear();

        // Advance to next golden step after successful single-line input
        await goldenCodeManager.advance();

        return result;
      }
    } else if (heredocState.active) {
      // Heredoc continuation - use regular readline
      displayContinuationPrompt();
      return new Promise((resolve) => {
        rl.once("line", resolve);
      });
    } else {
      // TUTOR MODE without expected code - use free-form input with hint
      // This allows mode cycling and shows the user they can press Enter to continue
      const result = await createFreeFormInput(
        rl,
        null,
        "Press Enter to continue, or type a question",
      );
      return result;
    }
  };

  // Main conversation loop
  while (true) {
    // Track mode before getting input to detect transitions
    const modeBeforeInput = getMode();
    const input = await getInput();

    // Detect mode change during input (user pressed Shift+Tab)
    const modeAfterInput = getMode();
    if (
      modeBeforeInput !== modeAfterInput
    ) {
      if (isTutorMode() && segment?.goldenCode) {
        // Reload current step from plan when switching to tutor mode
        await goldenCodeManager.loadCurrentStep();
      } else {
        // Clear expected code when leaving tutor mode
        goldenCodeManager.clear();
      }
    }
    // Handle heredoc continuation
    if (heredocState.active) {
      if (input.trim() === heredocState.delimiter) {
        // End of heredoc - execute full command
        const fullCommand =
          heredocState.command +
          "\n" +
          heredocState.lines.join("\n") +
          "\n" +
          heredocState.delimiter;
        heredocState = { active: false, delimiter: "", command: "", lines: [] };

        const cmdResult = executeCommand(
          fullCommand,
          curriculum.workingDirectory,
        );
        displayCommand(fullCommand.split("\n")[0] + " ...", cmdResult.success);
        displayCommandOutput(cmdResult.output);

        // Update progress - heredoc usually means file creation
        if (cmdResult.success) {
          const fileMatch = fullCommand.match(/cat\s*>\s*(\S+)/);
          const fileName = fileMatch ? fileMatch[1] : "file";
          await updateProgress(curriculum.workingDirectory, {
            codeWritten: true,
            lastUserAction: `Created file: ${fileName}`,
          });
          await addCompletedStep(
            curriculum.workingDirectory,
            `Created file: ${fileName}`,
          );
        }

        // Send to Claude
        const messageToSend = cmdResult.success
          ? `I ran a heredoc command to create/modify a file:\n${fullCommand}\nResult: Success`
          : `I ran a heredoc command:\n${fullCommand}\nError: ${cmdResult.output}`;

        try {
          const result = await agentCaller.callAgent(messageToSend, messages, {
            curriculum,
            state,
            segment: segment!,
            segmentIndex: state.currentSegmentIndex,
            previousSummary,
            onSegmentComplete: (summary) => {
              previousSummary = summary;
            },
          });
          messages = result.messages;
          // Note: Step advancement now happens in Typer Shark completion
          // Load next step from plan (if not already loaded)
          if (!goldenCodeManager.getCurrentCode()) {
            await goldenCodeManager.loadCurrentStep();
          }
          newLine();
        } catch (error: any) {
          // Reset heredoc state on error
          heredocState = {
            active: false,
            delimiter: "",
            command: "",
            lines: [],
          };
          displayError(error.message);
        }
        continue;
      } else {
        // Continue collecting heredoc lines
        heredocState.lines.push(input);
        continue;
      }
    }

    const userInput = input.trim();

    // In discuss mode, print the user's question as a log entry
    if (isDiscussMode() && userInput) {
      console.log(colors.dim("› " + userInput));
      console.log();
    }

    // Empty Enter = continue signal
    if (!userInput) {
      try {
        const result = await agentCaller.callAgent(
          "(user pressed Enter to continue)",
          messages,
          {
            curriculum,
            state,
            segment: segment!,
            segmentIndex: state.currentSegmentIndex,
            previousSummary,
            onSegmentComplete: (summary) => {
              previousSummary = summary;
            },
          },
        );
        messages = result.messages;
        // Reload current step from plan (don't advance on Enter)
        if (isTutorMode() && segment?.goldenCode) {
          await goldenCodeManager.loadCurrentStep();
        } else if (isDiscussMode()) {
          goldenCodeManager.clear();
        }
        newLine();
        continue;
      } catch (error: any) {
        displayError(error.message);
        continue;
      }
    }

    // Handle quit command
    if (
      userInput.toLowerCase() === "quit" ||
      userInput.toLowerCase() === "exit"
    ) {
      displayInfo('\nProgress saved. Run "claude-tutor resume" to continue.');
      rl.close();
      process.exit(0);
    }

    // Log user input
    logInteraction("user_selection", {
      answer_text: userInput,
      metadata: {
        isShellCommand: isShellCommand(userInput),
        segmentIndex: state.currentSegmentIndex,
      },
    });

    // Check if it's a shell command
    let messageToSend = userInput;
    if (isShellCommand(userInput)) {
      // Check if it starts a heredoc
      const { isHeredoc, delimiter } = startsHeredoc(userInput);
      if (isHeredoc) {
        // Start heredoc mode
        heredocState = {
          active: true,
          delimiter,
          command: userInput,
          lines: [],
        };
        continue;
      }

      // Regular command - execute it
      const cmdResult = executeCommand(userInput, curriculum.workingDirectory);
      displayCommand(userInput, cmdResult.success);
      displayCommandOutput(cmdResult.output);

      // Update progress based on command type
      if (cmdResult.success) {
        const updates: Partial<Progress> = {
          lastUserAction: userInput,
        };

        // Track specific actions
        if (userInput.startsWith("cat >") || userInput.includes(">> ")) {
          updates.codeWritten = true;
          await addCompletedStep(
            curriculum.workingDirectory,
            `Created/modified file: ${userInput.split(/[>\s]+/)[1] || "file"}`,
          );
        } else if (userInput.startsWith("git commit")) {
          updates.committed = true;
          await addCompletedStep(
            curriculum.workingDirectory,
            "Committed code to git",
          );
        } else if (userInput.startsWith("mkdir")) {
          await addCompletedStep(
            curriculum.workingDirectory,
            `Created directory: ${userInput}`,
          );
        }

        await updateProgress(curriculum.workingDirectory, updates);
      }

      messageToSend = cmdResult.success
        ? `I ran: ${userInput}\nOutput: ${cmdResult.output || "(success)"}`
        : `I ran: ${userInput}\nError: ${cmdResult.output}`;
    }

    try {
      const result = await agentCaller.callAgent(messageToSend, messages, {
        curriculum,
        state,
        segment: segment!,
        segmentIndex: state.currentSegmentIndex,
        previousSummary,
        onSegmentComplete: (summary) => {
          previousSummary = summary;
        },
      });

      messages = result.messages;
      // Note: Step advancement now happens in Typer Shark completion
      // Load next step from plan (if not already loaded)
      if (isTutorMode() && segment?.goldenCode && !goldenCodeManager.getCurrentCode()) {
        await goldenCodeManager.loadCurrentStep();
      } else if (isDiscussMode()) {
        goldenCodeManager.clear();
      }
      newLine();

      // Check if segment was completed
      if (result.segmentCompleted) {
        // Update state - properly mark segment complete with ID tracking
        const completedSegmentId = segment!.id;
        state.completedSegments = [
          ...state.completedSegments,
          completedSegmentId,
        ];
        state.currentSegmentIndex++;
        state.previousSegmentSummary = result.summary;
        await saveState(state);

        // Log segment completion
        await logInteraction("segment_completed", {
          metadata: {
            segmentId: completedSegmentId,
            segmentTitle: segment!.title,
            segmentIndex: state.currentSegmentIndex - 1,
            summary: result.summary,
            completedStepsCount: progress.completedSteps.length,
          },
        });

        // Check if curriculum is complete
        if (isCurriculumComplete(curriculum, state.completedSegments)) {
          // Log curriculum completion
          await logInteraction("curriculum_completed", {
            metadata: {
              curriculumId: curriculum.id,
              projectName: curriculum.projectName,
              totalSegments: curriculum.segments.length,
              completedSegments: state.completedSegments,
            },
          });
          displayCurriculumComplete(curriculum);
          rl.close();
          return;
        }

        // Move to next segment
        segment = getCurrentSegment(curriculum, state.currentSegmentIndex);
        if (!segment) {
          displayCurriculumComplete(curriculum);
          rl.close();
          return;
        }

        // Create new progress for the next segment
        progress = createInitialProgress(segment.id, state.currentSegmentIndex);
        await saveProgress(curriculum.workingDirectory, progress);

        // Prune context for new segment
        messages = pruneContextForNewSegment(result.summary || "");
        const nextSegment = getCurrentSegment(
          curriculum,
          state.currentSegmentIndex + 1,
        );
        displaySegmentComplete(
          result.summary || "Segment complete",
          nextSegment?.title,
        );

        // Display new segment header
        displaySegmentHeader(curriculum, segment, state.currentSegmentIndex);

        // Kick off new segment
        const newResult = await agentCaller.callAgent("start", messages, {
          curriculum,
          state,
          segment,
          segmentIndex: state.currentSegmentIndex,
          previousSummary,
          onSegmentComplete: (summary) => {
            previousSummary = summary;
          },
        });
        messages = newResult.messages;
        // Update golden code manager for new segment
        await goldenCodeManager.updateSegment(segment);
        newLine();
      }
    } catch (error: any) {
      displayError(error.message);
    }
  }
}
