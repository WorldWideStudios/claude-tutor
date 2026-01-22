import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  ContentBlock,
  ToolUseBlock,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { buildSystemPrompt } from "./system-prompt.js";
import {
  verifySyntax,
  conductCodeReview,
  executeGitCommand,
  markComplete,
} from "./tools.js";
import { updateProgress, addCompletedStep } from "./storage.js";
import type { Curriculum, Segment, TutorState, Progress } from "./types.js";
import { logInteraction } from "./logging.js";

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
    name: "verify_syntax",
    description:
      'Check file for syntax errors. Call this first after user says "done".',
    input_schema: {
      type: "object" as const,
      properties: {
        filepath: {
          type: "string",
          description: "Path to the file to verify",
        },
      },
      required: ["filepath"],
    },
  },
  {
    name: "conduct_code_review",
    description:
      "Critique code on engineering standards. Call AFTER verify_syntax passes.",
    input_schema: {
      type: "object" as const,
      properties: {
        readability_score: {
          type: "number",
          minimum: 1,
          maximum: 10,
          description: "Readability score 1-10",
        },
        maintainability_issue: {
          type: "string",
          description:
            'Specific maintainability issue found, or "none" if passes',
        },
        edge_case_missed: {
          type: "string",
          description: "Edge case the user forgot to handle",
        },
      },
      required: ["readability_score", "maintainability_issue"],
    },
  },
  {
    name: "run_git_command",
    description:
      'Execute a git command. ONLY allows commands starting with "git".',
    input_schema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: "The git command to run",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "mark_segment_complete",
    description:
      "Call when code passes syntax, engineering review, AND user committed.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "Summary of what the user achieved",
        },
        next_hint: {
          type: "string",
          description: "Hint for the next segment",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file to verify user's code.",
    input_schema: {
      type: "object" as const,
      properties: {
        filepath: {
          type: "string",
          description: "Path to the file to read",
        },
      },
      required: ["filepath"],
    },
  },
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
async function handleToolCall(
  toolName: string,
  toolInput: ToolInput,
  curriculum: Curriculum,
  state: TutorState,
): Promise<{ result: string; segmentCompleted: boolean; summary?: string }> {
  const cwd = curriculum.workingDirectory;
  let segmentCompleted = false;
  let summary: string | undefined;

  switch (toolName) {
    case "verify_syntax": {
      const result = verifySyntax(toolInput.filepath!, cwd);
      // Update progress if syntax check passed
      if (result.success) {
        try {
          await updateProgress(cwd, { syntaxVerified: true });
          await addCompletedStep(cwd, `Syntax verified for ${toolInput.filepath}`);
        } catch {
          // Ignore progress update errors
        }
      }
      return {
        result: result.output || result.error || "Unknown error",
        segmentCompleted: false,
      };
    }

    case "conduct_code_review": {
      const result = conductCodeReview(
        toolInput.readability_score!,
        toolInput.maintainability_issue!,
        toolInput.edge_case_missed,
      );
      // Update progress - code was reviewed
      try {
        await updateProgress(cwd, { codeReviewed: true });
        await addCompletedStep(cwd, `Code review completed (score: ${toolInput.readability_score}/10)`);
      } catch {
        // Ignore progress update errors
      }
      return {
        result: result.output || "Review recorded",
        segmentCompleted: false,
      };
    }

    case "run_git_command": {
      const result = executeGitCommand(toolInput.command!, cwd);
      return {
        result: result.output || result.error || "Command executed",
        segmentCompleted: false,
      };
    }

    case "mark_segment_complete": {
      const segment = curriculum.segments[state.currentSegmentIndex];
      summary = toolInput.summary;
      // Note: We don't await here since markSegmentComplete updates state
      // The actual state update will happen in the caller
      segmentCompleted = true;
      const result = markComplete(toolInput.summary!, toolInput.next_hint);
      return {
        result: result.output || "Segment complete",
        segmentCompleted,
        summary,
      };
    }

    case "read_file": {
      try {
        const fs = require("fs");
        const path = require("path");
        const fullPath = path.isAbsolute(toolInput.filepath!)
          ? toolInput.filepath!
          : path.join(cwd, toolInput.filepath!);
        const content = fs.readFileSync(fullPath, "utf-8");
        return { result: content, segmentCompleted: false };
      } catch (error: any) {
        return {
          result: `Error reading file: ${error.message}`,
          segmentCompleted: false,
        };
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
  segment: Segment,
): Promise<string> {
  try {
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      system:
        "Summarize this tutoring session in 2 sentences. Focus on what the user learned and any struggles.",
      messages: [
        {
          role: "user",
          content: `Segment: ${segment.title}\n\nConversation:\n${JSON.stringify(messages.slice(-10))}`,
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is TextBlock => b.type === "text",
    );
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
  progress?: Progress; // Progress tracking for resume
  onText: (text: string) => void;
  onToolUse?: (toolName: string, status: "start" | "end") => void;
  onSegmentComplete: (summary: string) => void;
}

// Human-readable tool names for status display
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  verify_syntax: "Verifying syntax",
  conduct_code_review: "Reviewing code",
  run_git_command: "Running git",
  mark_segment_complete: "Completing segment",
  read_file: "Reading file",
};

/**
 * Run the tutor agent for a single turn with streaming
 */
export async function runAgentTurn(
  userMessage: string,
  messages: MessageParam[],
  options: AgentOptions,
): Promise<{
  messages: MessageParam[];
  segmentCompleted: boolean;
  summary?: string;
  lastResponse?: string;
}> {
  const {
    curriculum,
    state,
    segment,
    segmentIndex,
    previousSummary,
    progress,
    onText,
    onToolUse,
    onSegmentComplete,
  } = options;

  // Add user message
  messages.push({ role: "user", content: userMessage });

  const systemPrompt = buildSystemPrompt(
    curriculum,
    segment,
    segmentIndex,
    previousSummary,
    progress,
  );

  let segmentCompleted = false;
  let segmentSummary: string | undefined;
  let lastResponseText = "";
  let toolsUsed = false;

  // Agent loop - continue until no more tool calls
  while (true) {
    // Use streaming API
    const stream = getClient().messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages,
    });

    // Track content blocks as they stream
    const assistantContent: ContentBlock[] = [];
    let currentToolName: string | null = null;

    // Process stream events
    stream.on("text", (text) => {
      onText(text);
      lastResponseText += text;
    });

    stream.on("contentBlock", (block) => {
      assistantContent.push(block);

      // Notify when tool use starts
      if (block.type === "tool_use" && onToolUse) {
        currentToolName = block.name;
        onToolUse(TOOL_DISPLAY_NAMES[block.name] || block.name, "start");
      }
    });

    // Wait for stream to complete
    const response = await stream.finalMessage();

    // Add assistant message
    messages.push({ role: "assistant", content: assistantContent });

    // Check for tool use
    const toolUseBlocks = assistantContent.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      break;
    }

    // Track that tools were used
    toolsUsed = true;

    // Handle tool calls
    const toolResults: {
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }[] = [];

    for (const toolBlock of toolUseBlocks) {
      const {
        result,
        segmentCompleted: completed,
        summary,
      } = await handleToolCall(
        toolBlock.name,
        toolBlock.input as ToolInput,
        curriculum,
        state,
      );

      // Notify tool end
      if (onToolUse) {
        onToolUse(TOOL_DISPLAY_NAMES[toolBlock.name] || toolBlock.name, "end");
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolBlock.id,
        content: result,
      });

      if (completed) {
        segmentCompleted = true;
        segmentSummary = summary;
      }
    }

    // Add tool results
    messages.push({ role: "user", content: toolResults });
  }

  // Log LLM response
  if (lastResponseText) {
    logInteraction("llm_response", {
      answer_text: lastResponseText,
      metadata: {
        segmentIndex,
        segmentCompleted,
        toolsUsed,
      },
    });
  }

  // If segment completed, generate summary and notify
  if (segmentCompleted) {
    const fullSummary =
      segmentSummary || (await generateSegmentSummary(messages, segment));
    onSegmentComplete(fullSummary);
    return {
      messages,
      segmentCompleted: true,
      summary: fullSummary,
      lastResponse: lastResponseText,
    };
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
