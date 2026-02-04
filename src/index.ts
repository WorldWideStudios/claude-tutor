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
  resumeExistingProject,
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
  .option(
    "--curriculum <path>",
    "Path to curriculum JSON file (skips curriculum generation)",
  )
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
    await startCommand(options.dir, options.curriculum);
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
async function startCommand(
  projectDir: string | undefined,
  curriculumPath: string | undefined,
): Promise<void> {
  // Check if config exists
  if (!(await configExists())) {
    console.error(
      'No configuration found. Please run "claude-tutor login" first.',
    );
    process.exit(1);
  }

  // Validate curriculum file if provided
  let validatedCurriculumPath: string | undefined;
  if (curriculumPath) {
    const resolvedPath = path.resolve(process.cwd(), curriculumPath);

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Curriculum file not found: ${resolvedPath}`);
      process.exit(1);
    }

    // Try to parse and validate JSON
    try {
      const fileContent = fs.readFileSync(resolvedPath, "utf-8");
      const curriculumData = JSON.parse(fileContent);

      // Validate against schema
      const { CurriculumSchema } = await import("./types.js");
      const result = CurriculumSchema.safeParse(curriculumData);

      if (!result.success) {
        console.error("Invalid curriculum structure:");
        result.error.issues.forEach((issue) => {
          console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
        });
        process.exit(1);
      }

      validatedCurriculumPath = resolvedPath;
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        console.error(`Invalid curriculum JSON: ${error.message}`);
      } else {
        console.error(`Failed to load curriculum: ${error.message}`);
      }
      process.exit(1);
    }
  }

  displayWelcome();

  try {
    // Check for existing project in global state (if no directory specified)
    // or in specified directory
    const existingProject = await loadExistingProject(projectDir);

    if (existingProject) {
      const { curriculum, state } = existingProject;
      const resumed = await resumeExistingProject(curriculum, state);
      if (resumed) {
        return;
      }
    }

    // Set up new project
    const { curriculum, state } = await setupNewProject(
      undefined,
      projectDir,
      validatedCurriculumPath,
    );

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

    // Resume the project
    const resumed = await resumeExistingProject(curriculum, state);

    if (!resumed) {
      displayInfo("Resume cancelled.");
      process.exit(0);
    }
  } catch (error: any) {
    displayError(error.message);
    process.exit(1);
  }
}
