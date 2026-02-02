#!/usr/bin/env node

import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "fs";
import { logInteraction } from "./logging.js";

// Load .env manually (completely silent, no dotenv package)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        // Remove surrounding quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
}

import { Command } from "commander";
import * as readline from "readline";
import { execSync } from "child_process";
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
  loadProgress,
  saveProgress,
  createInitialProgress,
  updateProgress,
  addCompletedStep,
} from "./storage.js";
import {
  runAgentTurn,
  createInitialMessages,
  pruneContextForNewSegment,
} from "./agent.js";
import {
  createTyperSharkInput,
  createMultiLineTyperSharkInput,
  createInteractiveSelect,
  createFreeFormInput,
  type ExtractedCode,
} from "./input.js";
import { isDiscussMode, isBlockMode, isTutorMode, getMode } from "./mode.js";
import {
  goldenCodeToExtractedCode,
  getGoldenCodeStepCount,
  hasMoreGoldenSteps,
} from "./golden-code.js";
import chalk from "chalk";
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
  redrawQuestionBottomBar,
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
  colors,
  symbols,
  drawBar,
} from "./display.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type {
  Curriculum,
  TutorState,
  LearnerProfile,
  Progress,
} from "./types.js";
import { askClarifyingQuestions, type QuestionContext } from "./questions.js";
import { loginCommand } from "./auth.js";
import { checkAndAutoUpdate, restartProcess } from "./update.js";

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
  .version("0.1.0")
  .option(
    "-d, --dir <directory>",
    "Project directory (auto-creates if not specified)",
  )
  .option("-t, --token <apiKey>", "API token for authentication")
  .action(async (options) => {
    // Check for updates and auto-update if available
    const needsRestart = await checkAndAutoUpdate();
    if (needsRestart) {
      restartProcess();
      return;
    }

    // Handle token authentication
    if (options.token) {
      try {
        await saveConfig({ apiKey: options.token });
        displayInfo("✓ API token saved successfully!");
        displayInfo("Initializing your session...");
      } catch (error) {
        console.error("Failed to save API token:", error);
        process.exit(1);
      }
    }
    // Default action: start a new project
    await startCommand(options.dir);
  });

