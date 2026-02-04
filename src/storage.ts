import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  State,
  StateSchema,
  Curriculum,
  CurriculumSchema,
  Config,
  ConfigSchema,
  Progress,
  ProgressSchema,
} from "./types.js";

// Storage directory: ~/.claude-tutor/
const DATA_DIR = path.join(os.homedir(), ".claude-tutor");
const STATE_FILE = path.join(DATA_DIR, "state.json");
// Config file: ~/.claude-tutor-config.json
const CONFIG_FILE_PATH = path.join(os.homedir(), ".claude-tutor-config.json");

/**
 * Ensure the data directory exists
 */
export async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Load the current state
 */
export async function loadState(): Promise<State> {
  try {
    const data = await fs.readFile(STATE_FILE, "utf-8");
    return StateSchema.parse(JSON.parse(data));
  } catch {
    // Return default state if file doesn't exist or is invalid
    return {
      curriculumPath: null,
      currentSegmentIndex: 0,
      completedSegments: [],
      totalMinutesSpent: 0,
      lastAccessedAt: new Date().toISOString(),
    };
  }
}

/**
 * Save the current state
 */
export async function saveState(state: State): Promise<void> {
  await ensureDataDir();
  state.lastAccessedAt = new Date().toISOString();
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Load the config file
 */
export async function loadConfig(): Promise<Config | null> {
  try {
    const data = await fs.readFile(CONFIG_FILE_PATH, "utf-8");
    return ConfigSchema.parse(JSON.parse(data));
  } catch {
    return null;
  }
}

/**
 * Save the config file
 */
export async function saveConfig(config: Config): Promise<void> {
  await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
}

/**
 * Check if config file exists
 */
export async function configExists(): Promise<boolean> {
  try {
    await fs.access(CONFIG_FILE_PATH);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a curriculum by path
 */
export async function loadCurriculum(
  curriculumPath: string,
): Promise<Curriculum | null> {
  try {
    const data = await fs.readFile(curriculumPath, "utf-8");
    return CurriculumSchema.parse(JSON.parse(data));
  } catch {
    return null;
  }
}

/**
 * Save a curriculum
 */
export async function saveCurriculum(curriculum: Curriculum): Promise<string> {
  await ensureDataDir();
  const filename = `curriculum-${curriculum.id}.json`;
  const filepath = path.join(DATA_DIR, filename);
  await fs.writeFile(filepath, JSON.stringify(curriculum, null, 2));
  return filepath;
}

/**
 * Update a segment's goldenCode in the curriculum
 * Used when user confirms new code from discuss mode should update the plan
 */
export async function updateSegmentGoldenCode(
  curriculum: Curriculum,
  segmentIndex: number,
  newGoldenCode: string
): Promise<void> {
  const segment = curriculum.segments[segmentIndex];
  if (!segment) return;

  // Update the goldenCode
  segment.goldenCode = newGoldenCode;

  // Save the updated curriculum
  await saveCurriculum(curriculum);
}

/**
 * Update state to mark a segment as complete
 */
export async function markSegmentComplete(
  state: State,
  segmentId: string,
  summary: string,
): Promise<State> {
  const updatedState: State = {
    ...state,
    completedSegments: [...state.completedSegments, segmentId],
    currentSegmentIndex: state.currentSegmentIndex + 1,
    previousSegmentSummary: summary,
  };
  await saveState(updatedState);
  return updatedState;
}

/**
 * Clear state (for testing or reset)
 */
export async function clearState(): Promise<void> {
  try {
    await fs.unlink(STATE_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Create initial state for a new curriculum
 */
export function createInitialState(curriculumPath: string): State {
  return {
    curriculumPath,
    currentSegmentIndex: 0,
    completedSegments: [],
    totalMinutesSpent: 0,
    lastAccessedAt: new Date().toISOString(),
  };
}

// Progress file name - stored in project directory
const PROGRESS_FILE = ".tutor-progress.json";

/**
 * Load progress from project directory
 */
export async function loadProgress(projectDir: string): Promise<Progress | null> {
  try {
    const progressPath = path.join(projectDir, PROGRESS_FILE);
    const data = await fs.readFile(progressPath, "utf-8");
    const parsed = JSON.parse(data);
    
    // Check for version 1 (or missing version) and warn
    if (!parsed.version || parsed.version < 2) {
      console.warn('\n⚠️  Warning: Your progress file is using an old format (version 1).');
      console.warn('   Run "npx claude-tutor migrate-progress" to upgrade to version 2.');
      console.warn('   This format will be deprecated in a future release.\n');
      
      // Add version field for backwards compatibility
      parsed.version = parsed.version || 1;
    }
    
    return ProgressSchema.parse(parsed);
  } catch {
    return null;
  }
}

/**
 * Save progress to project directory
 */
export async function saveProgress(projectDir: string, progress: Progress): Promise<void> {
  const progressPath = path.join(projectDir, PROGRESS_FILE);
  progress.lastUpdatedAt = new Date().toISOString();
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
}

/**
 * Create initial progress for a segment
 */
export function createInitialProgress(segmentId: string, segmentIndex: number): Progress {
  return {
    version: 2,
    currentSegmentId: segmentId,
    currentSegmentIndex: segmentIndex,
    completedSteps: [],
    currentStep: undefined,
    lastTutorMessage: undefined,
    lastUserAction: undefined,
    codeWritten: false,
    syntaxVerified: false,
    codeReviewed: false,
    committed: false,
    currentGoldenStep: 0,
    totalGoldenSteps: 0,
    pendingPlanUpdate: undefined,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Update progress with a completed step
 */
export async function updateProgress(
  projectDir: string,
  updates: Partial<Progress>,
): Promise<Progress> {
  let progress = await loadProgress(projectDir);
  if (!progress) {
    throw new Error("No progress file found");
  }
  progress = { ...progress, ...updates };
  await saveProgress(projectDir, progress);
  return progress;
}

/**
 * Add a completed step to progress
 */
export async function addCompletedStep(
  projectDir: string,
  stepDescription: string,
): Promise<Progress> {
  const progress = await loadProgress(projectDir);
  if (!progress) {
    throw new Error("No progress file found");
  }
  progress.completedSteps.push(stepDescription);
  await saveProgress(projectDir, progress);
  return progress;
}
