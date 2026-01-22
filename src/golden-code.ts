/**
 * GoldenCode Parser Module
 * Parses curriculum goldenCode into typeable steps for Typer Shark mode
 */

import type { CodeLine, ExtractedCode } from './input.js';

export interface GoldenCodeStep {
  type: 'command' | 'heredoc' | 'code-block';
  code: string;
  comment: string;
  lines?: CodeLine[];  // For multi-line heredocs
  lineNumber: number;
}

export interface ParsedGoldenCode {
  steps: GoldenCodeStep[];
  totalSteps: number;
  rawCode: string;
}

/**
 * Parse goldenCode into individual typeable steps
 */
export function parseGoldenCode(goldenCode: string): ParsedGoldenCode {
  const steps: GoldenCodeStep[] = [];
  const lines = goldenCode.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      i++;
      continue;
    }

    // Detect heredoc: cat > file << 'EOF' or cat > file << EOF
    const heredocMatch = line.match(/^cat\s+>\s*(\S+)\s*<<\s*['"]?(\w+)['"]?$/);
    if (heredocMatch) {
      const filename = heredocMatch[1];
      const delimiter = heredocMatch[2];
      const heredocLines: CodeLine[] = [];
      const startLine = i;
      i++;

      // Collect lines until delimiter
      while (i < lines.length && lines[i].trim() !== delimiter) {
        heredocLines.push({
          comment: heredocLines.length === 0 ? `creates ${filename}` : '',
          code: lines[i]
        });
        i++;
      }
      i++; // Skip delimiter

      steps.push({
        type: 'heredoc',
        code: `cat > ${filename} << '${delimiter}'\n${heredocLines.map(l => l.code).join('\n')}\n${delimiter}`,
        comment: `creates ${filename}`,
        lines: heredocLines,
        lineNumber: startLine
      });
      continue;
    }

    // Detect shell commands
    const commandPrefixes = ['mkdir', 'cat', 'echo', 'touch', 'git', 'npm', 'npx', 'node', 'tsc', 'cd', 'ls', 'pwd', 'chmod', 'rm', 'mv', 'cp'];
    const isCommand = commandPrefixes.some(prefix => line.startsWith(prefix + ' ') || line === prefix);

    if (isCommand) {
      steps.push({
        type: 'command',
        code: line,
        comment: generateCommandComment(line),
        lineNumber: i
      });
      i++;
      continue;
    }

    // Multi-line code block (consecutive non-empty, non-command lines)
    const codeBlockLines: CodeLine[] = [];
    const blockStartLine = i;

    while (i < lines.length) {
      const currentLine = lines[i];
      const trimmedLine = currentLine.trim();

      // Stop at empty line or command
      if (!trimmedLine) break;
      const isNextCommand = commandPrefixes.some(prefix => trimmedLine.startsWith(prefix + ' ') || trimmedLine === prefix);
      if (isNextCommand) break;

      // Stop at heredoc
      if (trimmedLine.match(/^cat\s+>\s*\S+\s*<<\s*['"]?\w+['"]?$/)) break;

      codeBlockLines.push({
        comment: codeBlockLines.length === 0 ? 'Type the code' : '',
        code: currentLine
      });
      i++;
    }

    if (codeBlockLines.length > 0) {
      if (codeBlockLines.length === 1) {
        // Single line of code
        steps.push({
          type: 'code-block',
          code: codeBlockLines[0].code,
          comment: 'Type the code',
          lineNumber: blockStartLine
        });
      } else {
        // Multi-line code block
        steps.push({
          type: 'code-block',
          code: codeBlockLines.map(l => l.code).join('\n'),
          comment: 'Type each line of code',
          lines: codeBlockLines,
          lineNumber: blockStartLine
        });
      }
    }
  }

  return {
    steps,
    totalSteps: steps.length,
    rawCode: goldenCode
  };
}

/**
 * Generate a helpful comment for a command
 */
function generateCommandComment(command: string): string {
  if (command.startsWith('mkdir')) {
    const match = command.match(/mkdir\s+(?:-p\s+)?(\S+)/);
    return match ? `creates directory ${match[1]}` : 'creates directory';
  }
  if (command.startsWith('touch')) {
    const match = command.match(/touch\s+(\S+)/);
    return match ? `creates file ${match[1]}` : 'creates file';
  }
  if (command.startsWith('npm init')) return 'initializes npm project';
  if (command.startsWith('npm install') || command.startsWith('npm i ')) return 'installs dependencies';
  if (command.startsWith('npm run')) return 'runs npm script';
  if (command.startsWith('git init')) return 'initializes git repository';
  if (command.startsWith('git add')) return 'stages changes';
  if (command.startsWith('git commit')) return 'commits changes';
  if (command.startsWith('git push')) return 'pushes to remote';
  if (command.startsWith('npx')) return 'runs package command';
  if (command.startsWith('tsc')) return 'compiles TypeScript';
  if (command.startsWith('node')) return 'runs JavaScript';
  if (command.startsWith('cd')) return 'changes directory';

  return 'run this command';
}

/**
 * Convert a goldenCode step to ExtractedCode format for Typer Shark
 */
export function goldenCodeToExtractedCode(
  goldenCode: string,
  stepIndex: number
): ExtractedCode | null {
  const parsed = parseGoldenCode(goldenCode);

  if (stepIndex >= parsed.steps.length) {
    return null; // No more steps
  }

  const step = parsed.steps[stepIndex];

  if (step.type === 'heredoc' && step.lines) {
    return {
      code: step.code,
      explanation: step.comment,
      isMultiLine: true,
      lines: step.lines
    };
  }

  if (step.type === 'code-block' && step.lines && step.lines.length > 1) {
    return {
      code: step.code,
      explanation: step.comment,
      isMultiLine: true,
      lines: step.lines
    };
  }

  // Single line command or code
  return {
    code: step.code,
    explanation: step.comment,
    isMultiLine: false
  };
}

/**
 * Get the total number of steps in goldenCode
 */
export function getGoldenCodeStepCount(goldenCode: string): number {
  return parseGoldenCode(goldenCode).totalSteps;
}

/**
 * Check if there are more steps after the current one
 */
export function hasMoreGoldenSteps(goldenCode: string, currentIndex: number): boolean {
  const parsed = parseGoldenCode(goldenCode);
  return currentIndex < parsed.steps.length - 1;
}
