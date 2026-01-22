#!/usr/bin/env node

import { config } from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";
import { logInteraction } from "./logging.js";

// Load .env from the package directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "..", ".env") });

import { Command } from "commander";
import * as readline from "readline";
import { execSync } from "child_process";
import * as fs from "fs";
import { runPreflightChecks, createProjectDirectory } from "./preflight.js";
import { initGitRepo } from "./git.js";
import {
  createCurriculum,
  getCurrentSegment,
  isCurriculumComplete,
} from "./curriculum.js";
import {
  loadState,
  saveState,
  saveCurriculum,
  loadCurriculum,
  createInitialState,
  configExists,
  saveConfig,
} from "./storage.js";
import {
  runAgentTurn,
  createInitialMessages,
  pruneContextForNewSegment,
} from "./agent.js";
import {
  extractExpectedCode,
  createTyperSharkInput,
  createMultiLineTyperSharkInput,
  createInteractiveSelect,
  type ExtractedCode,
} from "./input.js";
import {
  displayWelcome,
  displaySegmentHeader,
  displayResume,
  displayTutorText,
  displaySegmentComplete,
  displayCurriculumComplete,
  displayError,
  displayPrompt,
  displayPreflightError,
  displayGitInit,
  displayInfo,
  displayUserMessage,
  displayQuestionPrompt,
  closeQuestionPrompt,
  displayCommand,
  displayCommandOutput,
  displayContinuationPrompt,
  displayStatus,
  displayStep,
  displayTargetLine,
  clearExpectedText,
  checkTypingComplete,
  displayToolStatus,
  setAgentRunning,
  resetStreamState,
  startLoading,
  stopLoading,
  updateLoadingStatus,
  isLoadingActive,
  newLine,
} from "./display.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Curriculum, TutorState, LearnerProfile } from "./types.js";
import { askClarifyingQuestions, type QuestionContext } from "./questions.js";
import { loginCommand } from "./auth.js";

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

// Abort controller for cancelling requests
let shouldCancel = false;

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
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash",
    });
    return { success: true, output: output || "" };
  } catch (error: any) {
    return {
      success: false,
      output: error.stderr || error.stdout || error.message,
    };
  }
}

const program = new Command();

program
  .name("claude-tutor")
  .description("Claude Software Engineering Tutor")
  .version("1.0.0")
  .option("-d, --dir <directory>", "Project directory", process.cwd())
  .option("-t, --token <apiKey>", "API token for authentication")
  .action(async (options) => {
    // Handle token authentication
    if (options.token) {
      await saveConfig({ apiKey: options.token });
      displayInfo("✓ API token saved successfully!");
      displayInfo('You can now run "claude-tutor" to start.');
      process.exit(0);
    }
    // Default action: start a new project
    await startCommand(options.dir);
  });

program
  .command("resume")
  .description("Resume the current tutoring project")
  .option("-d, --dir <directory>", "Project directory to resume")
  .action(async (options) => {
    await resumeCommand(options.dir);
  });

program
  .command("login")
  .description("Configure API credentials")
  .action(async () => {
    await loginCommand();
  });

program.parse();

/**
 * Start a new tutoring project
 */
