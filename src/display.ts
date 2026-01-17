import chalk from 'chalk';
import type { Curriculum, TutorState, Segment } from './types.js';

/**
 * CLI Display Module - Enhanced UX
 */

// Check if colors should be disabled
const noColor = process.env.NO_COLOR !== undefined ||
                process.env.TERM === 'dumb' ||
                !process.stdout.isTTY;

// Color palette
const colors = {
  primary: noColor ? chalk.reset : chalk.hex('#10B981'),
  primaryDim: noColor ? chalk.reset : chalk.hex('#059669'),
  success: noColor ? chalk.reset : chalk.green,
  error: noColor ? chalk.reset : chalk.red,
  warning: noColor ? chalk.reset : chalk.yellow,
  orange: noColor ? chalk.reset : chalk.hex('#F59E0B'),
  tan: noColor ? chalk.reset : chalk.hex('#D4A574'),  // Light tan for Typer Shark untyped
  text: noColor ? chalk.reset : chalk.white,
  dim: noColor ? chalk.reset : chalk.gray,
  muted: noColor ? chalk.reset : chalk.dim,
};

// Symbols
const symbols = {
  success: '✓',
  error: '✗',
  arrow: '›',
  bullet: '○',
  branch: '├─',
  branchEnd: '└─',
  branchContinue: '⎿',
  vertical: '│',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

// Loading state
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let wordInterval: ReturnType<typeof setInterval> | null = null;
let spinnerIndex = 0;
let wordIndex = 0;
let isLoading = false;
let agentRunning = false;
let currentStatus: string | null = null;

// Fun loading words - only advance when something actually happens
const funWords = [
  'Wizarding', 'Booping', 'Noodling', 'Vibing', 'Schlepping',
  'Clauding', 'Scaffolding', 'Stacking', 'Coalescing', 'Brewing',
  'Conjuring', 'Pondering', 'Manifesting', 'Assembling', 'Crafting'
];

// Character tracking state
let expectedText: string | null = null;
let typedProgress = 0;

/**
 * Clear terminal screen
 */
export function clearScreen(): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1Bc');
  }
}

/**
 * Get terminal width
 */
function getWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Draw a horizontal bar
 */
export function drawBar(): string {
  return colors.muted('─'.repeat(getWidth()));
}

/**
 * Display welcome with title box
 */
export function displayWelcome(): void {
  clearScreen();
  console.log();
  console.log(colors.primary('  ╭───────────────────────────────────╮'));
  console.log(colors.primary('  │') + colors.text('     🐢 Claude Code Tutor          ') + colors.primary('│'));
  console.log(colors.primary('  │') + colors.dim('   Learn to code like an engineer  ') + colors.primary('│'));
  console.log(colors.primary('  ╰───────────────────────────────────╯'));
  console.log();
}

/**
 * Start loading animation with fun words
 * Words cycle every 3-5 seconds
 * Shows gray bars above and below to create entry field look
 */
export function startLoading(): void {
  if (isLoading) {
    stopLoading();
  }

  isLoading = true;
  agentRunning = true;
  spinnerIndex = 0;
  // Randomize starting word for variety
  wordIndex = Math.floor(Math.random() * funWords.length);

  if (!process.stdout.isTTY) {
    console.log(colors.dim(`${funWords[wordIndex]}...`));
    return;
  }

  // Draw the entry field structure: top bar, spinner line, bottom bar, blank line
  console.log(drawBar()); // Top gray bar
  process.stdout.write(`  ${colors.dim(funWords[wordIndex] + '...')}`); // Initial spinner line (indented)
  console.log(); // End spinner line
  console.log(drawBar()); // Bottom gray bar
  console.log(); // Blank line below for spacing

  // Move cursor back up to spinner line (4 lines up: blank, bottom bar, spinner, top bar -> land on spinner)
  process.stdout.write('\x1B[3A'); // Move up 3 lines to spinner line

  // Smooth spinner animation
  spinnerInterval = setInterval(() => {
    if (!isLoading) {
      if (spinnerInterval) clearInterval(spinnerInterval);
      return;
    }

    const frame = symbols.spinner[spinnerIndex % symbols.spinner.length];
    // Use currentStatus if set, otherwise show current fun word
    const displayText = currentStatus || funWords[wordIndex % funWords.length];

    process.stdout.write(`\r${colors.primaryDim(frame)} ${colors.dim(displayText + '...')}    `);

    spinnerIndex++;
  }, 100);

  // Cycle words every 3-5 seconds
  const scheduleNextWord = () => {
    const delay = 3000 + Math.random() * 2000; // 3-5 seconds
    wordInterval = setTimeout(() => {
      if (isLoading && !currentStatus) {
        wordIndex = (wordIndex + 1) % funWords.length;
      }
      if (isLoading) {
        scheduleNextWord();
      }
    }, delay);
  };
  scheduleNextWord();
}

