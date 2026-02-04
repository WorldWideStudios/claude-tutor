import { execSync } from 'child_process';
import type { Progress } from '../types.js';

/**
 * Result of executing a shell command
 */
export interface CommandResult {
  success: boolean;
  output: string;
}

/**
 * Heredoc state for multi-line commands
 */
interface HeredocState {
  active: boolean;
  delimiter: string;
  command: string;
  lines: string[];
}

/**
 * Manages shell command execution, heredoc parsing, and progress tracking.
 * Consolidates command detection, validation, execution, and result handling.
 */
export class CommandExecutor {
  private workingDir: string;
  private updateProgress: (workingDir: string, updates: any) => Promise<Progress>;
  private addCompletedStep: (workingDir: string, step: string) => Promise<Progress>;
  private heredocState: HeredocState;

  // Shell commands that should be executed directly
  private static readonly SHELL_COMMANDS = [
    'mkdir', 'cat', 'echo', 'touch', 'rm', 'mv', 'cp', 'ls', 'cd',
    'git', 'npm', 'npx', 'node', 'tsc', 'pwd', 'chmod', 'grep', 'find',
  ];

  constructor(
    workingDir: string,
    updateProgress: (workingDir: string, updates: any) => Promise<Progress>,
    addCompletedStep: (workingDir: string, step: string) => Promise<Progress>
  ) {
    this.workingDir = workingDir;
    this.updateProgress = updateProgress;
    this.addCompletedStep = addCompletedStep;
    this.heredocState = { active: false, delimiter: '', command: '', lines: [] };
  }

  /**
   * Check if input looks like a shell command
   */
  isShellCommand(input: string): boolean {
    const firstWord = input.trim().split(/\s+/)[0];
    return CommandExecutor.SHELL_COMMANDS.includes(firstWord);
  }

  /**
   * Check if command starts a heredoc
   */
  startsHeredoc(input: string): { isHeredoc: boolean; delimiter: string } {
    const heredocMatch = input.match(/<<\s*['"]?(\w+)['"]?\s*$/);
    if (heredocMatch) {
      return { isHeredoc: true, delimiter: heredocMatch[1] };
    }
    return { isHeredoc: false, delimiter: '' };
  }

  /**
   * Check if currently in heredoc mode
   */
  isHeredocActive(): boolean {
    return this.heredocState.active;
  }

  /**
   * Start heredoc mode
   */
  startHeredoc(command: string, delimiter: string): void {
    this.heredocState = {
      active: true,
      delimiter,
      command,
      lines: [],
    };
  }

  /**
   * Add a line to current heredoc
   */
  addHeredocLine(line: string): void {
    if (this.heredocState.active) {
      this.heredocState.lines.push(line);
    }
  }

  /**
   * Complete heredoc and execute the full command
   */
  async completeHeredoc(delimiter: string): Promise<CommandResult | null> {
    if (!this.heredocState.active || this.heredocState.delimiter !== delimiter) {
      return null;
    }

    const fullCommand = [
      this.heredocState.command,
      ...this.heredocState.lines,
      delimiter,
    ].join('\n');

    // Reset state before executing
    this.heredocState = { active: false, delimiter: '', command: '', lines: [] };

    // Execute the heredoc command
    const result = await this.executeCommand(fullCommand);

    // Update progress - heredoc usually means file creation
    if (result.success) {
      const fileName = this.extractFileName(fullCommand);
      await this.updateProgress(this.workingDir, {
        codeWritten: true,
        lastUserAction: `Created file: ${fileName}`,
      });
      await this.addCompletedStep(this.workingDir, `Created file: ${fileName}`);
    }

    return result;
  }

  /**
   * Get the current heredoc command being built (for display purposes)
   */
  getHeredocCommand(): string {
    if (!this.heredocState.active) return '';
    return [
      this.heredocState.command,
      ...this.heredocState.lines,
    ].join('\n');
  }

  /**
   * Reset heredoc state (useful for error handling)
   */
  resetHeredoc(): void {
    this.heredocState = { active: false, delimiter: '', command: '', lines: [] };
  }

  /**
   * Execute a shell command and return the result
   */
  async executeCommand(command: string): Promise<CommandResult> {
    try {
      const output = execSync(command, {
        cwd: this.workingDir,
        encoding: 'utf-8',
      });
      return { success: true, output: output.trim() };
    } catch (error: any) {
      return {
        success: false,
        output: error.stderr || error.stdout || error.message,
      };
    }
  }

  /**
   * Execute a command and update progress based on command type
   */
  async executeAndTrack(command: string): Promise<CommandResult> {
    const result = await this.executeCommand(command);

    if (result.success) {
      const updates: Partial<Progress> = {
        lastUserAction: command,
      };

      // Track specific actions
      if (command.startsWith('cat >') || command.includes('>> ')) {
        updates.codeWritten = true;
        const fileName = this.extractFileName(command);
        await this.addCompletedStep(
          this.workingDir,
          `Created/modified file: ${fileName}`
        );
      } else if (command.startsWith('git commit')) {
        updates.committed = true;
        await this.addCompletedStep(this.workingDir, 'Committed code to git');
      } else if (command.startsWith('mkdir')) {
        await this.addCompletedStep(this.workingDir, `Created directory: ${command}`);
      }

      await this.updateProgress(this.workingDir, updates);
    }

    return result;
  }

  /**
   * Extract filename from cat/echo/redirection commands
   */
  extractFileName(command: string): string {
    const fileMatch = command.match(/cat\s*>\s*(\S+)|echo.*>\s*(\S+)/);
    if (fileMatch) {
      return fileMatch[1] || fileMatch[2] || 'file';
    }
    return 'file';
  }

  /**
   * Format command result as message for agent
   */
  getMessageForAgent(command: string, result: CommandResult): string {
    if (result.success) {
      return `I ran: ${command}\nOutput: ${result.output || '(success)'}`;
    } else {
      return `I ran: ${command}\nError: ${result.output}`;
    }
  }
}
