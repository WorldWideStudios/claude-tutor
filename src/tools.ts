import { execSync } from 'child_process';
import { z } from 'zod';
import { runGitCommand } from './git.js';
import type { ToolResult } from './types.js';

// Tool schemas for MCP server registration

export const verifySyntaxSchema = z.object({
  filepath: z.string().describe('Path to the file to verify')
});

export const conductCodeReviewSchema = z.object({
  readability_score: z.number().min(1).max(10).describe('Readability score 1-10'),
  maintainability_issue: z.string().describe('Specific maintainability issue found'),
  edge_case_missed: z.string().optional().describe('Edge case the user forgot to handle')
});

export const runGitCommandSchema = z.object({
  command: z.string().describe('The git command to run')
});

export const markSegmentCompleteSchema = z.object({
  summary: z.string().describe('Summary of what the user achieved'),
  next_hint: z.string().optional().describe('Hint for the next segment')
});

/**
 * Verify syntax of a file using tsc or node --check
 */
export function verifySyntax(filepath: string, cwd: string): ToolResult {
  try {
    let cmd: string;
    if (filepath.endsWith('.ts') || filepath.endsWith('.tsx')) {
      cmd = `npx tsc --noEmit "${filepath}"`;
    } else {
      cmd = `node --check "${filepath}"`;
    }

    execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return {
      success: true,
      output: JSON.stringify({ success: true })
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.stderr || error.message,
      output: JSON.stringify({
        success: false,
        error: error.stderr || error.message
      })
    };
  }
}

/**
 * Conduct a code review (tool for Claude to formalize its assessment)
 * This is a "signaling" tool - Claude calls it to record its review.
 */
export function conductCodeReview(
  readabilityScore: number,
  maintainabilityIssue: string,
  edgeCaseMissed?: string
): ToolResult {
  const review = {
    readability_score: readabilityScore,
    maintainability_issue: maintainabilityIssue,
    edge_case_missed: edgeCaseMissed,
    passes: readabilityScore >= 7 && maintainabilityIssue.toLowerCase().includes('none')
  };

  return {
    success: true,
    output: JSON.stringify(review)
  };
}

/**
 * Run a git command (wrapper for runGitCommand from git.ts)
 */
export function executeGitCommand(command: string, cwd: string): ToolResult {
  return runGitCommand(command, cwd);
}

/**
 * Mark a segment as complete
 * This is called after code passes review AND user has committed to Git
 */
export function markComplete(summary: string, nextHint?: string): ToolResult {
  return {
    success: true,
    output: JSON.stringify({
      completed: true,
      summary,
      next_hint: nextHint
    })
  };
}

// Tool definitions for MCP server
export const toolDefinitions = {
  verify_syntax: {
    name: 'verify_syntax',
    description: 'Check file for syntax errors. Call this first after user says "done".',
    schema: verifySyntaxSchema
  },
  conduct_code_review: {
    name: 'conduct_code_review',
    description: 'Critique code on engineering standards. Call AFTER verify_syntax passes.',
    schema: conductCodeReviewSchema
  },
  run_git_command: {
    name: 'run_git_command',
    description: 'Execute a git command. ONLY allows commands starting with "git".',
    schema: runGitCommandSchema
  },
  mark_segment_complete: {
    name: 'mark_segment_complete',
    description: 'Call when code passes syntax, engineering review, AND user committed.',
    schema: markSegmentCompleteSchema
  }
};