/**
 * Advance to the next fun loading word
 * Call this when something happens (output prints, step completes, etc.)
 */
export function advanceLoadingWord(): void {
  if (isLoading && !currentStatus) {
    wordIndex = (wordIndex + 1) % funWords.length;
  }
}

/**
 * Stop loading animation
 * Clears the entry field structure and positions cursor for next output
 */
export function stopLoading(): void {
  isLoading = false;
  agentRunning = false;
  currentStatus = null;
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
  if (wordInterval) {
    clearTimeout(wordInterval);
    wordInterval = null;
  }
  if (process.stdout.isTTY) {
    // Cursor is on spinner line - move up to top bar and clear all 4 lines
    process.stdout.write('\x1B[1A'); // Move up to top bar
    process.stdout.write('\r\x1B[K'); // Clear top bar
    process.stdout.write('\x1B[1B\r\x1B[K'); // Move down, clear spinner line
    process.stdout.write('\x1B[1B\r\x1B[K'); // Move down, clear bottom bar
    process.stdout.write('\x1B[1B\r\x1B[K'); // Move down, clear blank line
    process.stdout.write('\x1B[4A'); // Move back up 4 lines to where top bar was
  }
}

/**
 * Update the loading status text (e.g., "Verifying syntax...")
 * This updates the spinner line with what's actually happening
 */
export function updateLoadingStatus(status: string): void {
  currentStatus = status;
  // The spinner interval will pick this up on next frame
}

/**
 * Display a tool status line (used when a tool starts/ends)
 */
export function displayToolStatus(toolName: string, status: 'start' | 'end'): void {
  if (!process.stdout.isTTY) {
    if (status === 'start') {
      console.log(colors.dim(`  ${symbols.arrow} ${toolName}...`));
    }
    return;
  }

  if (status === 'start') {
    // Update the loading spinner to show the tool name
    currentStatus = toolName;
  } else {
    // Tool finished - show checkmark briefly then clear
    process.stdout.write('\r\x1B[K');
    process.stdout.write(`${colors.success(symbols.success)} ${colors.dim(toolName)}\n`);
    currentStatus = null;
  }
}

/**
 * Check if loading is active
 */
export function isLoadingActive(): boolean {
  return isLoading;
}

/**
 * Set agent running state (for ESC hint visibility)
 */
export function setAgentRunning(running: boolean): void {
  agentRunning = running;
}

/**
 * Check if agent is running
 */
export function isAgentRunning(): boolean {
  return agentRunning;
}

/**
 * Display status message (streaming what's happening)
 */
export function displayStatus(message: string): void {
  console.log(colors.dim(`${symbols.arrow} ${message}`));
}

/**
 * Display a planning/working step (like Claude Code does)
 * Shows what the system is currently doing
 */
export function displayStep(step: string): void {
  // Clear the current line (in case spinner is showing)
  if (process.stdout.isTTY) {
    process.stdout.write('\r\x1B[K');
  }
  console.log(colors.dim(`  ${symbols.bullet} ${step}`));
}

/**
 * Display planning steps in sequence with the spinner
 */
