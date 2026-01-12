import * as fs from 'fs/promises';
import * as path from 'path';
import { State, StateSchema, Curriculum, CurriculumSchema } from './types.js';

// Storage directory: ~/.claude-tutor/
const DATA_DIR = path.join(process.env.HOME || '~', '.claude-tutor');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

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
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    return StateSchema.parse(JSON.parse(data));
  } catch {
    // Return default state if file doesn't exist or is invalid
    return {
      curriculumPath: null,
      currentSegmentIndex: 0,
      completedSegments: [],
      totalMinutesSpent: 0,
      lastAccessedAt: new Date().toISOString()
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
 * Load a curriculum by path
 */
export async function loadCurriculum(curriculumPath: string): Promise<Curriculum | null> {
  try {
    const data = await fs.readFile(curriculumPath, 'utf-8');
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
 * Update state to mark a segment as complete
 */
export async function markSegmentComplete(
  state: State,
  segmentId: string,
  summary: string
): Promise<State> {
  const updatedState: State = {
    ...state,
    completedSegments: [...state.completedSegments, segmentId],
    currentSegmentIndex: state.currentSegmentIndex + 1,
    previousSegmentSummary: summary
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
    lastAccessedAt: new Date().toISOString()
  };
}
