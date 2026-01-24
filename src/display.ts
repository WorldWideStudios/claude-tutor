import chalk from 'chalk';
import type { Curriculum, TutorState, Segment, TutorMode } from './types.js';
import { TUTOR_MODES } from './types.js';
import { getMode, getModeInfo } from './mode.js';

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
  purple: noColor ? chalk.reset : chalk.hex('#A855F7'),  // Purple for discuss mode
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
 * Get available width for code display (accounts for prefix like "› " or "NN│ ")
 */
function getCodeDisplayWidth(prefixLen: number = 2): number {
  return getWidth() - prefixLen - 1; // -1 for safety margin
}

/**
 * Truncate text to fit terminal width, adding "…" if truncated
 */
function truncateForDisplay(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Get the visible portion of input when it exceeds maxWidth
 * Shows rightmost portion with "…" prefix
 */
function getVisibleInput(input: string, maxWidth: number): string {
  if (input.length <= maxWidth) return input;
  return '…' + input.slice(-(maxWidth - 1));
}

/**
 * Draw a horizontal bar
 */
export function drawBar(): string {
  return colors.muted('─'.repeat(getWidth()));
}

// Turtle ASCII art logo (3 lines using half-blocks for proper proportions)
// ▀ = top half, ▄ = bottom half, █ = full block
const TURTLE_LOGO = [
  '     ▄▄▄▄▄  ██▀▄',
  ' ▄ ▄▀█▀█▀█▀▄▀▀▀▀',
  '  ▀▀██▀▀██▀▀    ',
];

/**
 * Display welcome with side-by-side turtle logo and text
 * Claude Code style: clean, open layout without box borders
 */
export function displayWelcome(currentSkill?: string): void {
  clearScreen();
  console.log();

  const title = 'Claude Tutor';
  const version = 'v0.1.0';
  const tagline = 'Learn to code like an engineer';
  const skillLine = currentSkill ? `Learning: ${currentSkill}` : '';

  TURTLE_LOGO.forEach((logoLine, i) => {
    const coloredLogo = colors.primary(logoLine);  // Use project green

    if (i === 0) {
      // Title line - bold white + version in gray
      console.log(coloredLogo + '   ' + chalk.bold.white(title) + ' ' + colors.dim(version));
    } else if (i === 1) {
      // Tagline - dim
      console.log(coloredLogo + '   ' + colors.dim(tagline));
    } else {
      // Skill line - dim
      console.log(coloredLogo + '   ' + colors.dim(skillLine));
    }
  });

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

    process.stdout.write(`\r\x1B[K${colors.primaryDim(frame)} ${colors.dim(displayText + '...')}`);

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
 * Strip HTML tags from text for clean terminal display
 */
function stripHtmlTags(text: string): string {
  // Remove HTML tags like <think>, </think>, <response>, etc.
  return text.replace(/<[^>]*>/g, '');
}

/**
 * Display tutor response (streaming)
 */
export function displayTutorText(text: string): void {
  // Strip any HTML tags from Claude's response
  const cleanText = stripHtmlTags(text);
  if (!cleanText) return; // Skip if only HTML tags

  if (isFirstChunk) {
    process.stdout.write(colors.dim(symbols.bullet + ' '));
    isFirstChunk = false;
  }
  process.stdout.write(cleanText);
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
 * Mode display info with colors and descriptions
 */
const MODE_DISPLAY: Record<string, { color: typeof colors.tan; label: string; description: string }> = {
  tutor: {
    color: colors.tan,
    label: 'tutor',
    description: 'line by line',
  },
  block: {
    color: colors.primary,  // green
    label: 'code',
    description: 'freely',
  },
  discuss: {
    color: colors.purple,
    label: 'discuss',
    description: 'ideas and ask questions',
  },
};

/**
 * Get mode indicator string with color coding
 * Shows only current mode: "tutor" (in color) + "line by line (shift+tab to cycle)" (gray)
 */
export function getModeIndicator(): string {
  const current = getMode();
  const display = MODE_DISPLAY[current];
  return display.color(display.label) + colors.dim(` ${display.description} (shift+tab to cycle)`);
}

/**
 * Display mode footer below input area
 * Shows only current mode: tutor (colored) line by line (shift+tab to cycle) (gray)
 */
export function displayModeFooter(): void {
  console.log(getModeIndicator());
}

/**
 * Display mode footer inline (without newline) for redraw operations
 */
export function displayModeFooterInline(): void {
  process.stdout.write(getModeIndicator());
}

/**
 * Display mode status bar at bottom
 * Shows: tutor line by line (shift+tab to cycle)
 */
export function displayModeBar(): void {
  console.log(getModeIndicator());
}

/**
 * Display input prompt with mode bar and entry field
 * Creates an entry field look with mode indicator and gray bars
 */
export function displayPrompt(): void {
  console.log();
  // Mode status bar
  displayModeBar();
  // Top bar - creates upper border of entry field
  console.log(drawBar());

  // Input prompt (gray caret)
  process.stdout.write(colors.dim(symbols.arrow + ' '));
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

// Track lines used by question prompt for proper cleanup
let questionPromptLines = 4;

/**
 * Word-wrap text to fit within maxWidth, keeping words intact
 */
function wordWrap(text: string, maxWidth: number, indent: string = ''): string[] {
  if (text.length <= maxWidth) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = indent + word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [text];
}

/**
 * Calculate how many terminal lines a string will occupy when printed
 */
function getDisplayLineCount(text: string): number {
  const termWidth = process.stdout.columns || 80;
  const lines = text.split('\n');
  let totalLines = 0;
  for (const line of lines) {
    // Each line takes at least 1 row, plus additional rows if it wraps
    totalLines += Math.max(1, Math.ceil(line.length / termWidth));
  }
  return totalLines;
}

/**
 * Display question prompt for setup with full-width lines
 */
export function displayQuestionPrompt(question: string): void {
  // Strip any HTML tags from the question
  const cleanQuestion = stripHtmlTags(question);

  console.log(drawBar());
  console.log(colors.text(cleanQuestion));
  console.log(drawBar());
  process.stdout.write(colors.primary(symbols.arrow + ' '));

  // Calculate total lines: top bar (1) + question text lines + bottom bar (1) + prompt line (1)
  const questionLines = getDisplayLineCount(cleanQuestion);
  questionPromptLines = 1 + questionLines + 1 + 1; // top bar + question + bottom bar + prompt
}

/**
 * Close the question prompt after user enters their answer
 * Clears the entry box and shows the Q&A in the log
 */
export function closeQuestionPrompt(question: string, answer: string): void {
  if (!process.stdout.isTTY) return;

  // Strip any HTML tags from the question
  const cleanQuestion = stripHtmlTags(question);

  // Move cursor up to clear the entry box (calculated lines from displayQuestionPrompt)
  process.stdout.write(`\x1B[${questionPromptLines}A`);

  // Clear all the lines we used
  for (let i = 0; i < questionPromptLines; i++) {
    process.stdout.write('\r\x1B[K\n');
  }
  process.stdout.write(`\x1B[${questionPromptLines}A`);

  // Redraw as clean log entry (condensed - no bars)
  const termWidth = process.stdout.columns || 80;
  const prefix = symbols.arrow + ' ';
  const prefixLen = 2; // "› " is 2 chars

  process.stdout.write('\r\x1B[K');
  console.log(colors.dim(cleanQuestion));

  // Word-wrap the answer, with continuation lines indented to align
  const wrappedAnswer = wordWrap(answer, termWidth - prefixLen, '  ');
  wrappedAnswer.forEach((line, i) => {
    process.stdout.write('\r\x1B[K');
    if (i === 0) {
      console.log(colors.primary(prefix) + line);
    } else {
      console.log('  ' + line);
    }
  });

  process.stdout.write('\r\x1B[K');
  console.log(); // Blank line
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
 * Accounts for the gray bars above/below input and mode footer
 * Structure:
 *   target text
 *   ──────────── (top bar)
 *   › input
 *   ──────────── (bottom bar)
 *   mode footer
 */
export function redrawTyperShark(expected: string, input: string, correctCount: number): void {
  if (!process.stdout.isTTY) return;

  // Truncate to prevent line wrapping which breaks cursor positioning
  const codeWidth = getCodeDisplayWidth(2); // "  " or "› " prefix
  const truncatedExpected = truncateForDisplay(expected, codeWidth);

  // Move up 2 lines (from input line, past top bar, to target line)
  // Use \x1B[2A (cursor up) which doesn't cause scrolling issues
  process.stdout.write('\x1B[2A\r\x1B[K');

  // Draw target (truncated, with progress coloring)
  let targetOutput = '  ';
  for (let i = 0; i < truncatedExpected.length; i++) {
    // Map truncated position to original position for correct coloring
    if (i < correctCount && i < expected.length) {
      targetOutput += colors.success(truncatedExpected[i]);
    } else {
      targetOutput += colors.tan(truncatedExpected[i]);
    }
  }
  process.stdout.write(targetOutput);

  // Move down to top bar, redraw it
  // Use \x1B[1B (cursor down) instead of \n to avoid terminal scrolling
  process.stdout.write('\x1B[1B\r\x1B[K');
  process.stdout.write(drawBar());

  // Move down, clear, draw input (show rightmost portion if too long)
  process.stdout.write('\x1B[1B\r\x1B[K');
  const visibleInput = getVisibleInput(input, codeWidth);
  process.stdout.write(colors.dim('› ') + visibleInput);

  // Move down, redraw bottom bar
  process.stdout.write('\x1B[1B\r\x1B[K');
  process.stdout.write(drawBar());

  // Move down, redraw mode footer
  process.stdout.write('\x1B[1B\r\x1B[K');
  displayModeFooterInline();

  // Move cursor back up to input line
  process.stdout.write('\x1B[2A');
  // Position cursor at end of input
  process.stdout.write(`\r${colors.dim('› ')}${visibleInput}`);
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
 * Structure:
 *   // explanation (optional)
 *   target text (tan)
 *   ──────────── (top bar)
 *   › (input prompt)
 *   ──────────── (bottom bar)
 *   mode footer
 */
export function initTyperSharkDisplay(expected: string, explanation?: string): void {
  // Add buffer lines to ensure we have space at terminal bottom
  // This prevents scroll-induced cursor positioning issues during redraw
  // The display needs ~6 lines, so we ensure at least that much space
  const bufferLines = 6;
  for (let i = 0; i < bufferLines; i++) {
    console.log();
  }
  // Move back up to where we want to start the display
  process.stdout.write(`\x1B[${bufferLines}A`);

  // Truncate long text to prevent line wrapping which breaks cursor positioning
  const codeWidth = getCodeDisplayWidth(2); // "  " prefix
  const truncatedExpected = truncateForDisplay(expected, codeWidth);

  console.log();
  if (explanation) {
    const truncatedExplanation = truncateForDisplay(explanation, codeWidth - 3); // "// " prefix
    console.log(colors.dim(`  // ${truncatedExplanation}`));
  }
  // Show target line in tan (all untyped) - truncated to fit terminal
  console.log('  ' + colors.tan(truncatedExpected));
  // Top gray line - upper border of entry field
  console.log(drawBar());
  // Show input prompt (cursor will be here)
  console.log(colors.dim('› '));
  // Bottom gray line - lower border of entry field
  console.log(drawBar());
  // Mode footer
  displayModeFooter();
  // Move cursor back up to input line (3 lines up: after mode footer -> mode footer -> bottom bar -> input)
  process.stdout.write('\x1B[3A');
  // Position cursor after prompt
  process.stdout.write('\r' + colors.dim('› '));
}

/**
 * Finish Typer Shark display
 * Clears the entire display and shows just the entered text in the log
 * @param inputText - the text the user typed (to show in log)
 * @param hasExplanation - whether explanation was displayed (affects line count)
 */
export function finishTyperSharkDisplay(inputText: string, hasExplanation: boolean = false): void {
  // Display structure from input line:
  //   -4 (or -5): blank line
  //   -3 (or -4): explanation (if present)
  //   -2 (or -3): target text
  //   -1 (or -2): top bar
  //    0: input line (cursor is here)
  //   +1: bottom bar
  //   +2: mode footer

  const linesAbove = hasExplanation ? 4 : 3; // Lines above input line
  const linesBelow = 2; // bottom bar + mode footer
  const totalLines = linesAbove + 1 + linesBelow; // +1 for input line itself

  // Move up to the start of the display (blank line)
  process.stdout.write(`\x1B[${linesAbove}A`);

  // Clear all display lines
  for (let i = 0; i < totalLines; i++) {
    process.stdout.write('\r\x1B[K'); // Clear line
    if (i < totalLines - 1) {
      process.stdout.write('\x1B[1B'); // Move down
    }
  }

  // Move back to top
  process.stdout.write(`\x1B[${totalLines - 1}A`);

  // Print just the entered text as a log entry
  console.log(colors.success('✓ ') + inputText);
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
 * Shows brief explanation, then all lines with comments in gray, code in yellow/green
 * @param lines - code lines with comments
 * @param currentLineIndex - which line user is currently on
 * @param linesToClear - number of previous lines to clear (to remove raw streamed code)
 * @param explanation - brief 1-2 line description of what's being built
 */
/**
 * Initialize terminal-style multi-line input display
 * Shows expected code as reference, with input area below
 * Characters turn green as user types correctly across all lines
 * Structure:
 *   explanation (optional)
 *   Expected:
 *   code line 1 (tan)
 *   code line 2 (tan)
 *   ...
 *   ──────────── (top bar)
 *   › (input)
 *   ──────────── (bottom bar)
 *   mode footer
 *
 * @param expectedLines - array of code lines (just the code, no comments)
 * @param linesToClear - lines of raw streamed output to clear first
 * @param explanation - brief explanation shown at top
 */
export function initTerminalMultiLine(
  expectedLines: string[],
  linesToClear: number = 0,
  explanation?: string
): void {
  // Clear the raw streamed code that was displayed before
  if (linesToClear > 0) {
    clearForTyperShark(linesToClear);
  }

  // Add buffer lines to ensure we have space at terminal bottom
  // This prevents scroll-induced cursor positioning issues during redraw
  const bufferLines = expectedLines.length + 8;
  for (let i = 0; i < bufferLines; i++) {
    console.log();
  }
  // Move back up to where we want to start the display
  process.stdout.write(`\x1B[${bufferLines}A`);

  // Show brief explanation if provided
  if (explanation) {
    console.log(colors.dim(explanation));
  }

  // Show expected code (all in tan - will turn green as typed)
  console.log(colors.dim('  Expected:'));
  for (const line of expectedLines) {
    console.log('  ' + colors.tan(line));
  }

  // Top gray bar separating expected from input
  console.log(drawBar());

  // Initial input prompt (with newline so we can draw bottom elements)
  console.log(colors.dim('› '));

  // Bottom gray bar
  console.log(drawBar());

  // Mode footer
  displayModeFooter();

  // Move cursor back up to input line (3 lines up: after mode footer newline -> mode footer -> bottom bar -> input)
  process.stdout.write('\x1B[3A');
  // Position cursor after prompt (no need to rewrite caret, it's already there from console.log)
  process.stdout.write('\r\x1B[K' + colors.dim('› '));
}

/**
 * Redraw terminal-style multi-line input
 * Shows expected code with green progress, then user's input lines below
 * Structure:
 *   explanation (optional)
 *   Expected:
 *   code lines (green/tan)
 *   ──────────── (top bar)
 *   › input line 1
 *   > input line 2
 *   ...
 *   > current input
 *   ──────────── (bottom bar)
 *   mode footer
 *
 * @param expectedLines - array of expected code lines
 * @param expectedText - full expected text (lines joined with \n)
 * @param correctCount - number of correctly typed characters
 * @param inputLines - array of lines user has typed so far
 * @param currentLineInput - current line being typed
 * @param hasExplanation - whether explanation line was shown
 */
export function redrawTerminalMultiLine(
  expectedLines: string[],
  expectedText: string,
  correctCount: number,
  inputLines: string[],
  currentLineInput: string,
  hasExplanation: boolean = false
): void {
  if (!process.stdout.isTTY) return;

  // Calculate total lines above cursor (cursor is on current input line):
  // - explanation (if present): 1
  // - "Expected:" label: 1
  // - expected code lines: expectedLines.length
  // - top gray bar: 1
  // - input lines (completed): inputLines.length
  const totalLinesAboveCursor = (hasExplanation ? 1 : 0) + 1 + expectedLines.length + 1 + inputLines.length;

  // Move cursor up to top of display (from current input line to Expected: label)
  process.stdout.write(`\x1B[${totalLinesAboveCursor}A`);

  // Redraw explanation if present
  // Use \x1B[1B (cursor down) instead of \n to avoid terminal scrolling
  if (hasExplanation) {
    process.stdout.write('\r\x1B[K\x1B[1B');
  }

  // "Expected:" label
  process.stdout.write('\r\x1B[K');
  process.stdout.write(colors.dim('  Expected:'));
  process.stdout.write('\x1B[1B');

  // Redraw expected code with green progress
  let charIndex = 0;
  for (let lineIdx = 0; lineIdx < expectedLines.length; lineIdx++) {
    const line = expectedLines[lineIdx];
    process.stdout.write('\r\x1B[K  ');

    // Draw each character - green if typed correctly, tan if not yet
    for (let i = 0; i < line.length; i++) {
      if (charIndex < correctCount) {
        process.stdout.write(colors.success(line[i]));
      } else {
        process.stdout.write(colors.tan(line[i]));
      }
      charIndex++;
    }
    process.stdout.write('\x1B[1B');

    // Account for newline character in expected text (except after last line)
    if (lineIdx < expectedLines.length - 1) {
      charIndex++; // for the \n
    }
  }

  // Top gray bar
  process.stdout.write('\r\x1B[K');
  process.stdout.write(drawBar());
  process.stdout.write('\x1B[1B');

  // Redraw completed input lines
  for (let i = 0; i < inputLines.length; i++) {
    process.stdout.write('\r\x1B[K');
    const prompt = i === 0 ? colors.dim('› ') : colors.dim('> ');
    process.stdout.write(prompt + inputLines[i]);
    process.stdout.write('\x1B[1B');
  }

  // Current input line
  process.stdout.write('\r\x1B[K');
  const currentPrompt = inputLines.length === 0 ? colors.dim('› ') : colors.dim('> ');
  process.stdout.write(currentPrompt + currentLineInput);
  process.stdout.write('\x1B[1B');

  // Bottom gray bar
  process.stdout.write('\r\x1B[K');
  process.stdout.write(drawBar());
  process.stdout.write('\x1B[1B');

  // Mode footer
  process.stdout.write('\r\x1B[K');
  displayModeFooterInline();

  // Move cursor back up to current input line (2 lines up: mode footer, bottom bar)
  process.stdout.write('\x1B[2A');
  // Position cursor at end of current input
  process.stdout.write(`\r${currentPrompt}${currentLineInput}`);
}

// Legacy functions kept for backwards compatibility
export function initMultiLineTyperShark(
  lines: Array<{ comment: string; code: string }>,
  currentLineIndex: number = 0,
  linesToClear: number = 0,
  explanation?: string
): void {
  const expectedLines = lines.map(l => l.code);
  initTerminalMultiLine(expectedLines, linesToClear, explanation);
}

export function redrawMultiLineTyperShark(
  lines: Array<{ comment: string; code: string }>,
  currentLineIndex: number,
  currentInput: string,
  correctCount: number,
  completedLines: string[] = [],
  hasExplanation: boolean = false
): void {
  const expectedLines = lines.map(l => l.code);
  const expectedText = expectedLines.join('\n');
  redrawTerminalMultiLine(expectedLines, expectedText, correctCount, completedLines, currentInput, hasExplanation);
}
