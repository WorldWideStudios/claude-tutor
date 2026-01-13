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
 * Generate explanation for a command based on its structure
 */
function generateExplanation(command: string): string | null {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case 'mkdir':
      if (parts.includes('-p')) {
        return `mkdir = make directory, -p = create parent directories if needed, ${parts[parts.length - 1]} = folder name`;
      }
      return `mkdir = make directory, ${parts[parts.length - 1]} = folder name`;

    case 'cat':
      if (command.includes('<<')) {
        const fileMatch = command.match(/>\s*(\S+)/);
        const file = fileMatch ? fileMatch[1] : 'file';
        return `creates ${file} with the content you type until EOF`;
      }
      return `cat = display file contents`;

    case 'touch':
      return `touch = create empty file or update timestamp`;

    case 'git':
      const gitCmd = parts[1];
      switch (gitCmd) {
        case 'init': return 'initializes a new git repository';
        case 'add': return parts[2] === '.' ? 'stages all changes for commit' : `stages ${parts[2]} for commit`;
        case 'commit': return 'saves staged changes with a message';
        case 'status': return 'shows current state of working directory';
        case 'log': return 'shows commit history';
        case 'diff': return 'shows changes not yet staged';
        case 'push': return 'uploads commits to remote repository';
        case 'pull': return 'downloads and integrates remote changes';
        default: return `git ${gitCmd} command`;
      }

    case 'npm':
      const npmCmd = parts[1];
      switch (npmCmd) {
        case 'init': return 'creates package.json for your project';
        case 'install': return parts.length > 2 ? `installs ${parts[2]} package` : 'installs all dependencies';
        case 'run': return `runs the "${parts[2]}" script from package.json`;
        case 'test': return 'runs your test suite';
        default: return `npm ${npmCmd} command`;
      }

    case 'npx':
      return `npx = run ${parts[1]} without installing globally`;

    case 'node':
      return `runs ${parts[1]} with Node.js`;

    case 'tsc':
      return 'compiles TypeScript to JavaScript';

    case 'echo':
      return 'prints text to the terminal';

    default:
      return null;
  }
}

/**
 * Extract code that user should type from Claude's response
 * Generates explanations for common commands
 * Looks for patterns like:
 * - Single-line commands (mkdir, cat, git, etc.)
 * - Heredoc content between << 'EOF' and EOF
 */
export function extractExpectedCode(text: string): ExtractedCode | null {
  const lines = text.split('\n');

  // Look for heredoc pattern
  const heredocMatch = text.match(/cat\s+>\s+\S+\s+<<\s*['"]?EOF['"]?\n([\s\S]*?)\nEOF/);
  if (heredocMatch) {
    const fileMatch = heredocMatch[0].match(/>\s*(\S+)/);
    const file = fileMatch ? fileMatch[1] : 'file';
    return {
      code: heredocMatch[0],
      explanation: `creates ${file} with the content between the markers`
    };
  }

  // Look for single commands on their own line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Match common commands
    if (/^(mkdir|cat|echo|touch|git|npm|npx|node|tsc)\s/.test(trimmed)) {
      return {
        code: trimmed,
        explanation: generateExplanation(trimmed)
      };
    }
  }

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
