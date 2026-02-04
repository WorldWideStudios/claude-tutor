import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { createProjectDirectory } from "./preflight.js";
import { initGitRepo } from "./git.js";
import { createCurriculum, isCurriculumComplete } from "./curriculum.js";
import {
  loadState,
  saveState,
  saveCurriculum,
  loadCurriculum,
  createInitialState,
} from "./storage.js";
import {
  displayInfo,
  displayGitInit,
  displayQuestionPrompt,
  closeQuestionPrompt,
  startLoading,
  stopLoading,
  updateLoadingStatus,
  newLine,
  displayResume,
} from "./display.js";
import type { ProjectLoadResult, LearnerProfile } from "./types.js";
import { askClarifyingQuestions, type QuestionContext } from "./questions.js";
import { askRawModeQuestion } from "./input.js";
import { logInteraction } from "./logging.js";

/**
 * Load existing project from global state or specified directory
 * Returns null if no project found or if project is complete
 */
export async function loadExistingProject(
  projectDir?: string,
): Promise<ProjectLoadResult> {
  try {
    const state = await loadState();
    if (!state) return null;

    // Determine curriculum path
    let curriculumPath: string;
    if (projectDir) {
      const resolvedDir = path.resolve(projectDir);
      curriculumPath = path.join(resolvedDir, ".curriculum.json");
    } else if (state.curriculumPath) {
      curriculumPath = state.curriculumPath;
    } else {
      return null;
    }

    // Load curriculum
    const curriculum = await loadCurriculum(curriculumPath);
    if (!curriculum) return null;

    // Check if curriculum is complete
    if (isCurriculumComplete(curriculum, state.completedSegments)) {
      return null;
    }

    return { curriculum, state };
  } catch (error) {
    // Silently return null for any loading errors
    return null;
  }
}

/**
 * Prompt user to resume an existing project
 * Returns true if user wants to resume, false otherwise
 */
export async function promptToResumeProject(
  curriculum: any,
  state: any,
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const progress = `${state.currentSegmentIndex + 1}/${curriculum.segments.length}`;
  displayInfo(
    `Found existing project: "${curriculum.projectName}" (segment ${progress})`,
  );
  newLine();

  const answer = await new Promise<string>((resolve) => {
    displayQuestionPrompt("Continue this project? (y/n)");
    rl.once("line", resolve);
  });
  closeQuestionPrompt("Continue this project? (y/n)", answer);
  rl.close();

  const shouldResume =
    answer.toLowerCase() === "y" ||
    answer.toLowerCase() === "yes" ||
    answer === "";

  if (!shouldResume) {
    displayInfo("Starting new project...");
    newLine();
  }

  return shouldResume;
}

/**
 * Resume an existing project
 * Handles the entire resume flow: backend notification, user confirmation, and starting tutor loop
 * Returns true if project was resumed, false if user declined
 */
export async function resumeExistingProject(
  curriculum: any,
  state: any,
): Promise<boolean> {
  // Notify backend of resume
  const { callResumeEndpoint } = await import("./auth.js");
  await callResumeEndpoint();

  // Prompt user to confirm
  const shouldResume = await promptToResumeProject(curriculum, state);

  if (!shouldResume) {
    return false;
  }

  // Display resume info and start
  displayResume(curriculum, state);

  const { runTutorLoop } = await import("./tutor-loop.js");
  await runTutorLoop(curriculum, state);

  return true;
}

/**
 * Set up a new project from scratch
 * Handles the entire flow: questions, directory creation, curriculum generation, git init
 * Returns the curriculum and state ready for runTutorLoop
 */
export async function setupNewProject(
  projectName?: string,
  projectDir?: string,
): Promise<{ curriculum: any; state: any }> {
  // Track whether user specified a directory or we should auto-create one
  const userSpecifiedDir = !!projectDir;
  let resolvedProjectDir = userSpecifiedDir ? path.resolve(projectDir) : "";

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

  // Get project name if not provided
  let finalProjectName = projectName;
  if (!finalProjectName) {
    finalProjectName = await askRawModeQuestion(promptQuestion);
    if (!finalProjectName.trim()) {
      throw new Error("Project name is required.");
    }
    finalProjectName = finalProjectName.trim();
  }

  // Log initial question and answer
  logInteraction("initial_question", {
    question_text: promptQuestion,
    answer_text: finalProjectName,
  });

  // Now create readline for subsequent interactions
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Use dynamic questions based on project idea and backend context
  displayInfo("Let me understand your project better:");
  const learnerProfile: LearnerProfile = await askClarifyingQuestions(
    promptQuestion,
    finalProjectName,
    rl,
    questionContext,
  );

  // Log profile creation
  logInteraction("profile_created", {
    metadata: {
      projectName: finalProjectName,
      learnerProfile,
    },
  });

  rl.close();
  newLine();

  // Create project directory - either use specified dir or auto-create a safe one
  if (!userSpecifiedDir) {
    // Auto-create a safe project directory based on project name
    resolvedProjectDir = createProjectDirectory(finalProjectName);
  } else {
    // User specified a directory - create it if needed
    fs.mkdirSync(resolvedProjectDir, { recursive: true });
  }
  displayInfo(`Project folder: ${resolvedProjectDir}`);

  // Create curriculum with streaming progress
  startLoading();
  const curriculum = await createCurriculum(
    finalProjectName,
    finalProjectName,
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
    `Created ${curriculum.segments.length} segments for "${finalProjectName}".`,
  );
  newLine();

  return { curriculum, state };
}
