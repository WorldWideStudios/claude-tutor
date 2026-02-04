#!/usr/bin/env node

import { fileURLToPath } from "url";
import * as path from "path";
import * as fs from "fs";

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
import { configExists, saveConfig } from "./storage.js";
import {
  loadExistingProject,
  promptToResumeProject,
  setupNewProject,
} from "./project-lifecycle.js";

import {
  displayWelcome,
  displayResume,
  displayError,
  displayCurriculumComplete,
  displayInfo,
} from "./display.js";
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

  displayWelcome();

  try {
    // Check for existing project in global state (if no directory specified)
    // or in specified directory
    const existingProject = await loadExistingProject(projectDir);

    if (existingProject) {
      const { curriculum, state } = existingProject;
      const shouldResume = await promptToResumeProject(curriculum, state);

      if (shouldResume) {
        displayResume(curriculum, state);
        await runTutorLoop(curriculum, state);
        return;
      }
    }

    // Set up new project
    const { curriculum, state } = await setupNewProject(undefined, projectDir);

    // Start the tutor loop
    await runTutorLoop(curriculum, state);
  } catch (error: any) {
    displayError(error.message);
    process.exit(1);
  }
}

/**
 * Resume an existing tutoring project
 */
async function resumeCommand(projectDir?: string): Promise<void> {
  try {
    // Load existing project
    const existingProject = await loadExistingProject(projectDir);

    if (!existingProject) {
      displayError(
        'No active project found. Run "claude-tutor" to start a new project.',
      );
      process.exit(1);
    }

    const { curriculum, state } = existingProject;

    // Always prompt before resuming
    const shouldResume = await promptToResumeProject(curriculum, state);

    if (!shouldResume) {
      displayInfo("Resume cancelled.");
      process.exit(0);
    }

    displayResume(curriculum, state);

    // Start the tutor loop (preflight checks now happen inside runTutorLoop)
    await runTutorLoop(curriculum, state);
  } catch (error: any) {
    displayError(error.message);
    process.exit(1);
  }
}
