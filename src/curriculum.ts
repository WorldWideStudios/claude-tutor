import { v4 as uuid } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import type { Curriculum, Segment, BuildSegment, RefactorSegment, LearnerProfile } from './types.js';

// Lazy-initialize client
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Progress callback for curriculum creation
 */
export interface CurriculumProgress {
  onStep: (step: string) => void;
  onThinking?: (text: string) => void;
}

/**
 * Get context strings based on experience level (now flexible string-based)
 */
function getExperienceContext(experienceLevel: string): {
  target: string;
  pacing: string;
  complexity: string;
} {
  // Normalize for comparison
  const level = experienceLevel.toLowerCase();

  // Detect beginner indicators
  if (level.includes('never') || level.includes('no experience') || level.includes('complete beginner') || level.includes('first time')) {
    return {
      target: 'complete beginners who have never coded before',
      pacing: 'very slow with lots of explanation for every concept',
      complexity: 'keep code extremely simple, explain every line'
    };
  }

  // Detect some experience indicators
  if (level.includes('some') || level.includes('html') || level.includes('css') || level.includes('basic') || level.includes('little')) {
    return {
      target: 'learners with some coding experience',
      pacing: 'moderate pace, explain TypeScript-specific concepts',
      complexity: 'can use slightly more advanced patterns'
    };
  }

  // Detect intermediate+ indicators
  if (level.includes('know') || level.includes('familiar') || level.includes('experience') || level.includes('worked with')) {
    return {
      target: 'learners who know programming basics',
      pacing: 'faster pace, focus on TypeScript features and best practices',
      complexity: 'can use intermediate patterns and type system features'
    };
  }

  // Default to beginner-friendly
  return {
    target: experienceLevel || 'learners new to coding',
    pacing: 'measured pace with clear explanations',
    complexity: 'straightforward code with helpful comments'
  };
}

/**
 * Generate a project-specific curriculum using Claude.
 * Claude analyzes the project idea and creates relevant segments.
 */
export async function createCurriculum(
  projectName: string,
  projectGoal: string,
  workingDirectory: string,
  progress?: CurriculumProgress,
  learnerProfile?: LearnerProfile
): Promise<Curriculum> {
  const curriculumId = uuid();

  // Customize difficulty based on experience level
  const experienceContext = learnerProfile ? getExperienceContext(learnerProfile.experienceLevel) : {
    target: 'complete beginners',
    pacing: 'very slow with lots of explanation',
    complexity: 'keep code extremely simple'
  };

  const systemPrompt = `You are a curriculum designer for a coding tutor. Given a project idea, create 4-6 learning segments that build toward the final project.

LEARNER CONTEXT:
- Target audience: ${experienceContext.target}
- Pacing: ${experienceContext.pacing}
- Complexity: ${experienceContext.complexity}
${learnerProfile?.projectType ? `- Project type: ${learnerProfile.projectType}` : ''}
${learnerProfile?.projectGoals ? `- Project goals: ${learnerProfile.projectGoals}` : ''}
${learnerProfile?.technicalContext ? `- Technical context: ${learnerProfile.technicalContext}` : ''}
${learnerProfile?.constraints ? `- Constraints: ${learnerProfile.constraints}` : ''}
${learnerProfile?.profileSummary ? `- Learner summary: ${learnerProfile.profileSummary}` : ''}

RULES:
- Each segment should teach ONE concept while building toward the project
- Start simple (setup, basic structure) and progress to more complex features
- Include 1 REFACTOR segment to teach code improvement
- Code must be TypeScript and beginner-friendly
- Golden code should be SHORT (under 30 lines per segment)
- File paths should use src/ directory
- Tailor explanations and pacing to the learner's experience level

OUTPUT FORMAT (JSON only, no markdown):
{
  "segments": [
    {
      "type": "build",
      "title": "Short title",
      "targetFile": "src/filename.ts",
      "goldenCode": "the code user should type",
      "explanation": "Why we're doing this (1 sentence)",
      "engineeringFocus": "The engineering principle being taught",
      "checkpoints": ["what user should accomplish"]
    },
    {
      "type": "refactor",
      "title": "Short title",
      "targetFile": "src/filename.ts",
      "startingCode": "the bad code to improve",
      "goldenCode": "the improved code",
      "problem": "What's wrong with the starting code",
      "lesson": "The engineering lesson",
      "checkpoints": ["what user should fix"]
    }
  ]
}`;

  const userPrompt = `Create a curriculum for: "${projectGoal}"

Project name: ${projectName}
${learnerProfile ? `Learner: ${experienceContext.target}
App type: ${learnerProfile.projectType || 'general'}
Goals: ${learnerProfile.projectGoals || 'learning to code'}
${learnerProfile.profileSummary ? `Summary: ${learnerProfile.profileSummary}` : ''}` : 'Target: Complete beginners learning TypeScript'}

Generate segments that specifically build this project, not generic exercises. Each segment should add real functionality to the project.`;

  try {
    // Show progress steps
    progress?.onStep('Analyzing project idea...');

    // Use streaming to show progress
    const stream = getClient().messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    let fullText = '';
    let segmentCount = 0;
    let lastSegmentCount = 0;

    // Stream events for progress - track actual segment generation
    stream.on('text', (text) => {
      fullText += text;
      progress?.onThinking?.(text);

      // Count segments being generated (more accurate progress)
      const newSegmentCount = (fullText.match(/"type":\s*"(build|refactor)"/g) || []).length;
      if (newSegmentCount > lastSegmentCount) {
        lastSegmentCount = newSegmentCount;
        progress?.onStep(`Creating segment ${newSegmentCount}...`);
      }
    });

    // Wait for completion
    await stream.finalMessage();

    progress?.onStep('Building curriculum...');

    // Clean markdown fences from response (LLMs often wrap JSON in ```json ... ```)
    let jsonText = fullText.trim();

    // Remove markdown code fences
    if (jsonText.startsWith('```')) {
      // Find the end of the first line (```json or ```)
      const firstNewline = jsonText.indexOf('\n');
      if (firstNewline !== -1) {
        jsonText = jsonText.slice(firstNewline + 1);
      }
      // Remove trailing ```
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.slice(0, -3).trim();
      }
    }

    // Parse the JSON response
    const parsed = JSON.parse(jsonText);
    const segments: Segment[] = parsed.segments.map((seg: any) => {
      if (seg.type === 'build') {
        return createBuildSegment({
          title: seg.title,
          goldenCode: seg.goldenCode,
          targetFile: seg.targetFile,
          explanation: seg.explanation,
          engineeringFocus: seg.engineeringFocus,
          checkpoints: seg.checkpoints.map((cp: string) => ({
            id: uuid(),
            description: cp,
            completed: false
          }))
        });
      } else {
        return createRefactorSegment({
          title: seg.title,
          startingCode: seg.startingCode,
          goldenCode: seg.goldenCode,
          targetFile: seg.targetFile,
          problem: seg.problem,
          lesson: seg.lesson,
          checkpoints: seg.checkpoints.map((cp: string) => ({
            id: uuid(),
            description: cp,
            completed: false
          }))
        });
      }
    });

    return {
      id: curriculumId,
      projectName,
      projectGoal,
      workingDirectory,
      segments,
      learnerProfile,
      createdAt: new Date().toISOString()
    };
  } catch (error: any) {
    // Fallback to basic curriculum if generation fails
    console.error('Curriculum generation failed, using fallback:', error.message);
    return createFallbackCurriculum(curriculumId, projectName, projectGoal, workingDirectory);
  }
}