let planningSteps: string[] = [];
let currentStepIndex = 0;
let planningInterval: ReturnType<typeof setInterval> | null = null;

export function startPlanningWithSteps(steps: string[]): void {
  planningSteps = steps;
  currentStepIndex = 0;

  if (!process.stdout.isTTY) {
    // Non-TTY: just print all steps
    steps.forEach(step => console.log(colors.dim(`  ${symbols.bullet} ${step}`)));
    return;
  }

  // Show first step immediately
  console.log(colors.dim(`  ${symbols.bullet} ${planningSteps[0]}`));

  // Cycle through steps
  planningInterval = setInterval(() => {
    currentStepIndex++;
    if (currentStepIndex < planningSteps.length) {
      console.log(colors.dim(`  ${symbols.bullet} ${planningSteps[currentStepIndex]}`));
    } else {
      // Done with steps
      if (planningInterval) {
        clearInterval(planningInterval);
        planningInterval = null;
      }
    }
  }, 1500); // Show new step every 1.5 seconds
}

export function stopPlanningSteps(): void {
  if (planningInterval) {
    clearInterval(planningInterval);
    planningInterval = null;
  }
}

/**
 * Display executed command with result
 */
export function displayCommand(command: string, success: boolean): void {
  const icon = success ? colors.success(symbols.success) : colors.error(symbols.error);
  console.log(`${icon} ${colors.dim(command)}`);
}

/**
 * Display command output
 */
export function displayCommandOutput(output: string): void {
  if (output && output.trim()) {
    const lines = output.trim().split('\n');
    lines.forEach(line => {
      console.log(colors.muted(`  ${line}`));
    });
  }
}

/**
 * Display segment header with progress
 */
export function displaySegmentHeader(
  curriculum: Curriculum,
  segment: Segment,
  segmentIndex: number
): void {
  const current = segmentIndex + 1;
  const total = curriculum.segments.length;

  console.log();
  console.log(colors.dim(`[${current}/${total}]`) + ' ' + colors.text(segment.title));

  // Visual progress bar
  const filled = Math.round((current / total) * 20);
  const empty = 20 - filled;
  const bar = colors.primary('━'.repeat(filled)) + colors.muted('─'.repeat(empty));
  console.log(bar);
  console.log();
}

/**
 * Display resume message
 */
export function displayResume(curriculum: Curriculum, state: TutorState): void {
  console.log();
  console.log(colors.text('Welcome back'));
  console.log(colors.dim(`${curriculum.projectName} • ${state.currentSegmentIndex}/${curriculum.segments.length} complete`));
  console.log();
}

/**
 * Streaming text display state
 */
let isFirstChunk = true;

/**
 * Display tutor response (streaming)
 */
export function displayTutorText(text: string): void {
  if (isFirstChunk) {
    process.stdout.write(colors.dim(symbols.bullet + ' '));
    isFirstChunk = false;
  }
  process.stdout.write(text);
}

/**
 * Reset streaming state
 */
export function resetStreamState(): void {
  isFirstChunk = true;
  console.log();
}

/**
 * Display user message
 */
export function displayUserMessage(_message: string): void {
  // Don't echo - terminal shows input
}

/**
 * Display branch-down explanation (gray explainer text)
 */
export function displayExplanation(lines: string[]): void {
  lines.forEach((line, i) => {
    const branch = i === lines.length - 1 ? symbols.branchEnd : symbols.branch;
    console.log(colors.dim(`  ${branch} ${line}`));
  });
}

/**
 * Display a code block with explanation
 */
export function displayCodeWithExplanation(code: string, explanations: string[]): void {
  console.log();
  console.log(colors.text(code));
  if (explanations.length > 0) {
    displayExplanation(explanations);
  }
  console.log();
}

/**
 * Display a code block with line-by-line explanations
 * Each line of code is shown in green with its explanation in gray below
 */
