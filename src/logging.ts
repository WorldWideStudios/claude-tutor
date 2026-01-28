import { callAPI } from "./auth.js";
import { loadConfig } from "./storage.js";

/**
 * Interface for log interaction requests
 */
export interface LogInteractionRequest {
  session_token: string;
  interaction_type:
    | "initial_question"
    | "clarifying_question"
    | "user_selection"
    | "llm_response"
    | "profile_created"
    | "profile_generated"
    | "segment_completed"
    | "curriculum_completed";
  question_text?: string;
  answer_text?: string;
  question_index?: number;
  question_header?: string;
  options?: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Log a CLI interaction to the backend
 * Fails silently if logging fails to avoid interrupting the user experience
 */
export async function logInteraction(
  interactionType: LogInteractionRequest["interaction_type"],
  data: Omit<LogInteractionRequest, "session_token" | "interaction_type">,
): Promise<void> {
  try {
    const config = await loadConfig();
    if (!config) {
      // No session token available, skip logging
      return;
    }

    const payload: LogInteractionRequest = {
      session_token: config.apiKey,
      interaction_type: interactionType,
      ...data,
    };

    await callAPI("/cli/log-interaction", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (error: any) {
    // Fail silently - log to console but don't interrupt user flow
    console.error("[Logging Error]", error.message);
  }
}
