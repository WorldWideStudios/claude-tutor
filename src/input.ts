import * as readline from 'readline';
import {
  setExpectedText,
  clearExpectedText,
  getExpectedText,
  displayTargetLine,
} from './display.js';
import chalk from 'chalk';

// Colors for typing feedback
const colors = {
  success: chalk.green,
  error: chalk.red,
  orange: chalk.hex('#F59E0B'),
  dim: chalk.gray,
  primary: chalk.hex('#10B981'),
};

/**
 * Result of extracting code from Claude's response
 */
export interface ExtractedCode {
  code: string;
  explanation: string | null;
}

/**
 * Extract code that user should type from Claude's response
 * Also extracts the explanation (usually in parentheses after the command)
 * Looks for patterns like:
 * - Single-line commands (mkdir, cat, git, etc.)
 * - Heredoc content between << 'EOF' and EOF
 */
export function extractExpectedCode(text: string): ExtractedCode | null {
  const lines = text.split('\n');

  // Look for heredoc pattern
  const heredocMatch = text.match(/cat\s+>\s+\S+\s+<<\s*['"]?EOF['"]?\n([\s\S]*?)\nEOF/);
  if (heredocMatch) {
    // Look for explanation in parentheses near the heredoc
    const heredocExplanation = findExplanationNear(text, heredocMatch.index || 0);
    return {
      code: heredocMatch[0],
      explanation: heredocExplanation || 'creates a file with the content between the markers'
    };
  }

  // Look for single commands on their own line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Match common commands
    if (/^(mkdir|cat|echo|touch|git|npm|npx|node|tsc)\s/.test(trimmed)) {
      // Look for explanation in the next line (usually in parentheses)
      let explanation: string | null = null;
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        // Check if next line is an explanation in parentheses
        const parenMatch = nextLine.match(/^\((.+)\)$/);
        if (parenMatch) {
          explanation = parenMatch[1];
        }
      }
      return { code: trimmed, explanation };
    }
  }

  return null;
}

/**
 * Find explanation text near a given position in the text
 */
function findExplanationNear(text: string, position: number): string | null {
  // Look for (explanation) pattern before or after the position
  const beforeText = text.substring(Math.max(0, position - 200), position);
  const afterText = text.substring(position, position + 200);

  // Check for explanation in parentheses
  const beforeMatch = beforeText.match(/\(([^)]{10,100})\)\s*$/);
  if (beforeMatch) return beforeMatch[1];

  const afterMatch = afterText.match(/^\s*\(([^)]{10,100})\)/);
  if (afterMatch) return afterMatch[1];

  return null;
}

/**
 * Read input with character-by-character tracking
 * Shows progress as user types, comparing to expected text
 */
export function createTrackedInput(
  rl: readline.Interface,
  expectedText: string | null,
  prompt: string = '› '
): Promise<string> {
  return new Promise((resolve) => {
    if (!expectedText || !process.stdin.isTTY) {
      // No tracking - use regular readline
      process.stdout.write(prompt);
      rl.once('line', (input) => {
        resolve(input);
      });
      return;
    }

    // Set up tracking
    setExpectedText(expectedText);

    // Display target line
    console.log();
    console.log(colors.dim('  Type this:'));

    // Build colored target display
    let targetDisplay = colors.dim('  ');
    for (let i = 0; i < expectedText.length; i++) {
      if (i === 0) {
        targetDisplay += colors.orange(expectedText[i]);
      } else {
        targetDisplay += colors.dim(expectedText[i]);
      }
    }
    console.log(targetDisplay);
    console.log();

    // Current input buffer
    let inputBuffer = '';

    // Store original line position for redrawing
    const targetLineOffset = 2; // Lines above input prompt

    // Display input prompt
    process.stdout.write(colors.primary(prompt));

    // Handle line input
    rl.once('line', (input) => {
      inputBuffer = input;

      // Show final result
      const isCorrect = input === expectedText;
      if (isCorrect) {
        console.log(colors.success('✓ Correct!'));
      } else if (input.length > 0) {
        // Show what was different
        const accuracy = calculateAccuracy(input, expectedText);
        if (accuracy >= 90) {
          console.log(colors.dim(`Close! ${accuracy}% accurate`));
        }
      }

      clearExpectedText();
      resolve(input);
    });
  });
}

/**
 * Calculate typing accuracy percentage
 */
function calculateAccuracy(input: string, expected: string): number {
  if (!expected || input.length === 0) return 0;

  let correct = 0;
  const checkLength = Math.min(input.length, expected.length);

  for (let i = 0; i < checkLength; i++) {
    if (input[i] === expected[i]) {
      correct++;
    }
  }

  return Math.round((correct / expected.length) * 100);
}

/**
 * Parse Claude's response to find code blocks and track them
 */
export function shouldTrackInput(claudeResponse: string): ExtractedCode | null {
  // Extract the last code/command Claude showed
  return extractExpectedCode(claudeResponse);
}