export function displayCodeBlockWithLineExplanations(
  lines: Array<{ code: string; explanation: string }>
): void {
  console.log();
  lines.forEach((line, index) => {
    // Code line in green
    console.log('  ' + colors.primary(line.code));
    // Explanation in gray with branch symbol
    const isLast = index === lines.length - 1;
    const branchSymbol = isLast ? symbols.branchEnd : symbols.branchContinue;
    console.log(colors.dim(`  ${branchSymbol}  ${line.explanation}`));
  });
  console.log();
}

/**
 * Display a heredoc/multi-line code block with block explanations
 * Shows the full code block in green, then explanations for each section
 */
export function displayHeredocWithExplanations(
  header: string,
  codeLines: string[],
  footer: string,
  blockExplanations: Array<{ section: string; explanation: string }>
): void {
  console.log();
  // Header (e.g., cat > src/index.ts << 'EOF') in green
  console.log('  ' + colors.primary(header));

  // Code content in green
  codeLines.forEach(line => {
    console.log('  ' + colors.primary(line));
  });

  // Footer (EOF) in green
  console.log('  ' + colors.primary(footer));

  // Block explanations in gray
  console.log();
  blockExplanations.forEach((block, index) => {
    const isLast = index === blockExplanations.length - 1;
    const branchSymbol = isLast ? symbols.branchEnd : symbols.branchContinue;
    console.log(colors.dim(`  ${branchSymbol}  ${block.section}: ${block.explanation}`));
  });
  console.log();
}

/**
 * Display segment completion
 */
export function displaySegmentComplete(summary: string, nextSegmentTitle?: string): void {
  console.log();
  console.log(colors.success(symbols.success) + ' ' + colors.text('Segment complete'));
  console.log(colors.dim(summary));
  if (nextSegmentTitle) {
    console.log();
    console.log(colors.dim('Next: ' + nextSegmentTitle));
  }
}

/**
 * Display curriculum completion
 */
export function displayCurriculumComplete(curriculum: Curriculum): void {
  console.log();
  console.log(colors.success(symbols.success) + ' ' + colors.text('Course complete'));
  console.log(colors.dim(`Finished: ${curriculum.projectName}`));
  console.log(colors.dim(`Segments: ${curriculum.segments.length}`));
  console.log();
  console.log(colors.dim('Your code is saved with git. Run "git log" to see progress.'));
  console.log();
}

/**
 * Display error message
 */
export function displayError(message: string): void {
  console.error(colors.error(symbols.error + ' ' + message));
}

/**
 * Display info message
 */
export function displayInfo(message: string): void {
  console.log(colors.dim(message));
}

/**
 * Display input prompt with top/bottom bars
 * Creates an entry field look with gray lines above and below the input area
 */
export function displayPrompt(): void {
  console.log();
  // Top bar - creates upper border of entry field
  console.log(drawBar());

  // Input prompt
  process.stdout.write(colors.primary(symbols.arrow + ' '));
}

/**
 * Draw the bottom bar after input is complete
 * This should be called after getting input to close the entry field
 * Includes blank line below for future helper text and to lift entry area from bottom
 */
export function displayBottomBar(): void {
  console.log(drawBar());
  console.log(); // Blank line below for future helper text
}

/**
 * Display prompt without the hint (cleaner for heredoc continuation)
 */
export function displayContinuationPrompt(): void {
  process.stdout.write(colors.dim('> '));
}

/**
 * Display helper text
 */
export function displayHelperText(): void {
  console.log(colors.muted('esc to stop'));
}

/**
 * Display question prompt for setup with full-width lines
 */
export function displayQuestionPrompt(question: string): void {
  console.log(drawBar());
  console.log(colors.text(question));
  console.log(drawBar());
  process.stdout.write(colors.primary(symbols.arrow + ' '));
}

/**
 * Close the question prompt after user enters their answer
 * Clears the entry box and shows the Q&A in the log
 */
