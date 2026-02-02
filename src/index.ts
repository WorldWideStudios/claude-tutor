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
} from "./storage.js";

import { createInteractiveSelect } from "./input.js";

import chalk from "chalk";
import {
  displayWelcome,
  displayResume,
  displayError,
  displayPreflightError,
  displayGitInit,
  displayInfo,
  displayQuestionPrompt,
  closeQuestionPrompt,
  redrawQuestionBottomBar,
  displayCurriculumComplete,
  startLoading,
  stopLoading,
  updateLoadingStatus,
  newLine,
  colors,
  symbols,
  drawBar,
} from "./display.js";
import type { Curriculum, TutorState, LearnerProfile } from "./types.js";
import { askClarifyingQuestions, type QuestionContext } from "./questions.js";
import { loginCommand } from "./auth.js";
import { checkAndAutoUpdate, restartProcess } from "./update.js";
import { runTutorLoop } from "./tutor-loop.js";

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
