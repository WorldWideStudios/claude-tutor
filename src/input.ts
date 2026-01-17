import * as readline from 'readline';
import {
  setExpectedText,
  clearExpectedText,
  getExpectedText,
  displayTargetLine,
  initTyperSharkDisplay,
  redrawTyperShark,
  finishTyperSharkDisplay,
  drawBar,
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

    // Calculate lines for a question display
    const getQuestionDisplayLines = (qIdx: number): number => {
      const q = questions[qIdx];
      let total = 1; // top bar
      total += 1; // progress line
      total += wordWrap(q.question, termWidth - 1).length;
      q.options.forEach((opt) => {
        const prefix = '  1. ';
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

      // Options
      q.options.forEach((opt, i) => {
        const num = `${i + 1}.`;
        const prefix = i === selectedIdx ? `› ${num} ` : `  ${num} `;
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
      const navHint = currentQuestionIndex === 0
        ? '↑↓ select • Enter confirm • → next'
        : currentQuestionIndex === questions.length - 1
          ? '↑↓ select • Enter confirm • ← back'
          : '↑↓ select • Enter confirm • ←→ navigate';
      console.log(colors.dim(`  ${navHint}`));

      // Bottom bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());
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
        const answerLabel = q.options.find(o => o.value === answers[i])?.label || answers[i] || '(no answer)';

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
    };

    const redrawQuestion = () => {
      const totalLines = getQuestionDisplayLines(currentQuestionIndex);
      process.stdout.write(`\x1B[${totalLines}A`);
      drawQuestion();
    };

    const redrawSummary = () => {
      const totalLines = getSummaryDisplayLines();
      process.stdout.write(`\x1B[${totalLines}A`);
      drawSummary();
    };

    // Initial draw
    drawQuestion();

    // Enable raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let escapeBuffer = '';
    let escapeTimeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', handleKeypress);
      if (escapeTimeout) clearTimeout(escapeTimeout);
    };

    const processKey = (key: string) => {
      if (key === '\x03') {
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
            drawSummary(true);
            drawQuestion();
          }
        }
        return;
      }

      // Question mode
      const q = questions[currentQuestionIndex];

      if (key === '\x1b[A' || key === '\x1bOA') {
        // Up arrow - select previous option
        selectedIndices[currentQuestionIndex] = (selectedIndices[currentQuestionIndex] - 1 + q.options.length) % q.options.length;
        redrawQuestion();
      } else if (key === '\x1b[B' || key === '\x1bOB') {
        // Down arrow - select next option
        selectedIndices[currentQuestionIndex] = (selectedIndices[currentQuestionIndex] + 1) % q.options.length;
        redrawQuestion();
      } else if (key === '\x1b[D' || key === '\x1bOD') {
        // Left arrow - go to previous question
        if (currentQuestionIndex > 0) {
          const prevLines = getQuestionDisplayLines(currentQuestionIndex);
          currentQuestionIndex--;
          const newLines = getQuestionDisplayLines(currentQuestionIndex);
          // Clear and redraw
          process.stdout.write(`\x1B[${prevLines}A`);
          for (let i = 0; i < Math.max(prevLines, newLines); i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          process.stdout.write(`\x1B[${Math.max(prevLines, newLines)}A`);
          drawQuestion();
        }
      } else if (key === '\x1b[C' || key === '\x1bOC') {
        // Right arrow - go to next question (if answered)
        if (currentQuestionIndex < questions.length - 1 && answers[currentQuestionIndex] !== null) {
          const prevLines = getQuestionDisplayLines(currentQuestionIndex);
          currentQuestionIndex++;
          const newLines = getQuestionDisplayLines(currentQuestionIndex);
          process.stdout.write(`\x1B[${prevLines}A`);
          for (let i = 0; i < Math.max(prevLines, newLines); i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          process.stdout.write(`\x1B[${Math.max(prevLines, newLines)}A`);
          drawQuestion();
        }
      } else if (key === '\r' || key === '\n') {
        // Enter - confirm selection
        answers[currentQuestionIndex] = q.options[selectedIndices[currentQuestionIndex]].value;

        if (currentQuestionIndex < questions.length - 1) {
          // Move to next question
          const prevLines = getQuestionDisplayLines(currentQuestionIndex);
          currentQuestionIndex++;
          const newLines = getQuestionDisplayLines(currentQuestionIndex);
          process.stdout.write(`\x1B[${prevLines}A`);
          for (let i = 0; i < Math.max(prevLines, newLines); i++) {
            process.stdout.write('\r\x1B[K\n');
          }
          process.stdout.write(`\x1B[${Math.max(prevLines, newLines)}A`);
          drawQuestion();
        } else {
          // Last question - show summary
          showingSummary = true;
          summarySelectedIndex = questions.length; // Default to Submit
          drawSummary(true);
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

    // Enable raw mode
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Buffer for escape sequence handling
    let escapeBuffer = '';
    let escapeTimeout: NodeJS.Timeout | null = null;

    const cleanup = () => {
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
 * Create terminal-style multi-line input for heredocs
 * Works like a real terminal: each line stays visible after enter,
 * with a `> ` continuation prompt for each new line.
 * Gray bars above and below create the entry field look.
 */
export function createMultiLineTyperSharkInput(
  _rl: readline.Interface,
  lines: CodeLine[]
): Promise<string[]> {
  return new Promise((resolve) => {
    // Non-TTY fallback
    if (!process.stdin.isTTY) {
      console.log(colors.dim('Enter each line:'));
      const results: string[] = [];
      const readline = require('readline');
      const simpleRl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const collectSimple = (idx: number) => {
        if (idx >= lines.length) {
          simpleRl.close();
          resolve(results);
          return;
        }
        simpleRl.question(`> `, (answer: string) => {
          results.push(answer);
          collectSimple(idx + 1);
        });
      };
      collectSimple(0);
      return;
    }

    const completedLines: string[] = [];
    let currentLineIndex = 0;
    let inputBuffer = '';

    // Add some spacing before the display instead of aggressive clearing
    // The raw streamed output is handled by the display layer now
    console.log();

    // Draw the full display
    const redraw = () => {
      // Calculate how many lines we need to clear and redraw
      // Structure: top bar, hint (2 lines), completed lines, current input, bottom bar
      const totalLines = 2 + 2 + completedLines.length + 1 + 1; // bar + hint + completed + input + bar

      // Move to top and clear everything
      if (completedLines.length > 0 || inputBuffer.length > 0) {
        process.stdout.write(`\x1B[${totalLines}A`); // Move up
      }

      // Top gray bar
      process.stdout.write('\r\x1B[K');
      console.log(drawBar());

      // Hint for current line (comment + expected code)
      const currentLine = lines[currentLineIndex];
      process.stdout.write('\r\x1B[K');
      console.log(colors.dim(`  // ${currentLine.comment}`));
      process.stdout.write('\r\x1B[K');
      console.log(colors.dim(`  ${currentLine.code}`));

      // Show all completed lines
      for (let i = 0; i < completedLines.length; i++) {
        process.stdout.write('\r\x1B[K');
        const expected = lines[i].code;
        const enteredLine = completedLines[i];
        const isCorrect = enteredLine === expected;
        console.log(colors.success('> ') + (isCorrect ? colors.success(enteredLine) : chalk.white(enteredLine)));
      }

      // Current input line
      process.stdout.write('\r\x1B[K');
      process.stdout.write(colors.success('> ') + inputBuffer);

      // Save cursor position, draw bottom bar, restore cursor
      process.stdout.write('\x1B[s'); // Save cursor
      console.log(); // Move to next line
      process.stdout.write('\r\x1B[K');
      process.stdout.write(drawBar());
      process.stdout.write('\x1B[u'); // Restore cursor
    };

    // Initial draw
    console.log(drawBar()); // Top bar
    const currentLine = lines[currentLineIndex];
    console.log(colors.dim(`  // ${currentLine.comment}`));
    console.log(colors.dim(`  ${currentLine.code}`));
    process.stdout.write(colors.success('> '));
    process.stdout.write('\x1B[s'); // Save cursor
    console.log(); // Move to next line for bottom bar
    console.log(drawBar()); // Bottom bar
    process.stdout.write('\x1B[u'); // Restore cursor to input line

    // Enable raw mode
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

      // Enter - submit current line
      if (key === '\r' || key === '\n') {
        completedLines.push(inputBuffer);
        inputBuffer = '';
        currentLineIndex++;

        // Check if done
        if (currentLineIndex >= lines.length) {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', handleKeypress);

          // Final redraw showing all completed lines
          const totalLines = 2 + 2 + completedLines.length + 1; // bar + hint + completed + bar
          process.stdout.write(`\x1B[${totalLines}A`); // Move up

          // Clear and redraw final state
          process.stdout.write('\r\x1B[K');
          console.log(drawBar());

          // Show all completed lines (no more hint since we're done)
          for (let i = 0; i < completedLines.length; i++) {
            process.stdout.write('\r\x1B[K');
            const expected = lines[i].code;
            const enteredLine = completedLines[i];
            const isCorrect = enteredLine === expected;
            console.log(colors.success('> ') + (isCorrect ? colors.success(enteredLine) : chalk.white(enteredLine)));
          }

          process.stdout.write('\r\x1B[K');
          console.log(drawBar());
          process.stdout.write('\r\x1B[K');
          console.log(); // Blank line
          process.stdout.write('\r\x1B[K');
          console.log(colors.success('✓ All lines entered!'));

          resolve(completedLines);
          return;
        }

        // Redraw with new line
        redraw();
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          // Just update the current input line
          process.stdout.write('\r\x1B[K');
          process.stdout.write(colors.success('> ') + inputBuffer);
        }
        return;
      }

      // Regular character - only printable ASCII
      if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) < 127) {
        inputBuffer += key;
        // Just update the current input line
        process.stdout.write('\r\x1B[K');
        process.stdout.write(colors.success('> ') + inputBuffer);
      }
    };

    process.stdin.on('data', handleKeypress);
  });
}