export function closeQuestionPrompt(question: string, answer: string): void {
  if (!process.stdout.isTTY) return;

  // Move cursor up to clear the entry box (4 lines: top bar, question, bottom bar, prompt with answer)
  process.stdout.write('\x1B[4A');

  // Clear and redraw as clean log entry
  process.stdout.write('\r\x1B[K');
  console.log(colors.dim(question));
  process.stdout.write('\r\x1B[K');
  console.log(colors.primary(symbols.arrow + ' ') + answer);
  process.stdout.write('\r\x1B[K');
  console.log(); // Blank line
  process.stdout.write('\r\x1B[K');
  // Don't print anything on last line - ready for next output
}

/**
 * Display preflight error
 */
export function displayPreflightError(error: string): void {
  console.error();
  console.error(colors.error(symbols.error + ' Setup failed'));
  console.error(colors.dim(error));
  console.error();
}

/**
 * Display git initialization
 */
export function displayGitInit(): void {
  console.log(colors.dim('Git initialized'));
}

/**
 * New line helper
 */
export function newLine(): void {
  console.log();
}

// ============================================
// CHARACTER-BY-CHARACTER TYPING PROGRESS
// ============================================

/**
 * Set the expected text for typing progress tracking
 */
export function setExpectedText(text: string): void {
  expectedText = text;
  typedProgress = 0;
}

/**
 * Clear the expected text
 */
export function clearExpectedText(): void {
  expectedText = null;
  typedProgress = 0;
}

/**
 * Get the expected text
 */
export function getExpectedText(): string | null {
  return expectedText;
}

/**
 * Display the expected text with typing progress highlighted
 * Green = correctly typed, Orange = current position, Gray = remaining
 */
export function displayTypingProgress(userInput: string): void {
  if (!expectedText) return;

  let output = '';
  const expected = expectedText;

  for (let i = 0; i < expected.length; i++) {
    if (i < userInput.length) {
      // Character has been typed
      if (userInput[i] === expected[i]) {
        // Correct - green
        output += colors.success(expected[i]);
      } else {
        // Wrong - red
        output += colors.error(expected[i]);
      }
    } else if (i === userInput.length) {
      // Current position - orange cursor
      output += colors.orange(expected[i]);
    } else {
      // Not yet typed - dim
      output += colors.dim(expected[i]);
    }
  }

  // Clear line and rewrite
  process.stdout.write('\r\x1B[K');
  process.stdout.write(colors.dim('  target: ') + output);
}

/**
 * Display target code line that user should type
 * Comment explanation in gray above, command in green below (like real code)
 */
export function displayTargetLine(line: string, explanation?: string): void {
  setExpectedText(line);
  console.log();
  // Explanation as a comment above (gray)
  if (explanation) {
    console.log(colors.dim(`  // ${explanation}`));
  }
  // Main command in green to stand out
  console.log('  ' + colors.primary(line));
  console.log();
}

/**
 * Display a command with explanation above
 * Uses coding convention: comment above, code below
 */
export function displayCommandInstruction(command: string, explanation: string): void {
  console.log();
  // Explanation as a comment above (gray)
  console.log(colors.dim(`  // ${explanation}`));
  // Main command in green
  console.log('  ' + colors.primary(command));
  console.log();
}

/**
 * Update typing progress display (call on each keystroke)
 */
export function updateTypingProgress(currentInput: string): void {
  if (!expectedText) return;

  // Move cursor up to the target line and redraw
  process.stdout.write('\x1B[1A'); // Move up one line
  process.stdout.write('\r\x1B[K'); // Clear line

  let output = colors.dim('  target: ');

  for (let i = 0; i < expectedText.length; i++) {
    if (i < currentInput.length) {
      if (currentInput[i] === expectedText[i]) {
        output += colors.success(expectedText[i]);
      } else {
        output += colors.error(expectedText[i]);
      }
    } else if (i === currentInput.length) {
      output += colors.orange(expectedText[i]);
    } else {
      output += colors.dim(expectedText[i]);
    }
  }

  console.log(output);
}

/**
 * Check if user input matches expected text
 */
export function checkTypingComplete(userInput: string): boolean {
  return expectedText !== null && userInput === expectedText;
}

