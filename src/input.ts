import * as readline from 'readline';
import {
  setExpectedText,
  clearExpectedText,
  getExpectedText,
  displayTargetLine,
  initTyperSharkDisplay,
  redrawTyperShark,
  initMultiLineTyperShark,
  redrawMultiLineTyperShark,
  finishTyperSharkDisplay,
  clearForTyperShark,
} from './display.js';
import chalk from 'chalk';

// Colors for typing feedback
const colors = {
  success: chalk.green,
  error: chalk.red,
  orange: chalk.hex('#F59E0B'),
  dim: chalk.gray,
  primary: chalk.hex('#10B981'),
  tan: chalk.hex('#D4A574'),
};

/**
 * Interactive select with arrow keys
 * Shows options, user navigates with arrows, Enter to select
 * Last option is always "Other" to type custom value
 */
export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

export function createInteractiveSelect(
  rl: readline.Interface,
  question: string,
  options: SelectOption[]
): Promise<string> {
  return new Promise((resolve) => {
    // Non-TTY fallback
    if (!process.stdin.isTTY) {
      console.log(question);
      options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt.label}`));
      console.log(`  ${options.length + 1}. Other (type your own)`);
      process.stdout.write(colors.primary('› '));
      rl.once('line', (input) => {
        const num = parseInt(input.trim());
        if (num > 0 && num <= options.length) {
          resolve(options[num - 1].value);
        } else {
          resolve(input.trim());
        }
      });
      return;
    }

    // Add "Other" option
    const allOptions = [...options, { label: 'Other (type your own)', value: '__OTHER__' }];
    let selectedIndex = 0;
    let isTypingCustom = false;
    let customInput = '';

    const drawOptions = () => {
      // Clear previous lines and redraw
      const totalLines = allOptions.length + 2; // question + options + blank
      process.stdout.write(`\x1B[${totalLines}A`); // Move up

      console.log(colors.primary(question));
      allOptions.forEach((opt, i) => {
        process.stdout.write('\r\x1B[K'); // Clear line
        if (i === selectedIndex) {
          process.stdout.write(colors.primary('  › ') + colors.primary(opt.label));
          if (opt.description) {
            process.stdout.write(colors.dim(` - ${opt.description}`));
          }
        } else {
          process.stdout.write(colors.dim('    ' + opt.label));
        }
        console.log();
      });
      process.stdout.write('\r\x1B[K'); // Clear the line after options
    };

    const drawCustomInput = () => {
      process.stdout.write('\r\x1B[K');
      process.stdout.write(colors.primary('› ') + customInput);
    };

    // Initial draw
    console.log(colors.primary(question));
    allOptions.forEach((opt, i) => {
      if (i === selectedIndex) {
        process.stdout.write(colors.primary('  › ') + colors.primary(opt.label));
        if (opt.description) {
          process.stdout.write(colors.dim(` - ${opt.description}`));
        }
      } else {
        process.stdout.write(colors.dim('    ' + opt.label));
      }
      console.log();
    });
    console.log(); // Blank line for input area

    // Enable raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handleKeypress);
    };

    const handleKeypress = (chunk: Buffer) => {
      const key = chunk.toString();

      // Ctrl+C - exit
      if (key === '\x03') {
        cleanup();
        console.log('\n');
        process.exit(0);
      }

      if (isTypingCustom) {
        // Custom input mode
        if (key === '\r' || key === '\n') {
          // Submit custom input
          cleanup();
          console.log();
          resolve(customInput || options[0]?.value || '');
          return;
        }
        if (key === '\x7f' || key === '\b') {
          // Backspace
          customInput = customInput.slice(0, -1);
          drawCustomInput();
          return;
        }
        if (key === '\x1b') {
          // Escape - go back to selection
          isTypingCustom = false;
          customInput = '';
          drawOptions();
          return;
        }
        if (key.length === 1 && key >= ' ') {
          customInput += key;
          drawCustomInput();
        }
        return;
      }

      // Selection mode
      if (key === '\x1b[A' || key === '\x1bOA') {
        // Up arrow
        selectedIndex = (selectedIndex - 1 + allOptions.length) % allOptions.length;
        drawOptions();
      } else if (key === '\x1b[B' || key === '\x1bOB') {
        // Down arrow
        selectedIndex = (selectedIndex + 1) % allOptions.length;
        drawOptions();
      } else if (key === '\r' || key === '\n') {
        // Enter - select
        if (allOptions[selectedIndex].value === '__OTHER__') {
          // Switch to custom input mode
          isTypingCustom = true;
          process.stdout.write('\r\x1B[K');
          process.stdout.write(colors.dim('  Type your answer (Esc to go back):'));
          console.log();
          drawCustomInput();
        } else {
          cleanup();
          console.log();
          resolve(allOptions[selectedIndex].value);
        }
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}

/**
 * A single line of code with its comment
 */
export interface CodeLine {
  comment: string;  // The // comment explaining this line
  code: string;     // The actual code to type
}

/**
 * Result of extracting code from Claude's response
 */
export interface ExtractedCode {
  code: string;              // For single-line commands
  explanation: string | null;
  isMultiLine: boolean;      // True for heredocs with interleaved comments
  lines?: CodeLine[];        // Array of comment+code pairs for heredocs
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
 * - Interleaved heredoc format (// comment + code line pairs)
 * - Code blocks with backticks
 * - Any line that looks like an executable command
 */
export function extractExpectedCode(text: string): ExtractedCode | null {
  const lines = text.split('\n');

  // Look for interleaved heredoc format:
  // // comment
  // cat > file << 'EOF'
  // // comment
  // code line
  // ...
  // // comment
  // EOF
  const interleavedLines: CodeLine[] = [];
  let inInterleavedBlock = false;
  let currentComment = '';
  let foundHeredocStart = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for // comment line
    if (trimmed.startsWith('//')) {
      currentComment = trimmed.slice(2).trim();
      // Look ahead - if next line is code, we're in an interleaved block
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && !nextLine.startsWith('//')) {
        inInterleavedBlock = true;
      }
      continue;
    }

    // If we have a pending comment, pair it with this code line
    if (inInterleavedBlock && currentComment) {
      // Check if this is a heredoc start
      if (/^cat\s+>\s+\S+\s+<<\s*['"]?EOF['"]?$/.test(trimmed)) {
        foundHeredocStart = true;
      }

      interleavedLines.push({
        comment: currentComment,
        code: trimmed
      });
      currentComment = '';

      // Check if this is EOF (end of heredoc)
      if (trimmed === 'EOF' && foundHeredocStart) {
        // We found a complete interleaved heredoc block
        const fileMatch = interleavedLines[0]?.code.match(/>\s*(\S+)/);
        const file = fileMatch ? fileMatch[1] : 'file';
        return {
          code: interleavedLines.map(l => l.code).join('\n'),
          explanation: `creates ${file}`,
          isMultiLine: true,
          lines: interleavedLines
        };
      }
    }
  }

  // If we found an interleaved block but no EOF (partial match), still return it
  if (interleavedLines.length > 0 && foundHeredocStart) {
    const fileMatch = interleavedLines[0]?.code.match(/>\s*(\S+)/);
    const file = fileMatch ? fileMatch[1] : 'file';
    return {
      code: interleavedLines.map(l => l.code).join('\n'),
      explanation: `creates ${file}`,
      isMultiLine: true,
      lines: interleavedLines
    };
  }

  // Look for code blocks with backticks (```command``` or `command`)
  const codeBlockMatch = text.match(/```(?:bash|sh|shell|typescript|ts|javascript|js)?\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    const codeContent = codeBlockMatch[1].trim();
    // If it's a single line, treat as single command
    if (!codeContent.includes('\n')) {
      return {
        code: codeContent,
        explanation: generateExplanation(codeContent),
        isMultiLine: false
      };
    }
  }

  // Look for inline code with single backticks
  const inlineCodeMatch = text.match(/`([^`\n]+)`/);
  if (inlineCodeMatch) {
    const code = inlineCodeMatch[1].trim();
    // Only use if it looks like a command
    if (/^(mkdir|cat|echo|touch|git|npm|npx|node|tsc|cd|ls|pwd|chmod|rm|mv|cp)\s/.test(code)) {
      return {
        code: code,
        explanation: generateExplanation(code),
        isMultiLine: false
      };
    }
  }

  // Fall back to looking for single commands on their own line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Match common commands (not preceded by //)
    if (/^(mkdir|cat|echo|touch|git|npm|npx|node|tsc|cd|ls|pwd|chmod|rm|mv|cp)\s/.test(trimmed)) {
      // Check if previous line was a // comment
      const prevLine = lines[i - 1]?.trim();
      const explanation = prevLine?.startsWith('//')
        ? prevLine.slice(2).trim()
        : generateExplanation(trimmed);

      return {
        code: trimmed,
        explanation,
        isMultiLine: false
      };
    }
  }

  // Last resort: look for any line that looks like it should be typed
  // This catches things like variable assignments, function calls, etc.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines, comments, and prose
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // Look for lines that look like code (contains = or starts with common patterns)
    if (trimmed.includes('=') || /^(const|let|var|function|import|export|class|type|interface)\s/.test(trimmed)) {
      const prevLine = lines[i - 1]?.trim();
      const explanation = prevLine?.startsWith('//')
        ? prevLine.slice(2).trim()
        : 'type this code';

      return {
        code: trimmed,
        explanation,
        isMultiLine: false
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

// ============================================
// TYPER SHARK - REAL-TIME CHARACTER INPUT
// ============================================

/**
 * Create Typer Shark style input with real-time character feedback
 * - Shows target in yellow, turns green as correctly typed
 * - Wrong keys don't advance (character stays yellow)
 * - Supports backspace to correct mistakes
 */
export function createTyperSharkInput(
  rl: readline.Interface,
  expectedText: string,
  explanation: string | null
): Promise<string> {
  return new Promise((resolve) => {
    // Non-TTY fallback to regular input
    if (!process.stdin.isTTY) {
      console.log(colors.dim(`  Type: ${expectedText}`));
      process.stdout.write(colors.primary('› '));
      rl.once('line', resolve);
      return;
    }

    // Initialize display
    initTyperSharkDisplay(expectedText, explanation || undefined);

    let inputBuffer = '';
    let correctCount = 0;

    // Enable raw mode for character-by-character input
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handleKeypress = (chunk: Buffer) => {
      const key = chunk.toString();

      // Ctrl+C - exit
      if (key === '\x03') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handleKeypress);
        console.log('\n');
        process.exit(0);
      }

      // Enter - submit input
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handleKeypress);
        console.log(); // New line after input
        finishTyperSharkDisplay(); // Draw bottom gray line
        resolve(inputBuffer);
        return;
      }

      // Backspace - remove last character
      if (key === '\x7f' || key === '\b') {
        if (inputBuffer.length > 0) {
          // If deleting a correct character, decrease correctCount
          if (correctCount > 0 && correctCount === inputBuffer.length) {
            correctCount--;
          }
          inputBuffer = inputBuffer.slice(0, -1);
          redrawTyperShark(expectedText, inputBuffer, correctCount);
        }
        return;
      }

      // Escape - cancel (optional, could also just ignore)
      if (key === '\x1b') {
        // Ignore escape or handle as needed
        return;
      }

      // Regular character
      if (key.length === 1 && key >= ' ') {
        inputBuffer += key;

        // Only increment correctCount if:
        // 1. We're typing at the next sequential position (no gaps from mistakes)
        // 2. The character matches the expected character
        // This forces user to backspace and fix mistakes before progressing
        const newCharPos = inputBuffer.length - 1;
        if (newCharPos === correctCount && correctCount < expectedText.length && key === expectedText[correctCount]) {
          correctCount++;
        }

        redrawTyperShark(expectedText, inputBuffer, correctCount);
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}

/**
 * Create multi-line Typer Shark input for heredocs
 * Tracks through each line one at a time, showing progress
 */
export function createMultiLineTyperSharkInput(
  rl: readline.Interface,
  lines: CodeLine[]
): Promise<string[]> {
  return new Promise((resolve) => {
    // Non-TTY fallback
    if (!process.stdin.isTTY) {
      console.log(colors.dim('  Multi-line input:'));
      lines.forEach(l => console.log(colors.dim(`    ${l.code}`)));
      // Collect all lines via regular readline
      const results: string[] = [];
      const collectLine = (index: number) => {
        if (index >= lines.length) {
          resolve(results);
          return;
        }
        process.stdout.write(colors.primary('› '));
        rl.once('line', (input) => {
          results.push(input);
          collectLine(index + 1);
        });
      };
      collectLine(0);
      return;
    }

    // Calculate lines to clear: the raw code was streamed before this
    // Each line pair = 2 lines (comment + code), plus extra for the heredoc command output
    // We clear more than needed to ensure no duplication
    const linesToClear = lines.length * 2 + 5;

    // Initialize display with all lines, clearing the raw streamed code
    initMultiLineTyperShark(lines, 0, linesToClear);

    let currentLineIndex = 0;
    let inputBuffer = '';
    let correctCount = 0;
    const completedLines: string[] = [];

    // Enable raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handleKeypress = (chunk: Buffer) => {
      const key = chunk.toString();
      const currentLine = lines[currentLineIndex];
      const expectedCode = currentLine.code;

      // Ctrl+C - exit
      if (key === '\x03') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', handleKeypress);
        console.log('\n');
        process.exit(0);
      }

      // Enter - submit current line
      if (key === '\r' || key === '\n') {
        // Save the completed line
        completedLines.push(inputBuffer);

        // Move to next line
        currentLineIndex++;
        inputBuffer = '';
        correctCount = 0;

        // Check if we're done with all lines
        if (currentLineIndex >= lines.length) {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', handleKeypress);
          console.log(); // New line after final input
          finishTyperSharkDisplay(); // Draw bottom gray line
          console.log(colors.success('✓ All lines entered!'));
          resolve(completedLines);
          return;
        }

        // Redraw with new current line highlighted
        redrawMultiLineTyperShark(lines, currentLineIndex, inputBuffer, correctCount);
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (inputBuffer.length > 0) {
          if (correctCount > 0 && correctCount === inputBuffer.length) {
            correctCount--;
          }
          inputBuffer = inputBuffer.slice(0, -1);
          redrawMultiLineTyperShark(lines, currentLineIndex, inputBuffer, correctCount);
        }
        return;
      }

      // Escape - ignore
      if (key === '\x1b') {
        return;
      }

      // Regular character
      if (key.length === 1 && key >= ' ') {
        inputBuffer += key;

        // Only increment correctCount if:
        // 1. We're typing at the next sequential position (no gaps from mistakes)
        // 2. The character matches the expected character
        // This forces user to backspace and fix mistakes before progressing
        const newCharPos = inputBuffer.length - 1;
        if (newCharPos === correctCount && correctCount < expectedCode.length && key === expectedCode[correctCount]) {
          correctCount++;
        }

        redrawMultiLineTyperShark(lines, currentLineIndex, inputBuffer, correctCount);
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}
