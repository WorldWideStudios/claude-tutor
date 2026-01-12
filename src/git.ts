import { execSync } from 'child_process';
import type { ToolResult } from './types.js';

/**
 * Initialize a Git repository in the project directory.
 * Runs silently - the user doesn't need to know about this setup.
 */
export function initGitRepo(cwd: string): ToolResult {
  try {
    // Check if already a git repo
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd,
        encoding: 'utf-8',
        stdio: 'pipe'
      });
      // Already a git repo, that's fine
      return { success: true, output: 'Git repository already exists' };
    } catch {
      // Not a git repo, initialize it
    }

    // Initialize git repo
    execSync('git init', { cwd, stdio: 'ignore' });

    // Create initial .gitignore
    const gitignore = `node_modules/
dist/
.env
.DS_Store
`;
    require('fs').writeFileSync(`${cwd}/.gitignore`, gitignore);

    // Initial commit
    execSync('git add .', { cwd, stdio: 'ignore' });
    execSync('git commit -m "Initial project setup" --allow-empty', { cwd, stdio: 'ignore' });

    return { success: true, output: 'Git repository initialized' };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to initialize Git: ${error.message}`
    };
  }
}

/**
 * Run a git command (for the run_git_command tool).
 * Security: Only allows commands starting with 'git' and no shell chaining.
 */
export function runGitCommand(command: string, cwd: string): ToolResult {
  // Security: Only allow git commands
  const trimmedCommand = command.trim();
  if (!trimmedCommand.startsWith('git ')) {
    return {
      success: false,
      error: 'Only git commands are allowed'
    };
  }

  // Security: No shell chaining characters
  if (/[;&|`$]/.test(trimmedCommand)) {
    return {
      success: false,
      error: 'Special characters (;, &, |, `, $) are not allowed'
    };
  }

  try {
    const output = execSync(trimmedCommand, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return {
      success: true,
      output: output || 'Command executed successfully'
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.stderr || error.message
    };
  }
}
