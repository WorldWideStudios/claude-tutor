import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, ContentBlock, ToolUseBlock, TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { buildSystemPrompt } from './system-prompt.js';
import { verifySyntax, conductCodeReview, executeGitCommand, markComplete } from './tools.js';
// Storage imports removed - state management handled by caller
import type { Curriculum, Segment, TutorState } from './types.js';

// Lazy-initialize client to ensure env vars are loaded first
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// Tool definitions for Claude
const TOOL_DEFINITIONS = [
  {
    name: 'verify_syntax',
    description: 'Check file for syntax errors. Call this first after user says "done".',
    input_schema: {
      type: 'object' as const,
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file to verify'
        }
      },
      required: ['filepath']
    }
  },
  {
    name: 'conduct_code_review',
    description: 'Critique code on engineering standards. Call AFTER verify_syntax passes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        readability_score: {
          type: 'number',
          minimum: 1,
          maximum: 10,
          description: 'Readability score 1-10'
        },
        maintainability_issue: {
          type: 'string',
          description: 'Specific maintainability issue found, or "none" if passes'
        },
        edge_case_missed: {
          type: 'string',
          description: 'Edge case the user forgot to handle'
        }
      },
      required: ['readability_score', 'maintainability_issue']
    }
  },
  {
    name: 'run_git_command',
    description: 'Execute a git command. ONLY allows commands starting with "git".',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The git command to run'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'mark_segment_complete',
    description: 'Call when code passes syntax, engineering review, AND user committed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'Summary of what the user achieved'
        },
        next_hint: {
          type: 'string',
          description: 'Hint for the next segment'
        }
      },
      required: ['summary']
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file to verify user\'s code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file to read'
        }
      },
      required: ['filepath']
    }
  }
];

interface ToolInput {
  filepath?: string;
  readability_score?: number;
  maintainability_issue?: string;
  edge_case_missed?: string;
  command?: string;
  summary?: string;
  next_hint?: string;
}

/**
 * Handle tool calls from Claude
 */
function handleToolCall(
  toolName: string,
  toolInput: ToolInput,
  curriculum: Curriculum,
  state: TutorState
): { result: string; segmentCompleted: boolean; summary?: string } {
  const cwd = curriculum.workingDirectory;
  let segmentCompleted = false;
  let summary: string | undefined;

  switch (toolName) {
    case 'verify_syntax': {
      const result = verifySyntax(toolInput.filepath!, cwd);
      return { result: result.output || result.error || 'Unknown error', segmentCompleted: false };
    }

    case 'conduct_code_review': {
      const result = conductCodeReview(
        toolInput.readability_score!,
        toolInput.maintainability_issue!,
        toolInput.edge_case_missed
      );
      return { result: result.output || 'Review recorded', segmentCompleted: false };
    }

    case 'run_git_command': {
      const result = executeGitCommand(toolInput.command!, cwd);
      return { result: result.output || result.error || 'Command executed', segmentCompleted: false };
    }

    case 'mark_segment_complete': {
      const segment = curriculum.segments[state.currentSegmentIndex];
      summary = toolInput.summary;
      // Note: We don't await here since markSegmentComplete updates state
      // The actual state update will happen in the caller
      segmentCompleted = true;
      const result = markComplete(toolInput.summary!, toolInput.next_hint);
      return { result: result.output || 'Segment complete', segmentCompleted, summary };
    }

    case 'read_file': {
      try {
        const fs = require('fs');
        const path = require('path');
        const fullPath = path.isAbsolute(toolInput.filepath!)
          ? toolInput.filepath!
          : path.join(cwd, toolInput.filepath!);
        const content = fs.readFileSync(fullPath, 'utf-8');
        return { result: content, segmentCompleted: false };
      } catch (error: any) {
        return { result: `Error reading file: ${error.message}`, segmentCompleted: false };
      }
    }

    default:
      return { result: `Unknown tool: ${toolName}`, segmentCompleted: false };
  }
}

/**
 * Generate a summary of the segment for context pruning
 */
async function generateSegmentSummary(
  messages: MessageParam[],
  segment: Segment
): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: 'Summarize this tutoring session in 2 sentences. Focus on what the user learned and any struggles.',
      messages: [
        {
          role: 'user',
          content: `Segment: ${segment.title}\n\nConversation:\n${JSON.stringify(messages.slice(-10))}`
        }
      ]
    });

    const textBlock = response.content.find((b): b is TextBlock => b.type === 'text');
    return textBlock?.text || `Completed: ${segment.title}`;
  } catch {
    return `Completed: ${segment.title}`;
  }
}

export interface AgentOptions {
  curriculum: Curriculum;
  state: TutorState;
  segment: Segment;
  segmentIndex: number;
  previousSummary?: string;
  onText: (text: string) => void;
  onSegmentComplete: (summary: string) => void;
}

/**
 * Run the tutor agent for a single turn
 */
export async function runAgentTurn(
  userMessage: string,
  messages: MessageParam[],
  options: AgentOptions
): Promise<{ messages: MessageParam[]; segmentCompleted: boolean; summary?: string; lastResponse?: string }> {
  const { curriculum, state, segment, segmentIndex, previousSummary, onText, onSegmentComplete } = options;

  // Add user message
  messages.push({ role: 'user', content: userMessage });

  const systemPrompt = buildSystemPrompt(curriculum, segment, segmentIndex, previousSummary);

  let segmentCompleted = false;
  let segmentSummary: string | undefined;
  let lastResponseText = '';

  // Agent loop - continue until no more tool calls
  while (true) {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages
    });

    // Process response content
    const assistantContent: ContentBlock[] = [];
    let hasToolUse = false;

    for (const block of response.content) {
      assistantContent.push(block);

      if (block.type === 'text') {
        onText(block.text);
        lastResponseText += block.text; // Track for expected code extraction
      } else if (block.type === 'tool_use') {
        hasToolUse = true;
      }
    }

    // Add assistant message
    messages.push({ role: 'assistant', content: assistantContent });

    // If no tool use, we're done
    if (!hasToolUse || response.stop_reason === 'end_turn') {
      break;
    }

    // Handle tool calls
    const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const toolBlock = block as ToolUseBlock;
        const { result, segmentCompleted: completed, summary } = handleToolCall(
          toolBlock.name,
          toolBlock.input as ToolInput,
          curriculum,
          state
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: result
        });

        if (completed) {
          segmentCompleted = true;
          segmentSummary = summary;
        }
      }
    }

    // Add tool results
    messages.push({ role: 'user', content: toolResults });
  }

  // If segment completed, generate summary and notify
  if (segmentCompleted) {
    const fullSummary = segmentSummary || await generateSegmentSummary(messages, segment);
    onSegmentComplete(fullSummary);
    return { messages, segmentCompleted: true, summary: fullSummary, lastResponse: lastResponseText };
  }

  return { messages, segmentCompleted: false, lastResponse: lastResponseText };
}

/**
 * Start a new conversation for a segment
 */
export function createInitialMessages(): MessageParam[] {
  return [];
}

/**
 * Prune context after segment completion
 * Keeps only the summary as context for the next segment
 */
export function pruneContextForNewSegment(summary: string): MessageParam[] {
  return [];
}