async function startCommand(projectDir: string | undefined): Promise<void> {
  // Check if config exists
  if (!(await configExists())) {
    console.error(
      'No configuration found. Please run "claude-tutor login" first.',
    );
    process.exit(1);
  }

  displayWelcome(); // No skill on initial startup

  // Track whether user specified a directory or we should auto-create one
  const userSpecifiedDir = !!projectDir;
  let resolvedProjectDir = userSpecifiedDir
    ? path.resolve(projectDir)
    : ""; // Will be set after getting project name

  // Check for existing project IN THE SPECIFIED DIRECTORY (only if user specified one)
  let existingCurriculum = null;
  if (userSpecifiedDir) {
    const curriculumPathInDir = path.join(resolvedProjectDir, ".curriculum.json");
    try {
      existingCurriculum = await loadCurriculum(curriculumPathInDir);
    } catch {
      // No curriculum in this directory, proceed with new project
    }
  }

  // If a curriculum exists in THIS directory, ask to resume
  if (existingCurriculum && userSpecifiedDir) {
    const existingState = await loadState();
    if (
      existingState &&
      !isCurriculumComplete(existingCurriculum, existingState.completedSegments)
    ) {
      // There's an active project - ask if they want to resume
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const progress = `${existingState.currentSegmentIndex}/${existingCurriculum.segments.length}`;
      displayInfo(
        `Continue project: "${existingCurriculum.projectName}" (${progress} complete)`,
      );
      newLine();

      const answer = await new Promise<string>((resolve) => {
        displayQuestionPrompt("Resume this project? (y/n)");
        rl.once("line", resolve);
      });

      if (
        answer.toLowerCase() === "y" ||
        answer.toLowerCase() === "yes" ||
        answer === ""
      ) {
        rl.close();
        // Resume the existing project
        displayResume(existingCurriculum, existingState);
        await runTutorLoop(existingCurriculum, existingState);
        return;
      }

      rl.close();
      displayInfo("Starting new project...");
      newLine();
    }
  }

  // Get project details from user first
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      displayQuestionPrompt(prompt);
      rl.once("line", (answer) => {
        closeQuestionPrompt(prompt, answer);
        resolve(answer);
      });
    });
  };

  try {
    // Try to get personalized question and context from backend
    let promptQuestion = "What do you want to build?";
    let questionContext: QuestionContext = {};

    try {
      const { callInitEndpoint } = await import("./auth.js");
      const initResponse = await callInitEndpoint();
      if (initResponse.success) {
        if (initResponse.question) {
          promptQuestion = initResponse.question;
        }
        // Build context from init response for smarter questions
        questionContext = {
          userEmail: initResponse.email,
          totalMessages: initResponse.totalMessages,
          initialQuestion: initResponse.question,
        };
      }
    } catch (error) {
      // Silently fall back to default prompt if init endpoint fails
    }

    const projectName = await question(promptQuestion);
    if (!projectName.trim()) {
      displayError("Project name is required.");
      rl.close();
      process.exit(1);
    }

    // Log initial question and answer
    logInteraction("initial_question", {
      question_text: promptQuestion,
      answer_text: projectName.trim(),
    });

    // Use dynamic questions based on project idea and backend context
    displayInfo("Let me understand your project better:");
    const learnerProfile = await askClarifyingQuestions(
      promptQuestion,
      projectName.trim(),
      rl,
      questionContext,
    );

    // Log profile creation
    logInteraction("profile_created", {
      metadata: {
        projectName: projectName.trim(),
        learnerProfile,
      },
    });

    rl.close();
    newLine();

    // Create project directory - either use specified dir or auto-create a safe one
    if (!userSpecifiedDir) {
      // Auto-create a safe project directory based on project name
      resolvedProjectDir = createProjectDirectory(projectName.trim());
    } else {
      // User specified a directory - create it if needed
      fs.mkdirSync(resolvedProjectDir, { recursive: true });
    }
    displayInfo(`Project folder: ${resolvedProjectDir}`);

    // Run pre-flight checks on the directory
    const preflight = runPreflightChecks(resolvedProjectDir);
    if (!preflight.ok) {
      displayPreflightError(preflight.error!);
      process.exit(1);
    }

    // Create curriculum with streaming progress
    startLoading();
    const curriculum = await createCurriculum(
      projectName.trim(),
      projectName.trim(),
      resolvedProjectDir,
      {
        onStep: (step) => {
          // Update spinner to show current step (not print a separate line)
          updateLoadingStatus(step.replace("...", ""));
        },
      },
      learnerProfile,
    );
    stopLoading();
    const curriculumPath = await saveCurriculum(curriculum);

    // Initialize Git (silent)
    const gitResult = initGitRepo(resolvedProjectDir);
    if (gitResult.success) {
      displayGitInit();
    }

    // Create initial state
    const state = createInitialState(curriculumPath);
    await saveState(state);

    displayInfo(
      `Created ${curriculum.segments.length} segments for "${projectName}".`,
    );
    newLine();

    // Start the tutor loop
    await runTutorLoop(curriculum, state);
  } catch (error: any) {
    stopLoading();
    displayError(error.message);
    process.exit(1);
  }
}

/**
 * Resume an existing tutoring project
 */