/**
 * Get typing accuracy percentage
 */
export function getTypingAccuracy(userInput: string): number {
  if (!expectedText || userInput.length === 0) return 0;

  let correct = 0;
  const checkLength = Math.min(userInput.length, expectedText.length);

  for (let i = 0; i < checkLength; i++) {
    if (userInput[i] === expectedText[i]) {
      correct++;
    }
  }

  return Math.round((correct / expectedText.length) * 100);
}

// ============================================
// TYPER SHARK - REAL-TIME TYPING FEEDBACK
// ============================================

/**
 * Display Typer Shark style target line with real-time coloring
 * - Light yellow: untyped characters
 * - Green: correctly typed characters
 * Characters only turn green when typed correctly in sequence
 */
export function displayTyperSharkTarget(expected: string, correctCount: number): void {
  if (!process.stdout.isTTY) return;

  let output = '  ';
  for (let i = 0; i < expected.length; i++) {
    if (i < correctCount) {
      // Correctly typed - green
      output += colors.success(expected[i]);
    } else {
      // Not yet typed or wrong - light yellow
      output += colors.tan(expected[i]);
    }
  }

  // Clear line and write target
  process.stdout.write('\r\x1B[K' + output);
}

/**
 * Display the input line below the target
 */
export function displayTyperSharkInput(input: string, prompt: string = '› '): void {
  if (!process.stdout.isTTY) return;

  process.stdout.write('\n' + colors.primary(prompt) + input);
}

/**
 * Redraw both target and input lines for Typer Shark mode
 * Accounts for the gray bar between target and input
 */
export function redrawTyperShark(expected: string, input: string, correctCount: number): void {
  if (!process.stdout.isTTY) return;

  // Move up two lines (over gray bar and target), clear, draw target
  process.stdout.write('\x1B[2A\r\x1B[K');

  let targetOutput = '  ';
  for (let i = 0; i < expected.length; i++) {
    if (i < correctCount) {
      targetOutput += colors.success(expected[i]);
    } else {
      targetOutput += colors.tan(expected[i]);
    }
  }
  process.stdout.write(targetOutput);

  // Move down to gray bar line, redraw it
  process.stdout.write('\n\r\x1B[K');
  process.stdout.write(drawBar());

  // Move down, clear, draw input
  process.stdout.write('\n\r\x1B[K');
  process.stdout.write(colors.primary('› ') + input);
}

/**
 * Clear previous lines to make room for Typer Shark display
 * This prevents showing duplicate code (raw streamed + formatted)
 */
export function clearForTyperShark(linesToClear: number = 0): void {
  if (!process.stdout.isTTY || linesToClear <= 0) return;

  // Move up and clear each line
  for (let i = 0; i < linesToClear; i++) {
    process.stdout.write('\x1B[1A'); // Move up one line
    process.stdout.write('\r\x1B[K'); // Clear line
  }
}

/**
 * Initialize Typer Shark display with target line and input prompt
 * Includes gray lines above and below to create an entry field look
 */
export function initTyperSharkDisplay(expected: string, explanation?: string): void {
  console.log();
  if (explanation) {
    console.log(colors.dim(`  // ${explanation}`));
  }
  // Show target line in yellow (all untyped)
  console.log('  ' + colors.tan(expected));
  // Top gray line - upper border of entry field
  console.log(drawBar());
  // Show input prompt
  process.stdout.write(colors.primary('› '));
}

/**
 * Finish Typer Shark display with bottom gray line
 * Includes blank line below for future helper text and to lift entry area from bottom
 */
export function finishTyperSharkDisplay(): void {
  console.log(drawBar());
  console.log(); // Blank line below for future helper text
}

// ============================================
// MULTI-LINE TYPER SHARK - For heredocs
// ============================================

export interface MultiLineState {
  currentLineIndex: number;   // Which line we're currently typing
  completedLines: string[];   // Lines that have been completed
  currentInput: string;       // Current input for the active line
  correctCount: number;       // Correct chars in current line
}