program
  .command("resume")
  .description("Resume the current tutoring project")
  .option("-d, --dir <directory>", "Project directory to resume")
  .action(async (options) => {
    // Check for updates and auto-update if available
    const needsRestart = await checkAndAutoUpdate();
    if (needsRestart) {
      restartProcess();
      return;
    }

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
  let resolvedProjectDir = userSpecifiedDir ? path.resolve(projectDir) : ""; // Will be set after getting project name

  // Check for existing project in GLOBAL STATE first (when no directory specified)
  if (!userSpecifiedDir) {
    const existingState = await loadState();
    if (existingState && existingState.curriculumPath) {
      const existingCurriculum = await loadCurriculum(
        existingState.curriculumPath,
      );
      if (
        existingCurriculum &&
        !isCurriculumComplete(
          existingCurriculum,
          existingState.completedSegments,
        )
      ) {
        // There's an active project - ask if they want to resume
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const progress = `${existingState.currentSegmentIndex + 1}/${existingCurriculum.segments.length}`;
        displayInfo(
          `Found existing project: "${existingCurriculum.projectName}" (segment ${progress})`,
        );
        newLine();

        const answer = await new Promise<string>((resolve) => {
          displayQuestionPrompt("Continue this project? (y/n)");
          rl.once("line", resolve);
        });
        closeQuestionPrompt("Continue this project? (y/n)", answer);

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
  }

  // Check for existing project IN THE SPECIFIED DIRECTORY (only if user specified one)
  let existingCurriculum = null;
  if (userSpecifiedDir) {
    const curriculumPathInDir = path.join(
      resolvedProjectDir,
      ".curriculum.json",
    );
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

      const progress = `${existingState.currentSegmentIndex + 1}/${existingCurriculum.segments.length}`;
      displayInfo(
        `Found existing project: "${existingCurriculum.projectName}" (segment ${progress})`,
      );
      newLine();

      const answer = await new Promise<string>((resolve) => {
        displayQuestionPrompt("Continue this project? (y/n)");
        rl.once("line", resolve);
      });
      closeQuestionPrompt("Continue this project? (y/n)", answer);

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

  // Raw mode question function (no readline, preserves styling)
  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      displayQuestionPrompt(prompt);

      // Use raw mode for styled input (no readline interference)
      process.stdin.setRawMode(true);
      process.stdin.resume();

      let inputBuffer = "";
      const termWidth = process.stdout.columns || 80;
      const prefixLen = 2; // "› " is 2 chars
      const inputWidth = termWidth - prefixLen;

      // Calculate how many visual lines the input takes
      const getInputLineCount = (text: string): number => {
        if (text.length === 0) return 1;
        return Math.ceil(text.length / inputWidth);
      };

      // Redraw the entire input area (handles wrapping properly)
      const redrawInput = () => {
        const lineCount = getInputLineCount(inputBuffer);

        // Move to start of input area (line with "› ")
        // Move up by current line count to get back to the first line
        if (lineCount > 1) {
          process.stdout.write(`\x1B[${lineCount - 1}A`);
        }
        process.stdout.write("\r");

        // Clear from cursor to end of screen (removes old input and bottom bar)
        process.stdout.write("\x1B[J");

        // Draw input with proper wrapping
        const lines: string[] = [];
        for (let i = 0; i < inputBuffer.length; i += inputWidth) {
          lines.push(inputBuffer.slice(i, i + inputWidth));
        }
        if (lines.length === 0) lines.push("");

        lines.forEach((line, idx) => {
          if (idx === 0) {
            process.stdout.write(colors.primary(symbols.arrow + " ") + line);
          } else {
            process.stdout.write("\n  " + line);
          }
        });

        // Draw bottom bar on new line
        process.stdout.write("\n" + drawBar());

        // Move cursor back to end of input
        process.stdout.write("\x1B[1A"); // Move up to input line
        const lastLineLen = lines[lines.length - 1].length;
        const cursorCol = (lines.length === 1 ? prefixLen : 2) + lastLineLen;
        process.stdout.write(`\r\x1B[${cursorCol}C`);
      };

      const handleInput = (chunk: Buffer) => {
        const char = chunk.toString();

        if (char === "\x03") {
          // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", handleInput);
          process.exit(0);
        }

        if (char === "\r" || char === "\n") {
          // Enter
          process.stdin.setRawMode(false);
          process.stdin.removeListener("data", handleInput);
          closeQuestionPrompt(prompt, inputBuffer);
          resolve(inputBuffer);
          return;
        }

        if (char === "\x7f" || char === "\b") {
          // Backspace
          if (inputBuffer.length > 0) {
            inputBuffer = inputBuffer.slice(0, -1);
            redrawInput();
          }
          return;
        }

        // Regular character
        if (char.length === 1 && char >= " " && char <= "~") {
          inputBuffer += char;
          redrawInput();
        }
      };

      process.stdin.on("data", handleInput);
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
      process.exit(1);
    }

    // Log initial question and answer
    logInteraction("initial_question", {
      question_text: promptQuestion,
      answer_text: projectName.trim(),
    });

    // Now create readline for subsequent interactions (after raw mode input is done)
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
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
  let currentGoldenStepIndex = 0; // Track position in goldenCode for plan-based tutor mode

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Note: We intentionally do NOT call readline.emitKeypressEvents() here
  // because it adds an internal data listener that interferes with our
  // raw mode input handlers, causing doubled character input.

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

  displaySegmentHeader(curriculum, segment, state.currentSegmentIndex);

  // Send initial "start" or "resume" message to kick off the segment
  try {
    resetStreamState();
    setAgentRunning(true);
    startLoading();
    let loadingStopped = false;
    const startMessage = isResuming ? "resume" : "start";
    const result = await runAgentTurn(startMessage, messages, {
      curriculum,
      state,
      segment,
      segmentIndex: state.currentSegmentIndex,
      previousSummary,
      progress: isResuming ? progress : undefined, // Only pass progress if resuming
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
    // Initialize golden step index but DON'T pre-load code yet
    // Let the first input prompt load the appropriate step based on tutor context
    if (segment && segment.goldenCode) {
      currentGoldenStepIndex = progress.currentGoldenStep || 0;
      // Don't set currentExpectedCode here - it will be loaded lazily in getInput()
    }
    // Save the tutor's initial message to progress
    if (result.lastResponse) {
      await updateProgress(curriculum.workingDirectory, {
        lastTutorMessage: result.lastResponse.slice(0, 500),
        totalGoldenSteps: segment
          ? getGoldenCodeStepCount(segment.goldenCode)
          : 0,
      });
    }
    newLine();
  } catch (error: any) {
    stopLoading();
    setAgentRunning(false);
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
      currentExpectedCode = null; // Clear any expected code in discuss mode
      return result;
    }

    // CODE MODE: Regular terminal behavior - show expected code as reference, type freely
    if (isBlockMode() && !heredocState.active) {
      const expectedCodeStr =
        currentExpectedCode?.isMultiLine && currentExpectedCode?.lines
          ? currentExpectedCode.lines.map((l) => l.code).join("\n")
          : currentExpectedCode?.code || null;
      const result = await createFreeFormInput(rl, expectedCodeStr);
      currentExpectedCode = null; // Clear expected code after input
      return result;
    }

    // TUTOR MODE: Use Typer Shark for guided typing
    // Don't use Typer Shark for heredoc continuation lines
    // Lazy load golden code if not already loaded
    if (!currentExpectedCode && !heredocState.active && segment?.goldenCode) {
      console.log("setting here", currentGoldenStepIndex);
      currentExpectedCode = goldenCodeToExtractedCode(
        segment.goldenCode,
        currentGoldenStepIndex,
      );
      // console.log("setting here", currentExpectedCode, );
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
        currentExpectedCode = null;

        // Check if user asked a question instead of typing code
        if (results.length === 1 && results[0].startsWith("__QUESTION__:")) {
          // Extract the question and return it as natural language
          return results[0].slice("__QUESTION__:".length);
        }

        // Advance to next golden step after successful multi-line input
        if (
          segment &&
          segment.goldenCode &&
          hasMoreGoldenSteps(segment.goldenCode, currentGoldenStepIndex)
        ) {
          currentGoldenStepIndex++;
          await updateProgress(curriculum.workingDirectory, {
            currentGoldenStep: currentGoldenStepIndex,
          });
        }

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

        // Advance to next golden step after successful single-line input
        if (
          segment &&
          segment.goldenCode &&
          hasMoreGoldenSteps(segment.goldenCode, currentGoldenStepIndex)
        ) {
          currentGoldenStepIndex++;
          await updateProgress(curriculum.workingDirectory, {
            currentGoldenStep: currentGoldenStepIndex,
          });
        }

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
      modeBeforeInput !== modeAfterInput &&
      isTutorMode() &&
      segment &&
      segment.goldenCode
    ) {
      // Reload current step from plan when switching to tutor mode
      currentExpectedCode = goldenCodeToExtractedCode(
        segment.goldenCode,
        currentGoldenStepIndex,
      );
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
          // Note: Step advancement now happens in Typer Shark completion
          // Load next step from plan (if not already loaded)
          if (segment && segment.goldenCode && !currentExpectedCode) {
            currentExpectedCode = goldenCodeToExtractedCode(
              segment.goldenCode,
              currentGoldenStepIndex,
            );
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

    // In discuss mode, print the user's question as a log entry
    if (isDiscussMode() && userInput) {
      console.log(colors.dim("› " + userInput));
      console.log();
    }

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
        // Reload current step from plan (don't advance on Enter)
        if (isTutorMode() && segment && segment.goldenCode) {
          currentExpectedCode = goldenCodeToExtractedCode(
            segment.goldenCode,
            currentGoldenStepIndex,
          );
        } else if (isDiscussMode()) {
          currentExpectedCode = null;
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
      // Note: Step advancement now happens in Typer Shark completion
      // Load next step from plan (if not already loaded)
      if (
        isTutorMode() &&
        segment &&
        segment.goldenCode &&
        !currentExpectedCode
      ) {
        currentExpectedCode = goldenCodeToExtractedCode(
          segment.goldenCode,
          currentGoldenStepIndex,
        );
      } else if (isDiscussMode()) {
        currentExpectedCode = null;
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
        // Reset golden step index for new segment and load from plan
        currentGoldenStepIndex = 0;
        if (segment && segment.goldenCode) {
          currentExpectedCode = goldenCodeToExtractedCode(
            segment.goldenCode,
            currentGoldenStepIndex,
          );
          await updateProgress(curriculum.workingDirectory, {
            currentGoldenStep: 0,
            totalGoldenSteps: getGoldenCodeStepCount(segment.goldenCode),
          });
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
