import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { LearnerProfile } from "./types.js";
import {
  createMultiQuestionWizard,
  type WizardQuestion,
} from "./input.js";
import { startLoading, stopLoading, updateLoadingStatus } from "./display.js";
import * as readline from "readline";
import { logInteraction } from "./logging.js";

/**
 * Question option from AskUserQuestion tool
 */
interface QuestionOption {
  label: string;
  description: string;
}

/**
 * Question from AskUserQuestion tool
 */
interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/**
 * Input data for AskUserQuestion tool
 */
interface AskUserQuestionInput {
  questions: Question[];
}

/**
 * Backend context that can be passed to inform question generation
 */
export interface QuestionContext {
  userEmail?: string;
  totalMessages?: number;
  initialQuestion?: string;
  // Add any other backend context here
}

/**
 * Parse learner profile JSON from Claude's response text
 */
function parseProfileFromResponse(responseText: string): LearnerProfile | null {
  try {
    // Look for JSON block in the response (may be wrapped in markdown code fences)
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    let jsonStr = jsonMatch ? jsonMatch[1].trim() : null;

    // If no code fence, try to find raw JSON object
    if (!jsonStr) {
      const jsonObjectMatch = responseText.match(/\{[\s\S]*"projectIdea"[\s\S]*\}/);
      jsonStr = jsonObjectMatch ? jsonObjectMatch[0] : null;
    }

    if (!jsonStr) {
      return null;
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields
    if (!parsed.projectIdea || !parsed.experienceLevel || !parsed.profileSummary) {
      return null;
    }

    return {
      projectIdea: parsed.projectIdea,
      experienceLevel: parsed.experienceLevel,
      projectType: parsed.projectType,
      projectGoals: parsed.projectGoals,
      technicalContext: parsed.technicalContext,
      constraints: parsed.constraints,
      additionalContext: parsed.additionalContext,
      profileSummary: parsed.profileSummary,
    };
  } catch {
    return null;
  }
}

/**
 * Use Claude SDK to dynamically generate and ask clarifying questions
 * based on the user's project idea and any available context
 */
export async function askClarifyingQuestions(
  initialQuestion: string,
  userAnswer: string,
  rl: readline.Interface,
  context?: QuestionContext,
): Promise<LearnerProfile> {
  // Collected answers that will be used by Claude to build the profile
  const collectedAnswers: Record<string, string> = {};
  let finalResponseText = "";

  // Build context section for the system prompt
  const contextSection = context
    ? `
Available context about this user:
${context.userEmail ? `- User email: ${context.userEmail}` : ""}
${context.totalMessages !== undefined ? `- Previous interactions: ${context.totalMessages} messages` : ""}
${context.initialQuestion ? `- The initial question asked was personalized: "${context.initialQuestion}"` : ""}
`
    : "";

  // System prompt that lets Claude decide what questions are needed
  const systemPrompt = `You are helping understand a user's coding project to create a personalized learning curriculum.

Initial question asked: "${initialQuestion}"
User's answer: "${userAnswer}"
${contextSection}

Your task is to:
1. ANALYZE the user's response to understand as much as possible about their project and goals
2. DECIDE what additional information would be most valuable to create a personalized curriculum
3. ASK only the questions that are truly needed - this could be 0-4 questions depending on context
4. CREATE a learner profile summarizing everything you've learned

IMPORTANT GUIDELINES:
- DO NOT ask about things already clear from the user's answer
- DO NOT use generic/templated questions - tailor each question to THIS specific project
- Focus on understanding: their experience level, what success looks like to them, any constraints
- If the user's answer is detailed enough, you may not need to ask many (or any) follow-up questions
- Questions should feel conversational and specific, not like a form

WORKFLOW:
1. Use AskUserQuestion tool to ask clarifying questions (if needed)
2. After questions are answered (or if you have enough info already), output a JSON profile

FINAL OUTPUT (REQUIRED):
After gathering information, you MUST output a JSON learner profile in this exact format:
\`\`\`json
{
  "projectIdea": "Clear description of what the user wants to build",
  "experienceLevel": "Description of their coding experience",
  "projectType": "Type of application (CLI, web, game, etc.)",
  "projectGoals": "What they want to achieve or learn",
  "technicalContext": "Any relevant technical background",
  "constraints": "Any mentioned constraints",
  "profileSummary": "2-3 sentence synthesis of this learner"
}
\`\`\`

The JSON output is how you communicate the profile - it will be parsed and used to personalize the curriculum.`;

  // Track if we've stopped loading for questions
  let loadingStopped = false;

  // Handle the AskUserQuestion tool
  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    _options: { signal: AbortSignal; toolUseID: string },
  ): Promise<PermissionResult> => {
    if (toolName === "AskUserQuestion") {
      // Stop loading when we're ready to show questions
      if (!loadingStopped) {
        stopLoading();
        loadingStopped = true;
      }

      const questionInput = input as unknown as AskUserQuestionInput;

      // If no questions, skip the wizard
      if (!questionInput.questions || questionInput.questions.length === 0) {
        return {
          behavior: "allow",
          updatedInput: {
            questions: [],
            answers: {},
          },
        };
      }

      // Convert SDK questions to wizard format
      const wizardQuestions: WizardQuestion[] = questionInput.questions.map(
        (q) => ({
          question: q.question,
          header: q.header,
          options: q.options.map((opt) => ({
            label: opt.label,
            value: opt.label.toLowerCase().replace(/\s+/g, "-"),
            description: opt.description,
          })),
        }),
      );

      // Use the multi-question wizard
      const answers = await createMultiQuestionWizard(rl, wizardQuestions);

      // Store in collected answers for logging
      questionInput.questions.forEach((q) => {
        const headerKey = q.header.toLowerCase();
        collectedAnswers[headerKey] = answers[q.question] || "";
      });

      // Log each clarifying question and answer
      questionInput.questions.forEach((q, index) => {
        logInteraction("clarifying_question", {
          question_text: q.question,
          answer_text: answers[q.question] || "",
          question_index: index,
          question_header: q.header,
          options: { choices: q.options.map((opt) => opt.label) },
        });
      });

      // Restart loading after questions for profile generation
      startLoading();
      updateLoadingStatus("Creating your profile");

      return {
        behavior: "allow",
        updatedInput: {
          questions: questionInput.questions,
          answers,
        },
      };
    }

    // Allow other tools
    return {
      behavior: "allow",
      updatedInput: input,
    };
  };

  // Run the query with AskUserQuestion tool
  try {
    // Start loading while Claude generates questions
    startLoading();
    updateLoadingStatus("Thinking about your project");

    for await (const message of query({
      prompt: `Help me understand this project idea better so I can create a personalized learning curriculum: "${userAnswer}"`,
      options: {
        model: "claude-sonnet-4-20250514",
        systemPrompt,
        tools: ["AskUserQuestion"],
        canUseTool,
        maxTurns: 5,
        permissionMode: "default",
      },
    })) {
      // Capture the final text response
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text") {
            finalResponseText += block.text;
          }
        }
      }
    }

    // Make sure loading is stopped
    if (!loadingStopped) {
      stopLoading();
    } else {
      stopLoading(); // Stop the "Creating your profile" loading
    }
  } catch (error: any) {
    // Make sure loading is stopped on error
    stopLoading();
    console.error("Error during clarifying questions:", error.message);
  }

  // Parse profile from Claude's response
  const generatedProfile = parseProfileFromResponse(finalResponseText);

  if (generatedProfile) {
    // Log profile creation
    logInteraction("profile_generated", {
      metadata: {
        profile: generatedProfile,
        answersCollected: collectedAnswers,
      },
    });
    return generatedProfile;
  }

  // Fallback if Claude didn't output valid profile JSON
  const fallbackProfile: LearnerProfile = {
    projectIdea: userAnswer,
    experienceLevel: collectedAnswers["experience"] || collectedAnswers["level"] || "unknown",
    projectType: collectedAnswers["type"] || collectedAnswers["app"] || undefined,
    projectGoals: collectedAnswers["goals"] || collectedAnswers["purpose"] || undefined,
    profileSummary: `User wants to build: ${userAnswer}`,
  };

  logInteraction("profile_generated", {
    metadata: {
      profile: fallbackProfile,
      answersCollected: collectedAnswers,
      fallback: true,
    },
  });

  return fallbackProfile;
}
