import * as readline from 'readline';
import {
  setExpectedText,
  clearExpectedText,
  getExpectedText,
  displayTargetLine,
  initTyperSharkDisplay,
  redrawTyperShark,
  finishTyperSharkDisplay,
  initTerminalMultiLine,
  redrawTerminalMultiLine,
  clearForTyperShark,
  drawBar,
  getModeIndicator,
  displayModeFooter,
  displayModeFooterInline,
} from './display.js';
import { cycleMode, getMode, isDiscussMode, isBlockMode, isTutorMode } from './mode.js';
import chalk from 'chalk';

// Colors for typing feedback
const colors = {
  success: chalk.green,
  error: chalk.red,
  orange: chalk.hex('#F59E0B'),
  dim: chalk.gray,
  primary: chalk.hex('#10B981'),
  tan: chalk.hex('#D4A574'),
  // For interactive select: white text on green background
  selectedBg: chalk.bgHex('#10B981').white.bold,
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

/**
 * Question for multi-question wizard
 */
export interface WizardQuestion {
  question: string;
  header: string;
  options: SelectOption[];
}

/**
 * Multi-question wizard with navigation
 * - Shows progress (1/4, 2/4, etc.)
 * - Left/right arrows navigate between questions
 * - Up/down arrows select options
 * - Shows summary before final submit
 * - Can go back to edit any answer from summary
 */
export function createMultiQuestionWizard(
  rl: readline.Interface,
  questions: WizardQuestion[]
): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    // Non-TTY fallback
    if (!process.stdin.isTTY) {
      const answers: Record<string, string> = {};
      console.log('Answer the following questions:');
      questions.forEach((q, i) => {
        console.log(`\n${i + 1}. ${q.question}`);
        q.options.forEach((opt, j) => console.log(`  ${j + 1}. ${opt.label}`));
      });
      process.stdout.write('Enter answers (comma-separated numbers): ');
      rl.once('line', (input) => {
        const nums = input.split(',').map(s => parseInt(s.trim()));
        questions.forEach((q, i) => {
          const num = nums[i] || 1;
          answers[q.question] = q.options[num - 1]?.value || q.options[0]?.value || '';
        });
        resolve(answers);
      });
      return;
    }

    const termWidth = process.stdout.columns || 80;
    const answers: (string | null)[] = questions.map(() => null);
    const selectedIndices: number[] = questions.map(() => 0);
    let currentQuestionIndex = 0;
    let showingSummary = false;
    let summarySelectedIndex = 0;

    // Word-wrap text to fit within maxWidth
    const wordWrap = (text: string, maxWidth: number, indent: string = ''): string[] => {
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
    };

    // Add "Other" option to each question's options list for display
    const getOptionsWithOther = (qIdx: number): SelectOption[] => {
      return [...questions[qIdx].options, { label: 'Other (type your own)', value: '__OTHER__', description: '' }];
    };

    // Track the actual number of lines currently displayed on screen
    let currentDisplayedLines = 0;

    // Custom input mode state - for typing directly on "Other" line
    let customInputMode = false;
    let customInputValue = '';

    // Calculate lines for a question display
    const getQuestionDisplayLines = (qIdx: number): number => {
      const q = questions[qIdx];
      const opts = getOptionsWithOther(qIdx);
      let total = 1; // top bar
      total += 1; // progress line
      total += wordWrap(q.question, termWidth - 1).length;
      opts.forEach((opt, i) => {
        const isOtherOption = opt.value === '__OTHER__';
        const isSelected = i === selectedIndices[qIdx];

        // In custom input mode, "Other" line is always 1 line (just shows typed value)
        if (isOtherOption && customInputMode && isSelected && qIdx === currentQuestionIndex) {
          total += 1;
          return;
        }

        const num = `${i + 1}.`;
        const prefix = `  ${num} `;
        const desc = opt.description ? ` - ${opt.description}` : '';
        const fullLine = prefix + opt.label + desc;
        total += wordWrap(fullLine, termWidth - 1, '       ').length;
      });
      total += 1; // navigation hint
      total += 1; // bottom bar
      return total;
    };

    // Calculate lines for summary display
    const getSummaryDisplayLines = (): number => {
      let total = 1; // top bar
      total += 1; // "Review your answers" header
      total += 1; // blank line
      questions.forEach((q, i) => {
        total += 1; // question number + short question
        total += 1; // answer
      });
      total += 1; // blank line
      total += 1; // instruction
      total += 1; // bottom bar
      return total;
    };

    const drawQuestion = (clearFirst: boolean = false) => {
      const q = questions[currentQuestionIndex];
      const opts = getOptionsWithOther(currentQuestionIndex);
      const selectedIdx = selectedIndices[currentQuestionIndex];
      const totalLines = getQuestionDisplayLines(currentQuestionIndex);

      if (clearFirst) {
        process.stdout.write(`\x1B[${totalLines}A`);
        for (let i = 0; i < totalLines; i++) {
          process.stdout.write('\r\x1B[K\n');
        }
        process.stdout.write(`\x1B[${totalLines}A`);
      }

      // Top bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());

      // Progress indicator
      process.stdout.write('\r\x1B[K');
      console.log(colors.dim(`  Question ${currentQuestionIndex + 1}/${questions.length}`));

      // Question text
      const questionLines = wordWrap(q.question, termWidth - 1);
      questionLines.forEach((line) => {
        process.stdout.write('\r\x1B[K');
        console.log(colors.primary(line));
      });

      // Options (including "Other")
      opts.forEach((opt, i) => {
        const num = `${i + 1}.`;
        const prefix = i === selectedIdx ? `› ${num} ` : `  ${num} `;
        const isOtherOption = opt.value === '__OTHER__';

        // For "Other" in custom input mode, show the typed value
        if (isOtherOption && customInputMode && i === selectedIdx) {
          process.stdout.write('\r\x1B[K');
          process.stdout.write(colors.primary(prefix) + chalk.white(customInputValue));
          console.log();
          return; // Single line only for custom input
        }

        const desc = opt.description ? ` - ${opt.description}` : '';
        const fullText = prefix + opt.label + desc;
        const wrappedLines = wordWrap(fullText, termWidth - 1, '       ');

        wrappedLines.forEach((line, lineIdx) => {
          process.stdout.write('\r\x1B[K');
          if (lineIdx === 0) {
            const prefixAndLabel = prefix + opt.label;
            if (i === selectedIdx) {
              if (line.length <= prefixAndLabel.length) {
                process.stdout.write(colors.primary(line));
              } else {
                process.stdout.write(colors.primary(prefixAndLabel));
                process.stdout.write(chalk.white(line.slice(prefixAndLabel.length)));
              }
            } else {
              if (line.length <= prefixAndLabel.length) {
                process.stdout.write(colors.dim(line));
              } else {
                process.stdout.write(colors.dim(prefixAndLabel));
                process.stdout.write(chalk.white(line.slice(prefixAndLabel.length)));
              }
            }
          } else {
            process.stdout.write(chalk.white(line));
          }
          console.log();
        });
      });

      // Navigation hint
      process.stdout.write('\r\x1B[K');
      let navHint: string;
      if (customInputMode) {
        navHint = 'Type your answer • Enter submit • Esc cancel';
      } else if (currentQuestionIndex === 0) {
        navHint = '↑↓ select • Enter confirm • → next';
      } else if (currentQuestionIndex === questions.length - 1) {
        navHint = '↑↓ select • Enter confirm • ← back';
      } else {
        navHint = '↑↓ select • Enter confirm • ←→ navigate';
      }
      console.log(colors.dim(`  ${navHint}`));

      // Bottom bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());

      // Clear the line below the bar to prevent terminal artifacts
      process.stdout.write('\r\x1B[K');

      // Update the tracked display line count after drawing
      currentDisplayedLines = getQuestionDisplayLines(currentQuestionIndex);
    };

    // Redraw just the "Other" line and navigation hint (for inline typing)
    // This avoids redrawing the entire wizard which causes display issues
    const redrawOtherLineOnly = () => {
      const opts = getOptionsWithOther(currentQuestionIndex);
      const otherIdx = opts.length - 1; // "Other" is always last
      const num = `${otherIdx + 1}.`;
      const prefix = `› ${num} `; // Always selected when in custom mode

      // Cursor is on line AFTER bottom bar (due to console.log in drawQuestion)
      // Move up 3 lines: after-bar -> bar -> nav hint -> Other line
      process.stdout.write('\x1B[3A');

      // Clear and redraw the "Other" line
      process.stdout.write('\r\x1B[K');
      process.stdout.write(colors.primary(prefix) + chalk.white(customInputValue));

      // Move down to nav hint line and redraw it
      process.stdout.write('\x1B[1B\r\x1B[K');
      process.stdout.write(colors.dim('  Type your answer • Enter submit • Esc cancel'));

      // Move down past bottom bar to the line after it and clear it
      process.stdout.write('\x1B[2B\r\x1B[K');
    };

    const drawSummary = (clearFirst: boolean = false) => {
      const totalLines = getSummaryDisplayLines();

      if (clearFirst) {
        // Clear previous display (could be question or summary)
        const prevLines = showingSummary ? totalLines : getQuestionDisplayLines(currentQuestionIndex);
        process.stdout.write(`\x1B[${prevLines}A`);
        for (let i = 0; i < Math.max(prevLines, totalLines); i++) {
          process.stdout.write('\r\x1B[K\n');
        }
        process.stdout.write(`\x1B[${Math.max(prevLines, totalLines)}A`);
      }

      // Top bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());

      // Header
      process.stdout.write('\r\x1B[K');
      console.log(colors.primary('  Review your answers'));

      // Blank line
      process.stdout.write('\r\x1B[K');
      console.log();

      // Questions and answers
      questions.forEach((q, i) => {
        process.stdout.write('\r\x1B[K');
        const shortQ = q.header || q.question.slice(0, 30) + (q.question.length > 30 ? '...' : '');
        // For custom answers, show the value directly; for preset options, show the label
        const answerValue = answers[i];
        const presetOpt = q.options.find(o => o.value === answerValue);
        const answerLabel = presetOpt ? presetOpt.label : (answerValue || '(no answer)');

        if (i === summarySelectedIndex) {
          console.log(colors.primary(`› ${i + 1}. ${shortQ}`));
        } else {
          console.log(colors.dim(`  ${i + 1}. ${shortQ}`));
        }

        process.stdout.write('\r\x1B[K');
        console.log(chalk.white(`     ${answerLabel}`));
      });

      // Blank line
      process.stdout.write('\r\x1B[K');
      console.log();

      // Instruction
      process.stdout.write('\r\x1B[K');
      if (summarySelectedIndex === questions.length) {
        console.log(colors.primary('› Submit answers') + colors.dim(' • ↑ to edit'));
      } else {
        console.log(colors.dim('  ↑↓ select • Enter to edit • ↓ to Submit'));
      }

      // Bottom bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());

      // Clear the line below the bar to prevent terminal artifacts
      process.stdout.write('\r\x1B[K');

      // Update tracked display lines for summary
      currentDisplayedLines = getSummaryDisplayLines();
    };

    const redrawQuestion = () => {
      // Use tracked display lines (what's actually on screen) for cursor movement
      // This is crucial when transitioning between modes (e.g., entering custom input mode)
      // where "Other (type your own)" has different length than "Other: █"
      const linesToClear = currentDisplayedLines || getQuestionDisplayLines(currentQuestionIndex);
      const newLines = getQuestionDisplayLines(currentQuestionIndex);

      // Move up to top of OLD display (using tracked lines, not recalculated)
      process.stdout.write(`\x1B[${linesToClear}A`);
      // Clear enough lines to cover both old and new display
      for (let i = 0; i < Math.max(linesToClear, newLines); i++) {
        process.stdout.write('\r\x1B[K\n');
      }
      // Move back up by NEW line count to position for drawing
      process.stdout.write(`\x1B[${Math.max(linesToClear, newLines)}A`);
      drawQuestion();
    };

    const redrawSummary = () => {
      // Use tracked display lines for cursor movement
      const linesToClear = currentDisplayedLines || getSummaryDisplayLines();
      const newLines = getSummaryDisplayLines();

      // Move up to top of OLD display
      process.stdout.write(`\x1B[${linesToClear}A`);
      // Clear enough lines to cover both old and new display
      for (let i = 0; i < Math.max(linesToClear, newLines); i++) {
        process.stdout.write('\r\x1B[K\n');
      }
      // Move back up by new line count
      process.stdout.write(`\x1B[${Math.max(linesToClear, newLines)}A`);
      drawSummary();
    };

    // Hide cursor during selection
    process.stdout.write('\x1B[?25l');

    // Initial draw
    drawQuestion();
    // Initialize tracked display lines after first draw
    currentDisplayedLines = getQuestionDisplayLines(currentQuestionIndex);

    // Enable raw mode for direct character input
    // Note: We don't use rl.pause()/resume() because readline's internal listener
    // still receives data even when paused, causing doubled character input.
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let escapeBuffer = '';
    let escapeTimeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      process.stdout.write('\x1B[?25h'); // Show cursor again
      process.stdin.pause(); // Stop receiving data during transition
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handleKeypress);
      if (escapeTimeout) clearTimeout(escapeTimeout);
    };

    const processKey = (key: string) => {
      if (key === '\x03') {
        process.stdout.write('\x1B[?25h'); // Show cursor before exit
        cleanup();
        console.log('\n');
        process.exit(0);
      }

      if (showingSummary) {
        // Summary mode
        if (key === '\x1b[A' || key === '\x1bOA') {
          // Up
          summarySelectedIndex = Math.max(0, summarySelectedIndex - 1);
          redrawSummary();
        } else if (key === '\x1b[B' || key === '\x1bOB') {
          // Down
          summarySelectedIndex = Math.min(questions.length, summarySelectedIndex + 1);
          redrawSummary();
        } else if (key === '\r' || key === '\n') {
          // Enter
          if (summarySelectedIndex === questions.length) {
            // Submit
            cleanup();
            const totalLines = getSummaryDisplayLines();
            process.stdout.write(`\x1B[${totalLines}A`);
            for (let i = 0; i < totalLines; i++) {
              process.stdout.write('\r\x1B[K\n');
            }
            process.stdout.write(`\x1B[${totalLines}A`);

            const result: Record<string, string> = {};
            questions.forEach((q, i) => {
              result[q.question] = answers[i] || q.options[0]?.value || '';
            });
            resolve(result);
          } else {
            // Go back to edit that question
            currentQuestionIndex = summarySelectedIndex;
            showingSummary = false;
            // Clear summary and draw question
            const summaryLines = getSummaryDisplayLines();
            const questionLines = getQuestionDisplayLines(currentQuestionIndex);
            const linesToClear = Math.max(summaryLines, questionLines) + 2;
            process.stdout.write(`\x1B[${linesToClear}A`);
            for (let i = 0; i < linesToClear; i++) {
              process.stdout.write('\r\x1B[K\n');
            }
            // Move back up by the same amount we cleared
            process.stdout.write(`\x1B[${linesToClear}A`);
            drawQuestion();
          }
        }
        return;
      }

      // Custom input mode - handle typing directly on the "Other" line
      if (customInputMode) {
        // Ignore arrow keys in custom input mode (consume them, don't pass through)
        if (key === '\x1b[A' || key === '\x1bOA' ||  // Up
            key === '\x1b[B' || key === '\x1bOB' ||  // Down
            key === '\x1b[C' || key === '\x1bOC' ||  // Right
            key === '\x1b[D' || key === '\x1bOD') {  // Left
          return;
        }
        if (key === '\r' || key === '\n') {
          // Submit custom input
          const trimmedValue = customInputValue.trim();
          if (trimmedValue) {
            answers[currentQuestionIndex] = trimmedValue;
            customInputMode = false;
            customInputValue = '';

            if (currentQuestionIndex < questions.length - 1) {
              // Move to next question
              currentQuestionIndex++;
              redrawQuestion();
            } else {
              // Last question - show summary
              showingSummary = true;
              summarySelectedIndex = questions.length;
              redrawQuestion(); // Clear current display
              // Now draw summary over it
              const questionLines = getQuestionDisplayLines(currentQuestionIndex);
              const summaryLines = getSummaryDisplayLines();
              const linesToClear = Math.max(questionLines, summaryLines) + 2;
              process.stdout.write(`\x1B[${linesToClear}A`);
              for (let i = 0; i < linesToClear; i++) {
                process.stdout.write('\r\x1B[K\n');
              }
              // Move back up by the same amount we cleared
              process.stdout.write(`\x1B[${linesToClear}A`);
              drawSummary();
            }
          }
          return;
        }
        if (key === '\x7f' || key === '\b') {
          // Backspace
          if (customInputValue.length > 0) {
            customInputValue = customInputValue.slice(0, -1);
            redrawOtherLineOnly();
          }
          return;
        }
        if (key === '\x1b') {
          // Escape - cancel custom input, go back to selection
          customInputMode = false;
          customInputValue = '';
          redrawQuestion();
          return;
        }
        // Regular character - add to custom input
        if (key.length === 1 && key >= ' ') {
          customInputValue += key;
          redrawOtherLineOnly();
        }
        return;
      }

      // Question mode (selection)
      const q = questions[currentQuestionIndex];
      const opts = getOptionsWithOther(currentQuestionIndex);

      if (key === '\x1b[A' || key === '\x1bOA') {
        // Up arrow - select previous option
        selectedIndices[currentQuestionIndex] = (selectedIndices[currentQuestionIndex] - 1 + opts.length) % opts.length;
        redrawQuestion();
      } else if (key === '\x1b[B' || key === '\x1bOB') {
        // Down arrow - select next option
        selectedIndices[currentQuestionIndex] = (selectedIndices[currentQuestionIndex] + 1) % opts.length;
        redrawQuestion();
      } else if (key === '\x1b[D' || key === '\x1bOD') {
        // Left arrow - go to previous question
        if (currentQuestionIndex > 0) {
          const prevLines = getQuestionDisplayLines(currentQuestionIndex);
          currentQuestionIndex--;
          const newLines = getQuestionDisplayLines(currentQuestionIndex);
          // Add buffer lines to ensure we clear everything
          const linesToClear = Math.max(prevLines, newLines) + 2;
          process.stdout.write(`\x1B[${linesToClear}A`);
          for (let i = 0; i < linesToClear; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          // Move back up by the same amount we cleared
          process.stdout.write(`\x1B[${linesToClear}A`);
          drawQuestion();
        }
      } else if (key === '\x1b[C' || key === '\x1bOC') {
        // Right arrow - go to next question (if answered)
        if (currentQuestionIndex < questions.length - 1 && answers[currentQuestionIndex] !== null) {
          const prevLines = getQuestionDisplayLines(currentQuestionIndex);
          currentQuestionIndex++;
          const newLines = getQuestionDisplayLines(currentQuestionIndex);
          // Add buffer lines to ensure we clear everything
          const linesToClear = Math.max(prevLines, newLines) + 2;
          process.stdout.write(`\x1B[${linesToClear}A`);
          for (let i = 0; i < linesToClear; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          // Move back up by the same amount we cleared
          process.stdout.write(`\x1B[${linesToClear}A`);
          drawQuestion();
        }
      } else if (key.length === 1 && key >= ' ' && key <= '~') {
        // Regular printable character in selection mode
        // Auto-activate "Other" option and start typing
        const otherIdx = opts.length - 1; // "Other" is always last
        selectedIndices[currentQuestionIndex] = otherIdx;
        customInputMode = true;
        customInputValue = key; // Start with the typed character
        redrawQuestion();
        return;
      } else if (key === '\r' || key === '\n') {
        // Enter - confirm selection
        const selectedOpt = opts[selectedIndices[currentQuestionIndex]];

        // Check if "Other" option selected - enter inline custom input mode
        if (selectedOpt.value === '__OTHER__') {
          customInputMode = true;
          customInputValue = '';
          // Redraw to show the "Other" line in input mode and update nav hint
          redrawQuestion();
          return;
        }

        answers[currentQuestionIndex] = selectedOpt.value;

        if (currentQuestionIndex < questions.length - 1) {
          // Move to next question
          const prevLines = getQuestionDisplayLines(currentQuestionIndex);
          currentQuestionIndex++;
          const newLines = getQuestionDisplayLines(currentQuestionIndex);
          // Add buffer lines to ensure we clear everything (cursor may be offset)
          const linesToClear = Math.max(prevLines, newLines) + 2;
          process.stdout.write(`\x1B[${linesToClear}A`);
          for (let i = 0; i < linesToClear; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          // Move back up by the same amount we cleared
          process.stdout.write(`\x1B[${linesToClear}A`);
          drawQuestion();
        } else {
          // Last question - show summary
          // Clear the question display first (before setting showingSummary)
          const questionLines = getQuestionDisplayLines(currentQuestionIndex);
          const summaryLines = getSummaryDisplayLines();
          const linesToClear = Math.max(questionLines, summaryLines) + 2;
          process.stdout.write(`\x1B[${linesToClear}A`);
          for (let i = 0; i < linesToClear; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          // Move back up by the same amount we cleared
          process.stdout.write(`\x1B[${linesToClear}A`);

          showingSummary = true;
          summarySelectedIndex = questions.length; // Default to Submit
          drawSummary(); // No need for clearFirst since we already cleared
        }
      }
    };

    const handleKeypress = (chunk: Buffer) => {
      const data = chunk.toString();
      for (const char of data) {
        if (escapeBuffer.length > 0) {
          escapeBuffer += char;
          if (escapeBuffer.length >= 3) {
            if (escapeTimeout) clearTimeout(escapeTimeout);
            processKey(escapeBuffer);
            escapeBuffer = '';
          }
        } else if (char === '\x1b') {
          escapeBuffer = char;
          if (escapeTimeout) clearTimeout(escapeTimeout);
          escapeTimeout = setTimeout(() => {
            if (escapeBuffer === '\x1b') processKey('\x1b');
            escapeBuffer = '';
          }, 50);
        } else {
          processKey(char);
        }
      }
    };

    process.stdin.on('data', handleKeypress);
  });
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
      process.stdout.write(colors.dim('› '));
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

    // Get terminal width for wrapping calculations
    const termWidth = process.stdout.columns || 80;

    // Word-wrap text to fit within maxWidth, returning array of lines
    const wordWrap = (text: string, maxWidth: number, indent: string = ''): string[] => {
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
          // If single word is longer than maxWidth, just use it as-is
          currentLine = indent + word;
        }
      }
      if (currentLine) lines.push(currentLine);

      return lines.length > 0 ? lines : [text];
    };

    // Calculate total visual lines for the display
    const getTotalVisualLines = (): number => {
      let total = 1; // top bar
      total += wordWrap(question, termWidth - 1).length; // question may wrap

      // Each option: prefix + label + description
      allOptions.forEach((opt) => {
        const prefix = '  1. '; // all prefixes same length
        const desc = opt.description ? ` - ${opt.description}` : '';
        const fullLine = prefix + opt.label + desc;
        total += wordWrap(fullLine, termWidth - 1, '       ').length;
      });

      total += 1; // bottom bar
      return total;
    };

    const drawOptions = () => {
      // Top gray bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());

      // Question in green (word wrap)
      const questionLines = wordWrap(question, termWidth - 1);
      questionLines.forEach((line) => {
        process.stdout.write('\r\x1B[K');
        console.log(colors.primary(line));
      });

      // Options: green label, white description (word wrapped)
      allOptions.forEach((opt, i) => {
        const num = `${i + 1}.`;
        const prefix = i === selectedIndex ? `› ${num} ` : `  ${num} `;
        const label = opt.label;
        const desc = opt.description ? ` - ${opt.description}` : '';
        const fullText = prefix + label + desc;

        // Word wrap with indent for continuation lines
        const wrappedLines = wordWrap(fullText, termWidth - 1, '       ');

        wrappedLines.forEach((line, lineIdx) => {
          process.stdout.write('\r\x1B[K');
          if (lineIdx === 0) {
            // First line has the prefix styling
            if (i === selectedIndex) {
              // Selected: green prefix+label, white description
              const prefixAndLabel = prefix + label;
              if (line.length <= prefixAndLabel.length) {
                process.stdout.write(colors.primary(line));
              } else {
                process.stdout.write(colors.primary(prefixAndLabel));
                process.stdout.write(chalk.white(line.slice(prefixAndLabel.length)));
              }
            } else {
              // Not selected: dim prefix+label, white description
              const prefixAndLabel = prefix + label;
              if (line.length <= prefixAndLabel.length) {
                process.stdout.write(colors.dim(line));
              } else {
                process.stdout.write(colors.dim(prefixAndLabel));
                process.stdout.write(chalk.white(line.slice(prefixAndLabel.length)));
              }
            }
          } else {
            // Continuation lines are all white (description continues)
            process.stdout.write(chalk.white(line));
          }
          console.log();
        });
      });

      // Bottom gray bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());
    };

    const redraw = () => {
      // Calculate total display lines (accounting for wrapping)
      const totalLines = getTotalVisualLines();

      // Move cursor to top of display
      process.stdout.write(`\x1B[${totalLines}A`);

      drawOptions();
    };

    const drawCustomInput = () => {
      // Total lines when in custom mode: top bar + question + "Type your answer" + input line + bottom bar
      const totalLines = 5;
      process.stdout.write(`\x1B[${totalLines}A`);

      // Top gray bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());

      // Question
      process.stdout.write('\r\x1B[K');
      console.log(colors.primary(question));

      // Instruction
      process.stdout.write('\r\x1B[K');
      console.log(colors.dim('  Type your answer (Esc to go back):'));

      // Input line
      process.stdout.write('\r\x1B[K');
      process.stdout.write(colors.primary('  › ') + customInput);

      // Save cursor, draw bottom bar, restore
      process.stdout.write('\x1B[s');
      console.log();
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());
      process.stdout.write('\x1B[u');
    };

    // Initial draw
    drawOptions();

    // Enable raw mode for direct character input
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Buffer for escape sequence handling
    let escapeBuffer = '';
    let escapeTimeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      process.stdin.pause(); // Stop receiving data during transition
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handleKeypress);
      if (escapeTimeout) clearTimeout(escapeTimeout);
    };

    const processKey = (key: string) => {
      // Ctrl+C - exit
      if (key === '\x03') {
        cleanup();
        console.log('\n');
        process.exit(0);
      }

      if (isTypingCustom) {
        // Custom input mode
        if (key === '\r' || key === '\n') {
          // Submit custom input - clear display and resolve
          cleanup();
          // Clear the custom input display
          process.stdout.write('\x1B[5A'); // Move up 5 lines
          for (let i = 0; i < 5; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          process.stdout.write('\x1B[5A'); // Move back up
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
          // Clear custom mode display (5 lines) and prepare for select redraw
          const selectLines = getTotalVisualLines();
          // Move up to clear the 5-line custom mode
          process.stdout.write('\x1B[5A');
          // Clear enough lines for select display
          for (let i = 0; i < selectLines; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          // Move back up and redraw
          process.stdout.write(`\x1B[${selectLines}A`);
          drawOptions();
          return;
        }
        if (key.length === 1 && key >= ' ') {
          customInput += key;
          drawCustomInput();
        }
        return;
      }

      // Selection mode - handle arrow keys
      if (key === '\x1b[A' || key === '\x1bOA') {
        // Up arrow
        selectedIndex = (selectedIndex - 1 + allOptions.length) % allOptions.length;
        redraw();
      } else if (key === '\x1b[B' || key === '\x1bOB') {
        // Down arrow
        selectedIndex = (selectedIndex + 1) % allOptions.length;
        redraw();
      } else if (key === '\r' || key === '\n') {
        // Enter - select
        if (allOptions[selectedIndex].value === '__OTHER__') {
          // Switch to custom input mode
          isTypingCustom = true;
          // Clear current display
          const currentLines = getTotalVisualLines();
          process.stdout.write(`\x1B[${currentLines}A`);
          for (let i = 0; i < currentLines; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          process.stdout.write(`\x1B[${currentLines}A`);
          // Draw custom input mode
          console.log(drawBar());
          console.log(colors.primary(question));
          console.log(colors.dim('  Type your answer (Esc to go back):'));
          process.stdout.write(colors.primary('  › '));
          process.stdout.write('\x1B[s');
          console.log();
          console.log(drawBar());
          process.stdout.write('\x1B[u');
        } else {
          cleanup();
          // Clear the select display
          const totalLines = getTotalVisualLines();
          process.stdout.write(`\x1B[${totalLines}A`);
          for (let i = 0; i < totalLines; i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          process.stdout.write(`\x1B[${totalLines}A`);
          resolve(allOptions[selectedIndex].value);
        }
      }
      // Ignore all other keys in selection mode (including escape alone)
    };

    const handleKeypress = (chunk: Buffer) => {
      const data = chunk.toString();

      // Handle escape sequences properly
      for (const char of data) {
        if (escapeBuffer.length > 0) {
          // We're in an escape sequence
          escapeBuffer += char;

          // Check if we have a complete escape sequence
          if (escapeBuffer.length >= 3) {
            // Got full escape sequence (e.g., \x1b[A or \x1bOA)
            if (escapeTimeout) clearTimeout(escapeTimeout);
            processKey(escapeBuffer);
            escapeBuffer = '';
          }
        } else if (char === '\x1b') {
          // Start of escape sequence
          escapeBuffer = char;
          // Set timeout in case it's just a lone escape key
          if (escapeTimeout) clearTimeout(escapeTimeout);
          escapeTimeout = setTimeout(() => {
            if (escapeBuffer === '\x1b') {
              processKey('\x1b'); // Just escape key
            }
            escapeBuffer = '';
          }, 50);
        } else {
          // Regular character
          processKey(char);
        }
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}

/**
 * Detect if Claude suggested new/different code during discuss mode
 * Looks at recent assistant messages for code blocks
 */
export function detectCodeInDiscussion(messages: Array<{ role: string; content: unknown }>): string | null {
  // Look at last few assistant messages
  const recentMessages = messages
    .filter(m => m.role === 'assistant')
    .slice(-3);

  for (const msg of recentMessages) {
    const content = typeof msg.content === 'string' ? msg.content :
      Array.isArray(msg.content) ?
        msg.content.map((c: { type?: string; text?: string }) => c.type === 'text' ? c.text : '').join('') : '';

    // Look for code blocks
    const codeBlockMatch = content.match(/```(?:bash|sh|shell|typescript|ts|javascript|js)?\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      const code = codeBlockMatch[1].trim();
      // Only return if it looks like substantial code (not just a one-liner example)
      if (code.length > 20 || code.includes('\n')) {
        return code;
      }
    }
  }

  return null;
}

/**
 * Prompt user about updating the plan with new code
 */
export async function promptPlanUpdate(
  rl: readline.Interface,
  newCode: string,
  currentCode: string
): Promise<boolean> {
  console.log();
  console.log(colors.orange('New code was discussed that differs from your plan.'));
  console.log();
  console.log(colors.dim('Suggested code:'));
  console.log(colors.dim('─'.repeat(60)));
  // Show first few lines of new code
  const previewLines = newCode.split('\n').slice(0, 5);
  previewLines.forEach(line => console.log(colors.tan(line)));
  if (newCode.split('\n').length > 5) {
    console.log(colors.dim(`  ... (${newCode.split('\n').length - 5} more lines)`));
  }
  console.log(colors.dim('─'.repeat(60)));
  console.log();

  const answer = await createInteractiveSelect(rl,
    'Update your learning plan with this code?',
    [
      { label: 'No, continue with original plan', value: 'no' },
      { label: 'Yes, use the new code', value: 'yes' },
    ]
  );

  return answer === 'yes';
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
    } else {
      // Multi-line code block - parse into lines
      const codeLines = codeContent.split('\n');
      const multiLines: CodeLine[] = codeLines.map((line, idx) => ({
        comment: idx === 0 ? 'Type the code below' : '',  // Only first line gets a comment
        code: line
      }));
      return {
        code: codeContent,
        explanation: 'Type each line of code',
        isMultiLine: true,
        lines: multiLines
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
// NATURAL LANGUAGE DETECTION
// ============================================

/**
 * Detect if input looks like a natural language question rather than code
 * Used to let users ask questions while in code input mode
 */
function isNaturalLanguageQuestion(input: string, expectedCode: string): boolean {
  const trimmed = input.trim().toLowerCase();

  // Empty input is not a question
  if (!trimmed) return false;

  // If it matches the expected code closely, it's not a question
  if (input.trim() === expectedCode.trim()) return false;

  // Check for question patterns
  const questionPatterns = [
    /^(what|why|how|when|where|which|who|can|could|would|should|is|are|does|do|will)\s/i,
    /\?$/,  // Ends with question mark
    /^(help|explain|tell me|show me|i don't understand|i'm confused|what's|what is)/i,
    /^(wait|hold on|stop|actually)/i,  // User wants to pause
  ];

  for (const pattern of questionPatterns) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  // If the input is very different from expected code (no code-like characters)
  // and contains mostly words, it's likely natural language
  const hasCodeChars = /[{}();=<>[\]`"']/.test(input);
  const isAllWords = /^[a-zA-Z\s.,!?'-]+$/.test(trimmed);

  if (!hasCodeChars && isAllWords && trimmed.split(/\s+/).length >= 3) {
    // 3+ words with no code characters - likely a question/comment
    return true;
  }

  return false;
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
      process.stdout.write(colors.dim('› '));
      rl.once('line', resolve);
      return;
    }

    // Check mode - in discuss mode, skip Typer Shark and accept free input
    if (isDiscussMode()) {
      console.log(colors.dim(`  Expected: ${expectedText}`));
      process.stdout.write(colors.dim('› '));
      rl.once('line', resolve);
      return;
    }

    // Initialize display
    initTyperSharkDisplay(expectedText, explanation || undefined);

    let inputBuffer = '';
    let correctCount = 0;

    // Escape sequence buffer for handling Shift+Tab etc.
    let escapeBuffer = '';
    let escapeTimeout: NodeJS.Timeout | null = null;

    // Enable raw mode for character-by-character input
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.pause(); // Stop receiving data during transition
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handleKeypress);
      if (escapeTimeout) clearTimeout(escapeTimeout);
    };

    const processKey = (key: string) => {
      // Ctrl+C - exit
      if (key === '\x03') {
        cleanup();
        console.log('\n');
        process.exit(0);
      }

      // Shift+Tab - cycle mode
      if (key === '\x1b[Z') {
        cycleMode();
        // Immediately redraw with new mode (mode footer will update)
        redrawTyperShark(expectedText, inputBuffer, isBlockMode() ? inputBuffer.length : correctCount);
        return;
      }

      // Enter - submit input (only if correct in tutor mode)
      if (key === '\r' || key === '\n') {
        // In tutor mode, require exact match before allowing Enter
        if (isTutorMode()) {
          // Check if input matches expected text exactly
          if (inputBuffer !== expectedText) {
            // Don't allow submission - flash/indicate error
            // Just redraw to show current state (user needs to fix their input)
            redrawTyperShark(expectedText, inputBuffer, correctCount);
            return;
          }
        }
        // In block mode or when input is correct, allow submission
        cleanup();
        finishTyperSharkDisplay(inputBuffer, !!explanation); // Clear display and show entered text
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
          redrawTyperShark(expectedText, inputBuffer, isBlockMode() ? inputBuffer.length : correctCount);
        }
        return;
      }

      // Ignore lone escape
      if (key === '\x1b') {
        return;
      }

      // Ignore Tab (only Shift+Tab cycles mode)
      if (key === '\t') {
        return;
      }

      // Regular character
      if (key.length === 1 && key >= ' ') {
        inputBuffer += key;

        // In block mode, all characters count as "correct" (free typing)
        if (isBlockMode()) {
          correctCount = inputBuffer.length;
        } else {
          // Tutor mode: Only increment correctCount if character matches expected
          const newCharPos = inputBuffer.length - 1;
          if (newCharPos === correctCount && correctCount < expectedText.length && key === expectedText[correctCount]) {
            correctCount++;
          }
        }

        redrawTyperShark(expectedText, inputBuffer, correctCount);
      }
    };

    const handleKeypress = (chunk: Buffer) => {
      const data = chunk.toString();

      // Handle escape sequences properly
      for (const char of data) {
        if (escapeBuffer.length > 0) {
          escapeBuffer += char;
          // Check if we have a complete escape sequence
          if (escapeBuffer.length >= 3) {
            if (escapeTimeout) clearTimeout(escapeTimeout);
            processKey(escapeBuffer);
            escapeBuffer = '';
          }
        } else if (char === '\x1b') {
          escapeBuffer = char;
          if (escapeTimeout) clearTimeout(escapeTimeout);
          escapeTimeout = setTimeout(() => {
            if (escapeBuffer === '\x1b') processKey('\x1b');
            escapeBuffer = '';
          }, 50);
        } else {
          processKey(char);
        }
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}

/**
 * Multi-line Typer Shark input for heredocs and multi-line code
 * Shows the ENTIRE code block with progress tracking
 * User types each line, pressing Enter advances to the next line
 * Completed lines turn green, current line is highlighted in input area
 *
 * @param rl - readline interface
 * @param lines - array of code lines with comments
 * @param explanation - brief explanation shown at the start
 * @param linesToClear - number of previously streamed lines to clear
 */
export async function createMultiLineTyperSharkInput(
  rl: readline.Interface,
  lines: CodeLine[],
  explanation?: string,
  linesToClear: number = 0
): Promise<string[]> {
  const results: string[] = [];
  const totalLineCount = lines.length;

  // Filter out truly empty lines at start/end, but keep internal empty lines
  // (they represent intentional blank lines in code)
  const filteredLines = lines.filter((line, idx) => {
    // Keep non-empty lines
    if (line.code.trim() !== '') return true;
    // Keep empty lines that are between non-empty lines
    const hasBefore = lines.slice(0, idx).some(l => l.code.trim() !== '');
    const hasAfter = lines.slice(idx + 1).some(l => l.code.trim() !== '');
    return hasBefore && hasAfter;
  });

  // If all lines were empty, just return empty results
  if (filteredLines.length === 0) {
    return [];
  }

  // Clear raw streamed output first
  if (linesToClear > 0) {
    clearForTyperShark(linesToClear);
  }

  // Initialize the multi-line display showing ALL code at once
  initMultiLineCodeBlock(filteredLines, explanation);

  // Process each line
  for (let i = 0; i < filteredLines.length; i++) {
    const line = filteredLines[i];
    const expectedCode = line.code;

    // Handle empty lines (internal blank lines) - auto-complete them
    if (expectedCode.trim() === '') {
      results.push('');
      // Redraw with this line completed
      redrawMultiLineCodeBlock(filteredLines, i + 1, results, '');
      continue;
    }

    // Use the multi-line input handler for this line
    const result = await createMultiLineLineInput(
      rl,
      filteredLines,
      i,
      results,
      expectedCode
    );

    // Check if user asked a question
    if (isNaturalLanguageQuestion(result, expectedCode)) {
      finishMultiLineCodeBlock(filteredLines.length, !!explanation);
      return ['__QUESTION__:' + result];
    }

    results.push(result);
  }

  // Clean up display and show completion
  finishMultiLineCodeBlock(filteredLines.length, !!explanation);
  console.log(colors.success('✓ All lines entered!'));
  return results;
}

/**
 * Get the maximum width available for code display
 * Accounts for line number prefix "NN│ " (4 chars)
 */
function getCodeDisplayWidth(): number {
  const termWidth = process.stdout.columns || 80;
  const prefixWidth = 4; // "NN│ "
  return termWidth - prefixWidth - 1; // -1 for safety margin
}

/**
 * Wrap a code line to fit terminal width, returning array of lines
 * First line has no indent, continuation lines have indent
 */
function wrapCodeLine(code: string, maxWidth: number): string[] {
  if (code.length <= maxWidth) return [code];

  const lines: string[] = [];
  let remaining = code;
  const continuationIndent = '    '; // 4 spaces for continuation

  // First line gets full width
  lines.push(remaining.slice(0, maxWidth));
  remaining = remaining.slice(maxWidth);

  // Continuation lines get width minus indent
  const contWidth = maxWidth - continuationIndent.length;
  while (remaining.length > 0) {
    if (remaining.length <= contWidth) {
      lines.push(continuationIndent + remaining);
      break;
    }
    lines.push(continuationIndent + remaining.slice(0, contWidth));
    remaining = remaining.slice(contWidth);
  }

  return lines;
}

/**
 * Calculate total visual lines for a code block (accounting for wrapping)
 */
function getWrappedLineCount(lines: CodeLine[], codeWidth: number): number {
  let total = 0;
  for (const line of lines) {
    total += wrapCodeLine(line.code, codeWidth).length;
  }
  return total;
}

/**
 * Initialize multi-line code block display
 * Shows entire code block with line numbers, wrapping long lines
 */
function initMultiLineCodeBlock(lines: CodeLine[], explanation?: string): void {
  const codeWidth = getCodeDisplayWidth();

  // Calculate total visual lines needed (accounting for wrapping)
  const wrappedTotal = getWrappedLineCount(lines, codeWidth);

  // Add buffer lines to prevent scroll issues
  const bufferLines = wrappedTotal + 10;
  for (let i = 0; i < bufferLines; i++) {
    console.log();
  }
  process.stdout.write(`\x1B[${bufferLines}A`);

  // Show explanation if provided
  if (explanation) {
    // Wrap explanation too if needed
    const explainWidth = codeWidth - 3; // -3 for "// "
    if (explanation.length <= explainWidth) {
      console.log(colors.dim(`  // ${explanation}`));
    } else {
      const explainLines = wrapCodeLine(explanation, explainWidth);
      explainLines.forEach((line, idx) => {
        console.log(colors.dim(idx === 0 ? `  // ${line}` : `     ${line}`));
      });
    }
  }

  // Show all code lines (all tan initially) - wrapped to fit terminal
  for (let i = 0; i < lines.length; i++) {
    const lineNum = String(i + 1).padStart(2, ' ');
    const wrappedLines = wrapCodeLine(lines[i].code, codeWidth);

    wrappedLines.forEach((wrappedLine, wIdx) => {
      if (wIdx === 0) {
        console.log(colors.dim(`${lineNum}│ `) + colors.tan(wrappedLine));
      } else {
        // Continuation lines: show "  │ " prefix for visual alignment
        console.log(colors.dim(`  │ `) + colors.tan(wrappedLine));
      }
    });
  }

  // Separator bar
  console.log(drawBar());

  // Input area - show first line prompt
  console.log(colors.dim(' 1│ '));

  // Bottom bar
  console.log(drawBar());

  // Mode footer
  displayModeFooter();

  // Move cursor to input line (3 up: after footer newline -> footer -> bottom bar -> input)
  process.stdout.write('\x1B[3A');
  process.stdout.write('\r' + colors.dim(' 1│ '));
}

/**
 * Redraw multi-line code block with progress
 * @param lines - all code lines
 * @param completedCount - how many lines are completed
 * @param completedResults - the text user typed for completed lines
 * @param currentInput - current input being typed
 */
function redrawMultiLineCodeBlock(
  lines: CodeLine[],
  completedCount: number,
  completedResults: string[],
  currentInput: string
): void {
  if (!process.stdout.isTTY) return;

  const codeWidth = getCodeDisplayWidth();

  // Calculate total visual lines above cursor (accounting for wrapping)
  const wrappedTotal = getWrappedLineCount(lines, codeWidth);
  const linesAbove = wrappedTotal + 1; // wrapped code lines + separator

  // Move to top of code block
  process.stdout.write(`\x1B[${linesAbove}A`);

  // Redraw all code lines with progress coloring (wrapped to fit terminal)
  for (let i = 0; i < lines.length; i++) {
    const lineNum = String(i + 1).padStart(2, ' ');
    const originalCode = lines[i].code;
    const wrappedLines = wrapCodeLine(originalCode, codeWidth);

    wrappedLines.forEach((wrappedLine, wIdx) => {
      process.stdout.write('\r\x1B[K');

      // Calculate character offset for this wrapped portion
      const charOffset = wIdx === 0 ? 0 : (codeWidth + (wIdx - 1) * (codeWidth - 4));

      if (i < completedCount) {
        // Completed line - show in green
        if (wIdx === 0) {
          process.stdout.write(colors.success(`${lineNum}│ `) + colors.success(wrappedLine));
        } else {
          process.stdout.write(colors.success(`  │ `) + colors.success(wrappedLine));
        }
      } else if (i === completedCount) {
        // Current line - show with partial progress
        const prefix = wIdx === 0 ? colors.primary(`${lineNum}│ `) : colors.primary(`  │ `);
        let lineOutput = prefix;

        // Color each character based on whether it matches
        for (let j = 0; j < wrappedLine.length; j++) {
          // Map wrapped position to original code position
          let origPos: number;
          if (wIdx === 0) {
            origPos = j;
          } else {
            // For continuation lines, calculate position in original string
            // First line: 0 to codeWidth-1
            // Second line: codeWidth to codeWidth + (codeWidth - 4) - 1, but wrappedLine has 4-char indent
            const continuationWidth = codeWidth - 4;
            origPos = codeWidth + (wIdx - 1) * continuationWidth + (j - 4); // -4 for indent
            if (j < 4) {
              // This is the indent, not actual code
              lineOutput += colors.tan(wrappedLine[j]);
              continue;
            }
          }

          if (origPos < currentInput.length && currentInput[origPos] === originalCode[origPos]) {
            lineOutput += colors.success(wrappedLine[j]);
          } else {
            lineOutput += colors.tan(wrappedLine[j]);
          }
        }
        process.stdout.write(lineOutput);
      } else {
        // Future line - show in tan
        if (wIdx === 0) {
          process.stdout.write(colors.dim(`${lineNum}│ `) + colors.tan(wrappedLine));
        } else {
          process.stdout.write(colors.dim(`  │ `) + colors.tan(wrappedLine));
        }
      }
      process.stdout.write('\x1B[1B'); // Move down
    });
  }

  // Redraw separator bar
  process.stdout.write('\r\x1B[K');
  process.stdout.write(drawBar());
  process.stdout.write('\x1B[1B');

  // Redraw input line - wrap if too long
  process.stdout.write('\r\x1B[K');
  const currentLineNum = String(completedCount + 1).padStart(2, ' ');
  const inputWrapped = wrapCodeLine(currentInput, codeWidth);
  // Show first line of input (or scroll to show end if very long)
  const displayInput = inputWrapped.length > 1
    ? '…' + currentInput.slice(-(codeWidth - 1)) // Show rightmost portion
    : currentInput;
  process.stdout.write(colors.dim(`${currentLineNum}│ `) + displayInput);
  process.stdout.write('\x1B[1B');

  // Redraw bottom bar
  process.stdout.write('\r\x1B[K');
  process.stdout.write(drawBar());
  process.stdout.write('\x1B[1B');

  // Redraw mode footer
  process.stdout.write('\r\x1B[K');
  displayModeFooterInline();

  // Move back to input line (2 up: footer -> bottom bar -> input)
  process.stdout.write('\x1B[2A');
  process.stdout.write('\r' + colors.dim(`${currentLineNum}│ `) + displayInput);
}

/**
 * Clean up multi-line code block display
 * Note: We use a generous estimate to ensure all wrapped lines are cleared
 */
function finishMultiLineCodeBlock(lineCount: number, hasExplanation: boolean): void {
  // Calculate total lines to clear (use generous estimate for wrapped lines)
  // Each code line could wrap to multiple visual lines, so multiply by 3 for safety
  // code lines * 3 (for wrapping) + separator + input + bottom bar + footer + explanation
  const totalLines = lineCount * 3 + 4 + (hasExplanation ? 2 : 0);

  // Move up to top
  process.stdout.write(`\x1B[${totalLines - 1}A`);

  // Clear all lines
  for (let i = 0; i < totalLines; i++) {
    process.stdout.write('\r\x1B[K');
    if (i < totalLines - 1) {
      process.stdout.write('\x1B[1B');
    }
  }

  // Move back to top
  process.stdout.write(`\x1B[${totalLines - 1}A`);
}

/**
 * Handle input for a single line within the multi-line code block
 */
function createMultiLineLineInput(
  rl: readline.Interface,
  allLines: CodeLine[],
  currentLineIndex: number,
  completedResults: string[],
  expectedText: string
): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      rl.once('line', resolve);
      return;
    }

    // Initial draw
    redrawMultiLineCodeBlock(allLines, currentLineIndex, completedResults, '');

    let inputBuffer = '';
    let correctCount = 0;
    let escapeBuffer = '';
    let escapeTimeout: NodeJS.Timeout | null = null;

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.pause();
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handleKeypress);
      if (escapeTimeout) clearTimeout(escapeTimeout);
    };

    const processKey = (key: string) => {
      // Ctrl+C - exit
      if (key === '\x03') {
        cleanup();
        console.log('\n');
        process.exit(0);
      }

      // Shift+Tab - cycle mode
      if (key === '\x1b[Z') {
        cycleMode();
        redrawMultiLineCodeBlock(allLines, currentLineIndex, completedResults, inputBuffer);
        return;
      }

      // Enter - always submit line (let Claude catch any errors)
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(inputBuffer);
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (inputBuffer.length > 0) {
          if (correctCount > 0 && correctCount === inputBuffer.length) {
            correctCount--;
          }
          inputBuffer = inputBuffer.slice(0, -1);
          redrawMultiLineCodeBlock(allLines, currentLineIndex, completedResults, inputBuffer);
        }
        return;
      }

      // Ignore lone escape
      if (key === '\x1b') return;

      // Ignore Tab
      if (key === '\t') return;

      // Regular character
      if (key.length === 1 && key >= ' ') {
        inputBuffer += key;

        if (isBlockMode()) {
          correctCount = inputBuffer.length;
        } else {
          const newCharPos = inputBuffer.length - 1;
          if (newCharPos === correctCount && correctCount < expectedText.length && key === expectedText[correctCount]) {
            correctCount++;
          }
        }

        redrawMultiLineCodeBlock(allLines, currentLineIndex, completedResults, inputBuffer);
      }
    };

    const handleKeypress = (chunk: Buffer) => {
      const data = chunk.toString();
      for (const char of data) {
        if (escapeBuffer.length > 0) {
          escapeBuffer += char;
          if (escapeBuffer.length >= 3) {
            if (escapeTimeout) clearTimeout(escapeTimeout);
            processKey(escapeBuffer);
            escapeBuffer = '';
          }
        } else if (char === '\x1b') {
          escapeBuffer = char;
          if (escapeTimeout) clearTimeout(escapeTimeout);
          escapeTimeout = setTimeout(() => {
            if (escapeBuffer === '\x1b') processKey('\x1b');
            escapeBuffer = '';
          }, 50);
        } else {
          processKey(char);
        }
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}

/**
 * Create free-form input for discuss and code modes
 * Uses raw mode to support shift+tab for mode cycling
 * No Typer Shark tracking - just regular terminal input with mode support
 * @param hint - Optional hint text to show above input (e.g., "Press Enter to continue")
 */
export function createFreeFormInput(
  rl: readline.Interface,
  expectedCode?: string | null,
  hint?: string | null
): Promise<string> {
  return new Promise((resolve) => {
    // Non-TTY fallback
    if (!process.stdin.isTTY) {
      process.stdout.write(colors.dim('› '));
      const readline = require('readline');
      const simpleRl = readline.createInterface({ input: process.stdin, output: process.stdout });
      simpleRl.once('line', (answer: string) => {
        simpleRl.close();
        resolve(answer);
      });
      return;
    }

    let inputBuffer = '';

    // Escape sequence buffer for handling Shift+Tab
    let escapeBuffer = '';
    let escapeTimeout: NodeJS.Timeout | null = null;

    // Track current display lines for proper redraw on mode switch
    // Structure: top bar, [hint], [expected code if block mode], input line, bottom bar, mode footer
    let currentDisplayLines = 4; // Default: top bar + input + bottom bar + mode footer
    if (hint) currentDisplayLines += 1; // hint line
    if (expectedCode && isBlockMode()) currentDisplayLines += 1; // expected code line

    // Initialize display
    console.log(drawBar());

    // Show hint if provided (e.g., "Press Enter to continue")
    if (hint) {
      console.log(colors.dim(`  ${hint}`));
    }

    // Show expected code as reference in code mode
    if (expectedCode && isBlockMode()) {
      console.log(colors.dim(`  Expected: ${expectedCode}`));
    }

    // Input line with gray caret
    process.stdout.write(colors.dim('› '));
    // Draw bottom bar and mode footer below, then move cursor back to input line
    // Note: We don't use cursor save/restore because it can be unreliable when terminal scrolls
    console.log();  // newline after input line
    console.log(drawBar());  // bottom bar
    console.log(getModeIndicator());  // mode indicator
    // Move cursor up 3 lines (from after mode indicator to input line) and to column 3 (after "› ")
    process.stdout.write('\x1B[3A\x1B[3G');

    // Calculate new display lines based on current mode
    const getNewTotalLines = () => {
      let lines = 4; // top bar + input + bottom bar + mode footer
      if (hint) lines += 1; // hint line
      if (expectedCode && isBlockMode()) lines += 1; // expected code line
      return lines;
    };

    const redraw = () => {
      const newTotalLines = getNewTotalLines();

      // Use MAX of current and new lines to ensure we clear everything
      const linesToClear = Math.max(currentDisplayLines, newTotalLines);

      // Cursor is on input line. Calculate lines ABOVE cursor to reach top of display.
      // Structure: top bar, [expected code if block mode], INPUT LINE (cursor here), bottom bar, mode footer
      // Lines above cursor = total - 3 (input + bottom + footer are at or below cursor)
      const linesAboveCursor = currentDisplayLines - 3;

      // Move to top of current display (from input line to top bar)
      process.stdout.write(`\x1B[${linesAboveCursor}A`);

      // Clear all lines (use max to handle mode changes)
      for (let i = 0; i < linesToClear; i++) {
        process.stdout.write('\r\x1B[K\n');
      }
      process.stdout.write(`\x1B[${linesToClear}A`);

      // Top bar
      console.log(drawBar());

      // Show hint if provided
      if (hint) {
        console.log(colors.dim(`  ${hint}`));
      }

      // Show expected code as reference in code mode
      if (expectedCode && isBlockMode()) {
        console.log(colors.dim(`  Expected: ${expectedCode}`));
      }

      // Input line with gray caret
      process.stdout.write(colors.dim('› ') + inputBuffer);
      // Draw bottom bar and mode footer below, then move cursor back to input line
      // Note: We don't use cursor save/restore because it can be unreliable when terminal scrolls
      console.log();  // newline after input line
      console.log(drawBar());  // bottom bar
      console.log(getModeIndicator());  // mode indicator
      // Move cursor up 3 lines (from after mode indicator to input line) and to correct column
      // Column is 3 (for "› ") plus inputBuffer length
      const cursorCol = 3 + inputBuffer.length;
      process.stdout.write(`\x1B[3A\x1B[${cursorCol}G`);

      // Update tracked display lines for next redraw
      currentDisplayLines = newTotalLines;
    };

    // Enable raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.pause(); // Stop receiving data during transition
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handleKeypress);
      if (escapeTimeout) clearTimeout(escapeTimeout);
    };

    const processKey = (key: string) => {
      // Ctrl+C - exit
      if (key === '\x03') {
        cleanup();
        console.log('\n');
        process.exit(0);
      }

      // Shift+Tab - cycle mode
      if (key === '\x1b[Z') {
        cycleMode();
        redraw();
        return;
      }

      // Enter - submit
      if (key === '\r' || key === '\n') {
        cleanup();
        // Clear the entire display before returning
        // Use tracked currentDisplayLines to handle mode changes correctly
        // Calculate lines from input line to top bar
        // Structure: top bar, [expected code if block mode], input line, bottom bar, mode footer
        const linesToTop = currentDisplayLines - 3; // everything above input line (total - input - bottom bar - footer)
        // Move cursor to top of display
        process.stdout.write(`\x1B[${linesToTop}A`);
        // Clear all display lines
        for (let i = 0; i < currentDisplayLines; i++) {
          process.stdout.write('\r\x1B[K\n');
        }
        // Move back up to where display started
        process.stdout.write(`\x1B[${currentDisplayLines}A`);
        resolve(inputBuffer);
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          // Simple redraw of input line
          process.stdout.write('\r\x1B[K' + colors.dim('› ') + inputBuffer);
        }
        return;
      }

      // Ignore lone escape
      if (key === '\x1b') {
        return;
      }

      // Ignore Tab (only Shift+Tab cycles mode)
      if (key === '\t') {
        return;
      }

      // Regular character
      if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) < 127) {
        inputBuffer += key;
        process.stdout.write(key);
      }
    };

    const handleKeypress = (chunk: Buffer) => {
      const data = chunk.toString();

      for (const char of data) {
        if (escapeBuffer.length > 0) {
          escapeBuffer += char;
          if (escapeBuffer.length >= 3) {
            if (escapeTimeout) clearTimeout(escapeTimeout);
            processKey(escapeBuffer);
            escapeBuffer = '';
          }
        } else if (char === '\x1b') {
          escapeBuffer = char;
          if (escapeTimeout) clearTimeout(escapeTimeout);
          escapeTimeout = setTimeout(() => {
            if (escapeBuffer === '\x1b') processKey('\x1b');
            escapeBuffer = '';
          }, 50);
        } else {
          processKey(char);
        }
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}