/**
 * Fallback curriculum if Claude generation fails
 */
function createFallbackCurriculum(
  curriculumId: string,
  projectName: string,
  projectGoal: string,
  workingDirectory: string
): Curriculum {
  const segments: Segment[] = [
    createBuildSegment({
      title: 'Project Setup',
      goldenCode: `// ${projectName}\n// ${projectGoal}\n\nconsole.log('Starting ${projectName}...');`,
      targetFile: 'src/index.ts',
      explanation: 'Every project starts with a clear entry point.',
      engineeringFocus: 'Project organization',
      checkpoints: [{ id: uuid(), description: 'Create entry point', completed: false }]
    }),
    createBuildSegment({
      title: 'Core Logic',
      goldenCode: `// Add your main logic here\nexport function main(): void {\n  console.log('${projectName} is running');\n}\n\nmain();`,
      targetFile: 'src/index.ts',
      explanation: 'Separate your main logic into a function.',
      engineeringFocus: 'Function organization',
      checkpoints: [{ id: uuid(), description: 'Create main function', completed: false }]
    })
  ];

  return {
    id: curriculumId,
    projectName,
    projectGoal,
    workingDirectory,
    segments,
    createdAt: new Date().toISOString()
  };
}

function createBuildSegment(params: {
  title: string;
  goldenCode: string;
  targetFile: string;
  explanation: string;
  engineeringFocus: string;
  checkpoints: { id: string; description: string; completed: boolean }[];
}): BuildSegment {
  return {
    id: uuid(),
    type: 'build',
    ...params
  };
}

function createRefactorSegment(params: {
  title: string;
  startingCode: string;
  goldenCode: string;
  targetFile: string;
  problem: string;
  lesson: string;
  checkpoints: { id: string; description: string; completed: boolean }[];
}): RefactorSegment {
  return {
    id: uuid(),
    type: 'refactor',
    ...params
  };
}

/**
 * Get the current segment from a curriculum based on index
 */
export function getCurrentSegment(curriculum: Curriculum, index: number): Segment | null {
  if (index < 0 || index >= curriculum.segments.length) {
    return null;
  }
  return curriculum.segments[index];
}

/**
 * Check if curriculum is complete
 */
export function isCurriculumComplete(curriculum: Curriculum, completedSegments: string[]): boolean {
  return curriculum.segments.every(s => completedSegments.includes(s.id));
}