/**
 * Initialize multi-line Typer Shark display
 * Shows all lines with comments in gray, code in yellow/green
 * Includes gray lines above and below to create an entry field look
 * @param linesToClear - number of previous lines to clear (to remove raw streamed code)
 */
export function initMultiLineTyperShark(
  lines: Array<{ comment: string; code: string }>,
  currentLineIndex: number = 0,
  linesToClear: number = 0
): void {
  // Clear the raw streamed code that was displayed before
  if (linesToClear > 0) {
    clearForTyperShark(linesToClear);
  }

  // NOTE: redrawMultiLineTyperShark expects exactly (lines.length * 2 + 1) lines above cursor

  for (let i = 0; i < lines.length; i++) {
    const { comment, code } = lines[i];

    // Show comment in gray
    console.log(colors.dim(`  // ${comment}`));

    // Show code line - green if completed, yellow if current/pending
    if (i < currentLineIndex) {
      // Completed line - all green
      console.log('  ' + colors.success(code));
    } else if (i === currentLineIndex) {
      // Current line - yellow (will be tracked)
      console.log('  ' + colors.tan(code));
    } else {
      // Future line - dim yellow
      console.log('  ' + colors.dim(code));
    }
  }

  // Top gray line - upper border of entry field (directly above input prompt)
  console.log(drawBar());
  // Show input prompt (no blank line between gray bar and prompt)
  process.stdout.write(colors.primary('› '));
}

/**
 * Redraw multi-line Typer Shark display
 * Moves cursor up, redraws all lines, then input
 * Accounts for the gray bar between code lines and input
 */
export function redrawMultiLineTyperShark(
  lines: Array<{ comment: string; code: string }>,
  currentLineIndex: number,
  currentInput: string,
  correctCount: number,
  completedLines: string[] = []
): void {
  if (!process.stdout.isTTY) return;

  // Calculate how many lines to move up from current cursor position
  // After init: cursor is at end of prompt line (no newline after prompt)
  // Lines above cursor: (lines.length * 2) comment/code pairs + 1 gray bar = lines.length * 2 + 1
  // Add extra buffer for text wrapping or any cursor position drift
  const displayLines = lines.length * 2 + 1;
  const extraBuffer = 3; // Extra lines to clear above in case of drift
  const linesToMoveUp = displayLines + extraBuffer;

  // Move cursor up to top of display (plus buffer)
  process.stdout.write(`\x1B[${linesToMoveUp}A`);

  // Clear the extra buffer lines first
  for (let i = 0; i < extraBuffer; i++) {
    process.stdout.write('\r\x1B[K\n');
  }

  // Redraw each line pair
  for (let i = 0; i < lines.length; i++) {
    const { comment, code } = lines[i];

    // Clear and draw comment
    process.stdout.write('\r\x1B[K');
    process.stdout.write(colors.dim(`  // ${comment}`));
    process.stdout.write('\n');

    // Clear and draw code
    process.stdout.write('\r\x1B[K');
    if (i < currentLineIndex) {
      // Completed line - show what the user actually typed in green
      const userTyped = completedLines[i] || code;
      process.stdout.write('  ' + colors.success(userTyped));
    } else if (i === currentLineIndex) {
      // Current line - show typing progress
      let output = '  ';
      for (let j = 0; j < code.length; j++) {
        if (j < correctCount) {
          output += colors.success(code[j]);
        } else {
          output += colors.tan(code[j]);
        }
      }
      process.stdout.write(output);
    } else {
      // Future line - dim
      process.stdout.write('  ' + colors.dim(code));
    }
    process.stdout.write('\n');
  }

  // Gray bar - upper border of entry field (directly above input prompt)
  process.stdout.write('\r\x1B[K');
  process.stdout.write(drawBar());
  process.stdout.write('\n');

  // Input prompt with current input (no blank line between gray bar and prompt)
  process.stdout.write('\r\x1B[K');
  process.stdout.write(colors.primary('› ') + currentInput);
}
