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

      const lineComment = generateCodeComment(currentLine);
      codeBlockLines.push({
        comment: codeBlockLines.length === 0 && lineComment ? lineComment : '',
        code: currentLine
      });
      i++;
    }

    if (codeBlockLines.length > 0) {
      if (codeBlockLines.length === 1) {
        // Single line of code
        const singleLineComment = generateCodeComment(codeBlockLines[0].code);
        steps.push({
          type: 'code-block',
          code: codeBlockLines[0].code,
          comment: singleLineComment || '',
          lineNumber: blockStartLine
        });
      } else {
        // Multi-line code block - generate comment from first meaningful line
        const firstNonEmptyLine = codeBlockLines.find(l => l.code.trim());
        const blockComment = firstNonEmptyLine ? generateCodeComment(firstNonEmptyLine.code) : '';
        steps.push({
          type: 'code-block',
          code: codeBlockLines.map(l => l.code).join('\n'),
          comment: blockComment || '',
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
 * Generate a helpful comment for a code line
 */
function generateCodeComment(code: string): string {
  const trimmed = code.trim();

  // Shebang
  if (trimmed.startsWith('#!')) {
    if (trimmed.includes('node')) return 'shebang - tells shell to use Node.js';
    if (trimmed.includes('bash')) return 'shebang - tells shell to use Bash';
    if (trimmed.includes('python')) return 'shebang - tells shell to use Python';
    return 'shebang - tells shell which interpreter to use';
  }

  // Import statements
  if (trimmed.startsWith('import ')) {
    const match = trimmed.match(/import\s+(?:\{[^}]+\}|[\w*]+)\s+from\s+['"]([^'"]+)['"]/);
    if (match) return `imports from ${match[1]}`;
    const typeMatch = trimmed.match(/import\s+type\s+/);
    if (typeMatch) return 'imports TypeScript types';
    return 'imports a module';
  }

  // Require statements
  if (trimmed.startsWith('const ') && trimmed.includes('require(')) {
    const match = trimmed.match(/require\(['"]([^'"]+)['"]\)/);
    if (match) return `requires ${match[1]}`;
    return 'requires a module';
  }

  // Export statements
  if (trimmed.startsWith('export ')) {
    if (trimmed.includes('default')) return 'exports as default';
    if (trimmed.includes('function')) return 'exports a function';
    if (trimmed.includes('class')) return 'exports a class';
    if (trimmed.includes('const') || trimmed.includes('let')) return 'exports a variable';
    if (trimmed.includes('interface')) return 'exports a TypeScript interface';
    if (trimmed.includes('type')) return 'exports a TypeScript type';
    return 'exports from module';
  }

  // Function definitions
  if (trimmed.startsWith('function ') || trimmed.match(/^(async\s+)?function\s+/)) {
    const match = trimmed.match(/function\s+(\w+)/);
    if (match) return `defines function ${match[1]}`;
    return 'defines a function';
  }

  // Arrow functions with const/let
  if ((trimmed.startsWith('const ') || trimmed.startsWith('let ')) && trimmed.includes('=>')) {
    const match = trimmed.match(/(?:const|let)\s+(\w+)/);
    if (match) return `defines ${match[1]} function`;
    return 'defines an arrow function';
  }

  // Class definitions
  if (trimmed.startsWith('class ')) {
    const match = trimmed.match(/class\s+(\w+)/);
    if (match) return `defines class ${match[1]}`;
    return 'defines a class';
  }

  // Interface definitions
  if (trimmed.startsWith('interface ')) {
    const match = trimmed.match(/interface\s+(\w+)/);
    if (match) return `defines interface ${match[1]}`;
    return 'defines a TypeScript interface';
  }

  // Type definitions
  if (trimmed.startsWith('type ') && trimmed.includes('=')) {
    const match = trimmed.match(/type\s+(\w+)/);
    if (match) return `defines type ${match[1]}`;
    return 'defines a TypeScript type';
  }

  // Console.log
  if (trimmed.startsWith('console.log')) return 'logs output to console';
  if (trimmed.startsWith('console.error')) return 'logs error to console';
  if (trimmed.startsWith('console.warn')) return 'logs warning to console';

  // Return statement
  if (trimmed.startsWith('return ')) return 'returns a value';

  // Comments
  if (trimmed.startsWith('//')) return 'code comment';
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return 'code comment';

  // Variable declarations
  if (trimmed.startsWith('const ')) {
    const match = trimmed.match(/const\s+(\w+)/);
    if (match) return `declares constant ${match[1]}`;
    return 'declares a constant';
  }
  if (trimmed.startsWith('let ')) {
    const match = trimmed.match(/let\s+(\w+)/);
    if (match) return `declares variable ${match[1]}`;
    return 'declares a variable';
  }
  if (trimmed.startsWith('var ')) {
    const match = trimmed.match(/var\s+(\w+)/);
    if (match) return `declares variable ${match[1]}`;
    return 'declares a variable';
  }

  // Control flow
  if (trimmed.startsWith('if ') || trimmed.startsWith('if(')) return 'conditional statement';
  if (trimmed.startsWith('else if') || trimmed.startsWith('} else if')) return 'else-if condition';
  if (trimmed === 'else' || trimmed === '} else {' || trimmed.startsWith('else {')) return 'else block';
  if (trimmed.startsWith('for ') || trimmed.startsWith('for(')) return 'loop iteration';
  if (trimmed.startsWith('while ') || trimmed.startsWith('while(')) return 'while loop';
  if (trimmed.startsWith('switch ') || trimmed.startsWith('switch(')) return 'switch statement';
  if (trimmed.startsWith('case ')) return 'switch case';
  if (trimmed === 'break;') return 'breaks out of loop/switch';
  if (trimmed === 'continue;') return 'continues to next iteration';

  // Try/catch
  if (trimmed.startsWith('try ') || trimmed === 'try {') return 'try block - handles errors';
  if (trimmed.startsWith('catch') || trimmed.startsWith('} catch')) return 'catch block - handles errors';
  if (trimmed.startsWith('finally') || trimmed.startsWith('} finally')) return 'finally block - always runs';
  if (trimmed.startsWith('throw ')) return 'throws an error';

  // Async/await
  if (trimmed.startsWith('async ')) return 'async function';
  if (trimmed.includes('await ')) return 'awaits async operation';

  // Just brackets
  if (trimmed === '{') return 'opens block';
  if (trimmed === '}' || trimmed === '};') return 'closes block';
  if (trimmed === '},' || trimmed === '},') return 'closes block';

  // Empty/whitespace-only
  if (!trimmed) return '';

  return '';  // No generic fallback - let display handle it
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
