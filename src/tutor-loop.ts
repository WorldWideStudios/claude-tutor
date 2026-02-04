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
import { isDiscussMode, isBlockMode, isTutorMode, getMode } from "./mode.js";
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
import { runPreflightChecks } from "./preflight.js";
import { AgentCaller } from "./tutor-loop/agent-caller.js";
import { GoldenCodeManager } from "./tutor-loop/GoldenCodeManager.js";
import { CommandExecutor } from "./tutor-loop/CommandExecutor.js";
import { InputHandler } from "./tutor-loop/InputHandler.js";
import { SegmentLifecycleManager } from "./tutor-loop/SegmentLifecycleManager.js";

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
    progress.currentGoldenStep || 0,
  );

  // When resuming, check if current golden step is already complete and advance past it
  if (isResuming && segment?.goldenCode && progress.codeWritten) {
    const totalSteps = goldenCodeManager.getTotalSteps();
    const currentStep = goldenCodeManager.getCurrentIndex();

    // If code is already written, syntax verified, and code reviewed,
    // the current golden code step is complete
    if (
      progress.codeWritten &&
      progress.syntaxVerified &&
      progress.codeReviewed
    ) {
      // If not at final step, advance to next step
      if (currentStep < totalSteps - 1) {
        console.log(
          `[TutorLoop] Resuming: current golden step ${currentStep} already complete, advancing...`,
        );
        await goldenCodeManager.advance();
      } else {
        // At final step and it's complete - clear it so it won't reload
        console.log(
          `[TutorLoop] Resuming: final golden step ${currentStep} already complete, clearing...`,
        );
        goldenCodeManager.clear();
        // Mark this step as loaded to prevent reload
        await goldenCodeManager.loadCurrentStep();
        goldenCodeManager.clear();
      }
    }
  }

  // Setup command executor
  const commandExecutor = new CommandExecutor(
    curriculum.workingDirectory,
    updateProgress,
    addCompletedStep,
  );

  // Setup input handler
  const inputHandler = new InputHandler(rl, goldenCodeManager, commandExecutor);
  inputHandler.setSegment(segment);

  // Setup segment lifecycle manager
  const lifecycleManager = new SegmentLifecycleManager({
    saveState,
    saveProgress,
    createInitialProgress,
    logInteraction,
    getCurrentSegment,
    isCurriculumComplete,
    pruneContextForNewSegment,
    displaySegmentComplete,
    displayCurriculumComplete,
    displaySegmentHeader,
  });

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

  // Main conversation loop
  while (true) {
    // Track mode before getting input to detect transitions
    const modeBeforeInput = getMode();
    const input = await inputHandler.getInput();

    // Detect mode change during input (user pressed Shift+Tab)
    const modeAfterInput = getMode();
    if (modeBeforeInput !== modeAfterInput) {
      await inputHandler.handleModeTransition(modeBeforeInput, modeAfterInput);
    }
    // Handle heredoc continuation
    if (commandExecutor.isHeredocActive()) {
      if (input.trim() === commandExecutor["heredocState"].delimiter) {
        // End of heredoc - execute full command
        const cmdResult = await commandExecutor.completeHeredoc(input.trim());

        if (cmdResult) {
          const fullCommand =
            commandExecutor.getHeredocCommand() + "\n" + input.trim();
          displayCommand(
            fullCommand.split("\n")[0] + " ...",
            cmdResult.success,
          );
          displayCommandOutput(cmdResult.output);

          // Send to Claude
          const messageToSend = cmdResult.success
            ? `I ran a heredoc command to create/modify a file:\n${fullCommand}\nResult: Success`
            : `I ran a heredoc command:\n${fullCommand}\nError: ${cmdResult.output}`;

          try {
            const result = await agentCaller.callAgent(
              messageToSend,
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
            // Note: Step advancement now happens in Typer Shark completion
            // Load next step from plan (if not already loaded)
            if (!goldenCodeManager.getCurrentCode()) {
              await goldenCodeManager.loadCurrentStep();
            }
            newLine();
          } catch (error: any) {
            // Reset heredoc state on error
            commandExecutor.resetHeredoc();
            displayError(error.message);
          }
        }
        continue;
      } else {
        // Continue collecting heredoc lines
        commandExecutor.addHeredocLine(input);
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
        isShellCommand: commandExecutor.isShellCommand(userInput),
        segmentIndex: state.currentSegmentIndex,
      },
    });

    // Check if it's a shell command
    let messageToSend = userInput;
    if (commandExecutor.isShellCommand(userInput)) {
      // Check if it starts a heredoc
      const { isHeredoc, delimiter } = commandExecutor.startsHeredoc(userInput);
      if (isHeredoc) {
        // Start heredoc mode
        commandExecutor.startHeredoc(userInput, delimiter);
        continue;
      }

      // Regular command - execute it
      const cmdResult = await commandExecutor.executeAndTrack(userInput);
      displayCommand(userInput, cmdResult.success);
      displayCommandOutput(cmdResult.output);

      messageToSend = commandExecutor.getMessageForAgent(userInput, cmdResult);
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
      // Note: Golden code loading is handled lazily in InputHandler.getInput()
      // when user input is needed. No need to preload here.
      if (isDiscussMode()) {
        goldenCodeManager.clear();
      }
      newLine();

      // Check if segment was completed
      if (result.segmentCompleted) {
        const completionResult = await lifecycleManager.handleSegmentCompletion(
          {
            curriculum,
            state,
            segment: segment!,
            progress,
            summary: result.summary,
          },
        );

        // Check if curriculum is complete
        if (completionResult.curriculumComplete) {
          rl.close();
          return;
        }

        // Update to next segment
        segment = completionResult.nextSegment;
        if (!segment) {
          rl.close();
          return;
        }

        // Update managers with new segment
        inputHandler.setSegment(segment);
        await goldenCodeManager.updateSegment(segment);

        // Update progress and messages
        progress = completionResult.nextProgress!;
        messages = completionResult.prunedMessages;

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
        newLine();
      }
    } catch (error: any) {
      displayError(error.message);
    }
  }
}
