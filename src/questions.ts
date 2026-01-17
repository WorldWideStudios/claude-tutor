import { query } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { LearnerProfile } from './types.js';
import { createMultiQuestionWizard, type WizardQuestion, type SelectOption } from './input.js';
import { startLoading, stopLoading, updateLoadingStatus } from './display.js';
import * as readline from 'readline';

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
 * Use Claude SDK to dynamically generate and ask clarifying questions
 * based on the user's project idea
 */
export async function askClarifyingQuestions(
  projectIdea: string,
  rl: readline.Interface
): Promise<LearnerProfile> {
  // Collected answers that will be used to build the learner profile
  const collectedAnswers: Record<string, string> = {};

  // System prompt to guide Claude in asking relevant questions
  const systemPrompt = `You are helping understand a user's coding project to create a personalized learning curriculum.

The user wants to build: "${projectIdea}"

Your job is to ask 3-4 clarifying questions using the AskUserQuestion tool to understand:
1. What type of application this is (CLI, web, API, script)
2. What problem it solves or what it helps the user do
3. What the most important feature should be
4. The user's coding experience level

IMPORTANT: You MUST use the AskUserQuestion tool to ask these questions. Do not ask questions in plain text.

After receiving the answers, summarize what you learned in a brief response.`;

  // Track if we've stopped loading for questions
  let loadingStopped = false;

  // Handle the AskUserQuestion tool
  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    _options: { signal: AbortSignal; toolUseID: string }
  ): Promise<PermissionResult> => {
    if (toolName === 'AskUserQuestion') {
      // Stop loading when we're ready to show questions
      if (!loadingStopped) {
        stopLoading();
        loadingStopped = true;
      }

      const questionInput = input as unknown as AskUserQuestionInput;

      // Convert SDK questions to wizard format
      const wizardQuestions: WizardQuestion[] = questionInput.questions.map(q => ({
        question: q.question,
        header: q.header,
        options: q.options.map(opt => ({
          label: opt.label,
          value: opt.label.toLowerCase().replace(/\s+/g, '-'),
          description: opt.description
        }))
      }));

      // Use the multi-question wizard
      const answers = await createMultiQuestionWizard(rl, wizardQuestions);

      // Store in collected answers for building profile
      questionInput.questions.forEach(q => {
        const headerKey = q.header.toLowerCase();
        collectedAnswers[headerKey] = answers[q.question] || '';
      });

      return {
        behavior: 'allow',
        updatedInput: {
          questions: questionInput.questions,
          answers
        }
      };
    }

    // Allow other tools
    return {
      behavior: 'allow',
      updatedInput: input
    };
  };

  // Run the query with AskUserQuestion tool available
  try {
    // Start loading while Claude generates questions
    startLoading();
    updateLoadingStatus('Generating questions');

    for await (const message of query({
      prompt: `Help me understand this project idea better so I can create a personalized learning curriculum: "${projectIdea}"`,
      options: {
        model: 'claude-sonnet-4-20250514',
        systemPrompt,
        tools: ['AskUserQuestion'],
        canUseTool,
        maxTurns: 3,
        permissionMode: 'default'
      }
    })) {
      // We just need to iterate through the messages to let the query complete
      // The canUseTool callback handles the actual question asking
    }

    // Make sure loading is stopped if it wasn't already
    if (!loadingStopped) {
      stopLoading();
    }
  } catch (error: any) {
    // Make sure loading is stopped on error
    stopLoading();
    // If the SDK query fails, fall back to basic profile
    console.error('Error during clarifying questions:', error.message);
  }

  // Build learner profile from collected answers
  return buildLearnerProfile(projectIdea, collectedAnswers);
}

/**
 * Build a LearnerProfile from the collected answers
 */
function buildLearnerProfile(
  projectIdea: string,
  answers: Record<string, string>
): LearnerProfile {
  // Map collected answers to profile fields
  // The header keys from questions map to our profile structure

  // Default values if answers weren't collected
  let experienceLevel: LearnerProfile['experienceLevel'] = 'complete-beginner';
  let projectType = 'cli';
  let projectPurpose = 'learn';
  let projectFeatures = 'minimal';

  // Map experience answers
  const expAnswer = answers['experience'] || answers['level'] || answers['coding'] || '';
  if (expAnswer.includes('beginner') || expAnswer.includes('never')) {
    experienceLevel = 'complete-beginner';
  } else if (expAnswer.includes('some') || expAnswer.includes('html') || expAnswer.includes('css')) {
    experienceLevel = 'some-experience';
  } else if (expAnswer.includes('know') || expAnswer.includes('basic') || expAnswer.includes('coded')) {
    experienceLevel = 'know-basics';
  }

  // Map app type answers
  const typeAnswer = answers['type'] || answers['app'] || answers['application'] || '';
  if (typeAnswer.includes('cli') || typeAnswer.includes('command') || typeAnswer.includes('terminal')) {
    projectType = 'cli';
  } else if (typeAnswer.includes('web') || typeAnswer.includes('browser')) {
    projectType = 'web';
  } else if (typeAnswer.includes('api') || typeAnswer.includes('backend') || typeAnswer.includes('server')) {
    projectType = 'api';
  } else if (typeAnswer.includes('script') || typeAnswer.includes('automat')) {
    projectType = 'script';
  }

  // Map purpose answers
  const purposeAnswer = answers['purpose'] || answers['help'] || answers['do'] || '';
  if (purposeAnswer.includes('organiz') || purposeAnswer.includes('track') || purposeAnswer.includes('list') || purposeAnswer.includes('todo')) {
    projectPurpose = 'organize';
  } else if (purposeAnswer.includes('calculat') || purposeAnswer.includes('process') || purposeAnswer.includes('data') || purposeAnswer.includes('math')) {
    projectPurpose = 'calculate';
  } else if (purposeAnswer.includes('communicat') || purposeAnswer.includes('share') || purposeAnswer.includes('message')) {
    projectPurpose = 'communicate';
  } else if (purposeAnswer.includes('learn') || purposeAnswer.includes('practice') || purposeAnswer.includes('educat')) {
    projectPurpose = 'learn';
  }

  // Map feature answers
  const featureAnswer = answers['feature'] || answers['important'] || '';
  if (featureAnswer.includes('simple') || featureAnswer.includes('minimal') || featureAnswer.includes('basic')) {
    projectFeatures = 'minimal';
  } else if (featureAnswer.includes('save') || featureAnswer.includes('load') || featureAnswer.includes('persist') || featureAnswer.includes('remember')) {
    projectFeatures = 'persistence';
  } else if (featureAnswer.includes('ui') || featureAnswer.includes('friendly') || featureAnswer.includes('format') || featureAnswer.includes('color')) {
    projectFeatures = 'ui';
  } else if (featureAnswer.includes('command') || featureAnswer.includes('multiple') || featureAnswer.includes('action')) {
    projectFeatures = 'commands';
  }

  return {
    experienceLevel,
    projectIdea,
    projectType,
    projectPurpose,
    projectFeatures
  };
}