async function resumeCommand(projectDir?: string): Promise<void> {
  try {
    const state = await loadState();

    // If directory provided, resolve it and look for curriculum there
    let curriculumPath: string;
    if (projectDir) {
      const resolvedDir = path.resolve(projectDir);
      curriculumPath = path.join(resolvedDir, ".curriculum.json");
    } else if (state && state.curriculumPath) {
      curriculumPath = state.curriculumPath;
    } else {
      displayError('No active project. Run "tutor start" to begin.');
      process.exit(1);
    }

    const curriculum = await loadCurriculum(curriculumPath);
    if (!curriculum) {
      displayError(
        'Could not load curriculum. Start a new project with "tutor start".',
      );
      process.exit(1);
    }

    // Run pre-flight checks
    const preflight = runPreflightChecks(curriculum.workingDirectory);
    if (!preflight.ok) {
      displayPreflightError(preflight.error!);
      process.exit(1);
    }

    displayResume(curriculum, state);

    // Check if curriculum is complete
    if (isCurriculumComplete(curriculum, state.completedSegments)) {
      displayCurriculumComplete(curriculum);
      process.exit(0);
    }

    // Start the tutor loop
    await runTutorLoop(curriculum, state);
  } catch (error: any) {
    displayError(error.message);
    process.exit(1);
  }
}

/**
 * Main tutor conversation loop
 */
