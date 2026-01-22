/**
 * Mode Management Module
 * Handles the three tutor interaction modes:
 * - tutor: Line-by-line Typer Shark guided typing
 * - block: Free-form code typing without character tracking
 * - discuss: Natural language discussion mode
 */

import type { TutorMode } from './types.js';
import { TUTOR_MODES } from './types.js';

// Current mode state (module-level singleton)
let currentMode: TutorMode = 'tutor';

/**
 * Get the current tutor mode
 */
export function getMode(): TutorMode {
  return currentMode;
}

/**
 * Set the tutor mode
 */
export function setMode(mode: TutorMode): void {
  currentMode = mode;
}

/**
 * Cycle to the next mode (tutor -> block -> discuss -> tutor)
 * Returns the new mode
 */
export function cycleMode(): TutorMode {
  const currentIndex = TUTOR_MODES.findIndex(m => m.mode === currentMode);
  const nextIndex = (currentIndex + 1) % TUTOR_MODES.length;
  currentMode = TUTOR_MODES[nextIndex].mode;
  return currentMode;
}

/**
 * Get mode info (label and description)
 */
export function getModeInfo(mode?: TutorMode): { mode: TutorMode; label: string; description: string } {
  const m = mode || currentMode;
  return TUTOR_MODES.find(info => info.mode === m) || TUTOR_MODES[0];
}

/**
 * Check if current mode is tutor (line-by-line tracking)
 */
export function isTutorMode(): boolean {
  return currentMode === 'tutor';
}

/**
 * Check if current mode is block (free typing)
 */
export function isBlockMode(): boolean {
  return currentMode === 'block';
}

/**
 * Check if current mode is discuss (natural language)
 */
export function isDiscussMode(): boolean {
  return currentMode === 'discuss';
}