async function runTutorLoop(
  curriculum: Curriculum,
  state: TutorState,
): Promise<void> {
  let messages: MessageParam[] = createInitialMessages();
  let previousSummary: string | undefined;
  let currentExpectedCode: ExtractedCode | null = null; // Track what user should type with explanation

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Enable keypress events for ESC handling
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin, rl);
  }

  // Setup ESC key handling
  process.stdin.on("keypress", (_str, key) => {
    if (key && key.name === "escape" && isLoadingActive()) {
      shouldCancel = true;
      stopLoading();
      console.log("\n(Cancelled)");
      displayPrompt();
    }
  });

  // Get current segment
  let segment = getCurrentSegment(curriculum, state.currentSegmentIndex);
  if (!segment) {
    displayCurriculumComplete(curriculum);
    rl.close();
    return;
  }

  displaySegmentHeader(curriculum, segment, state.currentSegmentIndex);

  // Send initial "start" message to kick off the segment
  try {
    resetStreamState();
    setAgentRunning(true);
    startLoading();
    let loadingStopped = false;
    const result = await runAgentTurn("start", messages, {
      curriculum,
      state,
      segment,
      segmentIndex: state.currentSegmentIndex,
      previousSummary,
      onText: (text) => {
        if (!loadingStopped) {
          stopLoading();
          loadingStopped = true;
        }
        displayTutorText(text);
      },
      onToolUse: (toolName, status) => displayToolStatus(toolName, status),
      onSegmentComplete: (summary) => {
        const nextSegment = getCurrentSegment(
          curriculum,
          state.currentSegmentIndex + 1,
        );
        displaySegmentComplete(summary, nextSegment?.title);
      },
    });
    if (!loadingStopped) stopLoading();
    setAgentRunning(false);
    messages = result.messages;
    // Extract expected code from response for character tracking
    if (result.lastResponse) {
      currentExpectedCode = extractExpectedCode(result.lastResponse);
    }
    newLine();
  } catch (error: any) {
    stopLoading();
    setAgentRunning(false);
    displayError(`Failed to start segment: ${error.message}`);
    rl.close();
    process.exit(1);
  }

  // Helper to get input - uses Typer Shark when expected code exists
  const getInput = async (): Promise<string> => {
    // Don't use Typer Shark for heredoc continuation lines
    if (currentExpectedCode && !heredocState.active) {
      if (currentExpectedCode.isMultiLine && currentExpectedCode.lines) {
        // Multi-line Typer Shark for heredocs with interleaved comments
        const results = await createMultiLineTyperSharkInput(
          rl,
          currentExpectedCode.lines,
        );
        // Clear expected code after input
        currentExpectedCode = null;
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
        currentExpectedCode = null;
        return result;
      }
    } else {
      // Regular readline input (or heredoc continuation)
      if (heredocState.active) {
        displayContinuationPrompt();
      } else {
        displayPrompt();
      }
      return new Promise((resolve) => {
        rl.once("line", resolve);
      });
    }
  };

  // Main conversation loop
  while (true) {
    const input = await getInput();
    // Reset cancel flag
    shouldCancel = false;

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

        // Send to Claude
        const messageToSend = cmdResult.success
          ? `I ran a heredoc command to create/modify a file:\n${fullCommand}\nResult: Success`
          : `I ran a heredoc command:\n${fullCommand}\nError: ${cmdResult.output}`;

        try {
          resetStreamState();
          setAgentRunning(true);
          startLoading();
          let loadingStopped = false;
          const result = await runAgentTurn(messageToSend, messages, {
            curriculum,
            state,
            segment: segment!,
            segmentIndex: state.currentSegmentIndex,
            previousSummary,
            onText: (text) => {
              if (!loadingStopped) {
                stopLoading();
                loadingStopped = true;
              }
              displayTutorText(text);
            },
            onToolUse: (toolName, status) =>
              displayToolStatus(toolName, status),
            onSegmentComplete: (summary) => {
              previousSummary = summary;
            },
          });
          if (!loadingStopped) stopLoading();
          setAgentRunning(false);
          messages = result.messages;
          // Extract expected code for next input
          if (result.lastResponse) {
            currentExpectedCode = extractExpectedCode(result.lastResponse);
          }
          newLine();
        } catch (error: any) {
          stopLoading();
          setAgentRunning(false);
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

    // Empty Enter = continue signal
    if (!userInput) {
      try {
        resetStreamState();
        setAgentRunning(true);
        startLoading();
        let loadingStopped = false;
        const result = await runAgentTurn(
          "(user pressed Enter to continue)",
          messages,
          {
            curriculum,
            state,
            segment: segment!,
            segmentIndex: state.currentSegmentIndex,
            previousSummary,
            onText: (text) => {
              if (!loadingStopped) {
                stopLoading();
                loadingStopped = true;
              }
              displayTutorText(text);
            },
            onToolUse: (toolName, status) =>
              displayToolStatus(toolName, status),
            onSegmentComplete: (summary) => {
              previousSummary = summary;
            },
          },
        );
        if (!loadingStopped) stopLoading();
        setAgentRunning(false);
        messages = result.messages;
        // Extract expected code for next input
        if (result.lastResponse) {
          currentExpectedCode = extractExpectedCode(result.lastResponse);
        }
        newLine();
        continue;
      } catch (error: any) {
        stopLoading();
        setAgentRunning(false);
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

      messageToSend = cmdResult.success
        ? `I ran: ${userInput}\nOutput: ${cmdResult.output || "(success)"}`
        : `I ran: ${userInput}\nError: ${cmdResult.output}`;
    }

    try {
      resetStreamState();
      setAgentRunning(true);
      startLoading();
      let loadingStopped = false;
      const result = await runAgentTurn(messageToSend, messages, {
        curriculum,
        state,
        segment: segment!,
        segmentIndex: state.currentSegmentIndex,
        previousSummary,
        onText: (text) => {
          if (!loadingStopped) {
            stopLoading();
            loadingStopped = true;
          }
          displayTutorText(text);
        },
        onToolUse: (toolName, status) => displayToolStatus(toolName, status),
        onSegmentComplete: (summary) => {
          previousSummary = summary;
        },
      });
      if (!loadingStopped) stopLoading();
      setAgentRunning(false);

      messages = result.messages;
      // Extract expected code for next input
      if (result.lastResponse) {
        currentExpectedCode = extractExpectedCode(result.lastResponse);
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

        // Check if curriculum is complete
        if (isCurriculumComplete(curriculum, state.completedSegments)) {
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
        resetStreamState();
        setAgentRunning(true);
        startLoading();
        let newLoadingStopped = false;
        const newResult = await runAgentTurn("start", messages, {
          curriculum,
          state,
          segment,
          segmentIndex: state.currentSegmentIndex,
          previousSummary,
          onText: (text) => {
            if (!newLoadingStopped) {
              stopLoading();
              newLoadingStopped = true;
            }
            displayTutorText(text);
          },
          onToolUse: (toolName, status) => displayToolStatus(toolName, status),
          onSegmentComplete: (summary) => {
            previousSummary = summary;
          },
        });
        if (!newLoadingStopped) stopLoading();
        setAgentRunning(false);
        messages = newResult.messages;
        // Extract expected code for next input
        if (newResult.lastResponse) {
          currentExpectedCode = extractExpectedCode(newResult.lastResponse);
        }
        newLine();
      }
    } catch (error: any) {
      stopLoading();
      setAgentRunning(false);
      displayError(error.message);
    }
  }
}
