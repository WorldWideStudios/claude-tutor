#!/usr/bin/env node

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import * as path from 'path';

// Load .env from the package directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '..', '.env') });

import { Command } from 'commander';
import * as readline from 'readline';
import { execSync } from 'child_process';
import { runPreflightChecks, createProjectDirectory } from './preflight.js';
import { initGitRepo } from './git.js';
import { createCurriculum, getCurrentSegment, isCurriculumComplete } from './curriculum.js';
import { loadState, saveState, saveCurriculum, loadCurriculum, createInitialState } from './storage.js';
import { runAgentTurn, createInitialMessages, pruneContextForNewSegment } from './agent.js';
import { extractExpectedCode, createTyperSharkInput, createMultiLineTyperSharkInput, createInteractiveSelect, type ExtractedCode } from './input.js';
import {
  displayWelcome,
  displaySegmentHeader,
  displayResume,
  displayTutorText,
  displaySegmentComplete,
  displayCurriculumComplete,
  displayError,
  displayPrompt,
  displayPreflightError,
  displayGitInit,
  displayInfo,
  displayUserMessage,
  displayQuestionPrompt,
  closeQuestionPrompt,
  displayCommand,
  displayCommandOutput,
  displayContinuationPrompt,
  displayStatus,
  displayStep,
  displayTargetLine,
  clearExpectedText,
  checkTypingComplete,
  displayToolStatus,
  setAgentRunning,
  resetStreamState,
  startLoading,
  stopLoading,
  updateLoadingStatus,
  isLoadingActive,
  newLine
} from './display.js';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { Curriculum, TutorState, LearnerProfile } from './types.js';
import { askClarifyingQuestions } from './questions.js';

// Shell commands that should be executed directly
const SHELL_COMMANDS = [
  'mkdir', 'cat', 'echo', 'touch', 'rm', 'mv', 'cp', 'ls', 'cd',
  'git', 'npm', 'npx', 'node', 'tsc', 'pwd', 'chmod', 'grep', 'find'
];

// Heredoc state tracking
let heredocState: {
  active: boolean;
  delimiter: string;
  command: string;
  lines: string[];
} = { active: false, delimiter: '', command: '', lines: [] };

// Abort controller for cancelling requests
let shouldCancel = false;

/**
 * Check if input looks like a shell command
 */
function isShellCommand(input: string): boolean {
  const firstWord = input.trim().split(/\s+/)[0];
  return SHELL_COMMANDS.includes(firstWord);
}

/**
 * Check if command starts a heredoc
 */
function startsHeredoc(input: string): { isHeredoc: boolean; delimiter: string } {
  const heredocMatch = input.match(/<<\s*['"]?(\w+)['"]?\s*$/);
  if (heredocMatch) {
    return { isHeredoc: true, delimiter: heredocMatch[1] };
  }
  return { isHeredoc: false, delimiter: '' };
}

/**
 * Execute a shell command and return the result
 */
function executeCommand(command: string, cwd: string): { success: boolean; output: string } {
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash'
    });
    return { success: true, output: output || '' };
  } catch (error: any) {
    return {
      success: false,
      output: error.stderr || error.stdout || error.message
    };
  }
}

const program = new Command();

program
  .name('claude-tutor')
  .description('Claude Software Engineering Tutor')
  .version('1.0.0')
  .option('-d, --dir <directory>', 'Project directory', process.cwd())
  .action(async (options) => {
    // Default action: start a new project
    await startCommand(options.dir);
  });

program
  .command('resume')
  .description('Resume the current tutoring project')
  .action(async () => {
    await resumeCommand();
  });

program.parse();

/**
 * Start a new tutoring project
 */
async function startCommand(_projectDir: string): Promise<void> {
  displayWelcome();  // No skill on initial startup

  // Check for existing project first
  const existingState = await loadState();
  if (existingState && existingState.curriculumPath) {
    const existingCurriculum = await loadCurriculum(existingState.curriculumPath);
    if (existingCurriculum && !isCurriculumComplete(existingCurriculum, existingState.completedSegments)) {
      // There's an active project - ask if they want to resume
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const progress = `${existingState.currentSegmentIndex}/${existingCurriculum.segments.length}`;
      displayInfo(`Continue project: "${existingCurriculum.projectName}" (${progress} complete)`);
      newLine();

      const answer = await new Promise<string>((resolve) => {
        displayQuestionPrompt('Resume this project? (y/n)');
        rl.once('line', resolve);
      });

      if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes' || answer === '') {
        rl.close();
        // Resume the existing project
        displayResume(existingCurriculum, existingState);
        await runTutorLoop(existingCurriculum, existingState);
        return;
      }

      rl.close();
      displayInfo('Starting new project...');
      newLine();
    }
  }

  // Get project details from user first
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      displayQuestionPrompt(prompt);
      rl.once('line', (answer) => {
        closeQuestionPrompt(prompt, answer);
        resolve(answer);
      });
    });
  };

  try {
    const projectName = await question('What do you want to build?');
    if (!projectName.trim()) {
      displayError('Project name is required.');
      rl.close();
      process.exit(1);
    }

    // Use dynamic questions based on project idea
    displayInfo('Let me understand your project better:');
    const learnerProfile = await askClarifyingQuestions(projectName.trim(), rl);

    rl.close();
    newLine();

    // Create isolated project directory (security: never use user's cwd)
    const projectDir = createProjectDirectory(projectName.trim());
    displayInfo(`Project folder: ${projectDir}`);

    // Run pre-flight checks on the new directory
    const preflight = runPreflightChecks(projectDir);
    if (!preflight.ok) {
      displayPreflightError(preflight.error!);
      process.exit(1);
    }

    // Create curriculum with streaming progress
    startLoading();
    const curriculum = await createCurriculum(projectName.trim(), projectName.trim(), projectDir, {
      onStep: (step) => {
        // Update spinner to show current step (not print a separate line)
        updateLoadingStatus(step.replace('...', ''));
      }
    }, learnerProfile);
    stopLoading();
    const curriculumPath = await saveCurriculum(curriculum);

    // Initialize Git (silent)
    const gitResult = initGitRepo(projectDir);
    if (gitResult.success) {
      displayGitInit();
    }

    // Create initial state
    const state = createInitialState(curriculumPath);
    await saveState(state);

    displayInfo(`Created ${curriculum.segments.length} segments for "${projectName}".`);
    newLine();

    // Start the tutor loop
    await runTutorLoop(curriculum, state);

  } catch (error: any) {
    stopLoading();
    displayError(error.message);
    process.exit(1);
  }
}

/**
 * Resume an existing tutoring project
 */
async function resumeCommand(): Promise<void> {
  try {
    const state = await loadState();
    if (!state || !state.curriculumPath) {
      displayError('No active project. Run "tutor start" to begin.');
      process.exit(1);
    }

    const curriculum = await loadCurriculum(state.curriculumPath);
    if (!curriculum) {
      displayError('Could not load curriculum. Start a new project with "tutor start".');
      process.exit(1);
    }

    // Run pre-flight checks
    const preflight = runPreflightChecks(curriculum.workingDirectory);
    if (!preflight.ok) {
      displayPreflightError(preflight.error!);
      process.exit(1);
    }

    displayResume(curriculum, state);

    // Check if curriculum is complete
    if (isCurriculumComplete(curriculum, state.completedSegments)) {
      displayCurriculumComplete(curriculum);
      process.exit(0);
    }

    // Start the tutor loop
    await runTutorLoop(curriculum, state);

  } catch (error: any) {
    displayError(error.message);
    process.exit(1);
  }
}

/**
 * Main tutor conversation loop
 */
async function runTutorLoop(curriculum: Curriculum, state: TutorState): Promise<void> {
  let messages: MessageParam[] = createInitialMessages();
  let previousSummary: string | undefined;
  let currentExpectedCode: ExtractedCode | null = null; // Track what user should type with explanation

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Enable keypress events for ESC handling
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin, rl);
  }

  // Setup ESC key handling
  process.stdin.on('keypress', (_str, key) => {
    if (key && key.name === 'escape' && isLoadingActive()) {
      shouldCancel = true;
      stopLoading();
      console.log('\n(Cancelled)');
      displayPrompt();
    }
  });

  // Get current segment
  let segment = getCurrentSegment(curriculum, state.currentSegmentIndex);
  if (!segment) {
    displayCurriculumComplete(curriculum);
    rl.close();
    return;
  }

  displaySegmentHeader(curriculum, segment, state.currentSegmentIndex);

  // Send initial "start" message to kick off the segment
  try {
    resetStreamState();
    setAgentRunning(true);
    startLoading();
    let loadingStopped = false;
    const result = await runAgentTurn('start', messages, {
      curriculum,
      state,
      segment,
      segmentIndex: state.currentSegmentIndex,
      previousSummary,
      onText: (text) => {
        if (!loadingStopped) {
          stopLoading();
          loadingStopped = true;
        }
        displayTutorText(text);
      },
      onToolUse: (toolName, status) => displayToolStatus(toolName, status),
      onSegmentComplete: (summary) => {
        const nextSegment = getCurrentSegment(curriculum, state.currentSegmentIndex + 1);
        displaySegmentComplete(summary, nextSegment?.title);
      }
    });
    if (!loadingStopped) stopLoading();
    setAgentRunning(false);
    messages = result.messages;
    // Extract expected code from response for character tracking
    if (result.lastResponse) {
      currentExpectedCode = extractExpectedCode(result.lastResponse);
    }
    newLine();
  } catch (error: any) {
    stopLoading();
    setAgentRunning(false);
    displayError(`Failed to start segment: ${error.message}`);
    rl.close();
    process.exit(1);
  }

  // Helper to get input - uses Typer Shark when expected code exists
  const getInput = async (): Promise<string> => {
    // Don't use Typer Shark for heredoc continuation lines
    if (currentExpectedCode && !heredocState.active) {
      if (currentExpectedCode.isMultiLine && currentExpectedCode.lines) {
        // Multi-line Typer Shark for heredocs with interleaved comments
        const results = await createMultiLineTyperSharkInput(rl, currentExpectedCode.lines);
        // Clear expected code after input
        currentExpectedCode = null;
        // Return all lines joined for command execution
        return results.join('\n');
      } else {
        // Single-line Typer Shark input with real-time character feedback
        const result = await createTyperSharkInput(rl, currentExpectedCode.code, currentExpectedCode.explanation);
        // Clear expected code after Typer Shark input (user typed something)
        currentExpectedCode = null;
        return result;
      }
    } else {
      // Regular readline input (or heredoc continuation)
      if (heredocState.active) {
        displayContinuationPrompt();
      } else {
        displayPrompt();
      }
      return new Promise((resolve) => {
        rl.once('line', resolve);
      });
    }
  };

  // Main conversation loop
  while (true) {
    const input = await getInput();
    // Reset cancel flag
    shouldCancel = false;

    // Handle heredoc continuation
    if (heredocState.active) {
      if (input.trim() === heredocState.delimiter) {
        // End of heredoc - execute full command
        const fullCommand = heredocState.command + '\n' + heredocState.lines.join('\n') + '\n' + heredocState.delimiter;
        heredocState = { active: false, delimiter: '', command: '', lines: [] };

        const cmdResult = executeCommand(fullCommand, curriculum.workingDirectory);
        displayCommand(fullCommand.split('\n')[0] + ' ...', cmdResult.success);
        displayCommandOutput(cmdResult.output);

        // Send to Claude
        const messageToSend = cmdResult.success
          ? `I ran a heredoc command to create/modify a file:\n${fullCommand}\nResult: Success`
          : `I ran a heredoc command:\n${fullCommand}\nError: ${cmdResult.output}`;

        try {
          resetStreamState();
          setAgentRunning(true);
          startLoading();
          let loadingStopped = false;
          const result = await runAgentTurn(messageToSend, messages, {
            curriculum, state, segment: segment!, segmentIndex: state.currentSegmentIndex, previousSummary,
            onText: (text) => { if (!loadingStopped) { stopLoading(); loadingStopped = true; } displayTutorText(text); },
            onToolUse: (toolName, status) => displayToolStatus(toolName, status),
            onSegmentComplete: (summary) => { previousSummary = summary; }
          });
          if (!loadingStopped) stopLoading();
          setAgentRunning(false);
          messages = result.messages;
          // Extract expected code for next input
          if (result.lastResponse) {
            currentExpectedCode = extractExpectedCode(result.lastResponse);
          }
          newLine();
        } catch (error: any) {
          stopLoading();
          setAgentRunning(false);
          displayError(error.message);
        }
        continue;
      } else {
        // Continue collecting heredoc lines
        heredocState.lines.push(input);
        continue;
      }
    }

    const userInput = input.trim();

    // Empty Enter = continue signal
    if (!userInput) {
      try {
        resetStreamState();
        setAgentRunning(true);
        startLoading();
        let loadingStopped = false;
        const result = await runAgentTurn('(user pressed Enter to continue)', messages, {
          curriculum, state, segment: segment!, segmentIndex: state.currentSegmentIndex, previousSummary,
          onText: (text) => { if (!loadingStopped) { stopLoading(); loadingStopped = true; } displayTutorText(text); },
          onToolUse: (toolName, status) => displayToolStatus(toolName, status),
          onSegmentComplete: (summary) => { previousSummary = summary; }
        });
        if (!loadingStopped) stopLoading();
        setAgentRunning(false);
        messages = result.messages;
        // Extract expected code for next input
        if (result.lastResponse) {
          currentExpectedCode = extractExpectedCode(result.lastResponse);
        }
        newLine();
        continue;
      } catch (error: any) {
        stopLoading();
        setAgentRunning(false);
        displayError(error.message);
        continue;
      }
    }

    // Handle quit command
    if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
      displayInfo('\nProgress saved. Run "claude-tutor resume" to continue.');
      rl.close();
      process.exit(0);
    }

    // Check if it's a shell command
    let messageToSend = userInput;
    if (isShellCommand(userInput)) {
      // Check if it starts a heredoc
      const { isHeredoc, delimiter } = startsHeredoc(userInput);
      if (isHeredoc) {
        // Start heredoc mode
        heredocState = { active: true, delimiter, command: userInput, lines: [] };
        continue;
      }

      // Regular command - execute it
      const cmdResult = executeCommand(userInput, curriculum.workingDirectory);
      displayCommand(userInput, cmdResult.success);
      displayCommandOutput(cmdResult.output);

      messageToSend = cmdResult.success
        ? `I ran: ${userInput}\nOutput: ${cmdResult.output || '(success)'}`
        : `I ran: ${userInput}\nError: ${cmdResult.output}`;
    }

    try {
      resetStreamState();
      setAgentRunning(true);
      startLoading();
      let loadingStopped = false;
      const result = await runAgentTurn(messageToSend, messages, {
        curriculum,
        state,
        segment: segment!,
        segmentIndex: state.currentSegmentIndex,
        previousSummary,
        onText: (text) => {
          if (!loadingStopped) {
            stopLoading();
            loadingStopped = true;
          }
          displayTutorText(text);
        },
        onToolUse: (toolName, status) => displayToolStatus(toolName, status),
        onSegmentComplete: (summary) => {
          previousSummary = summary;
        }
      });
      if (!loadingStopped) stopLoading();
      setAgentRunning(false);

      messages = result.messages;
      // Extract expected code for next input
      if (result.lastResponse) {
        currentExpectedCode = extractExpectedCode(result.lastResponse);
      }
      newLine();

      // Check if segment was completed
      if (result.segmentCompleted) {
        // Update state - properly mark segment complete with ID tracking
        const completedSegmentId = segment!.id;
        state.completedSegments = [...state.completedSegments, completedSegmentId];
        state.currentSegmentIndex++;
        state.previousSegmentSummary = result.summary;
        await saveState(state);

        // Check if curriculum is complete
        if (isCurriculumComplete(curriculum, state.completedSegments)) {
          displayCurriculumComplete(curriculum);
          rl.close();
          return;
        }

        // Move to next segment
        segment = getCurrentSegment(curriculum, state.currentSegmentIndex);
        if (!segment) {
          displayCurriculumComplete(curriculum);
          rl.close();
          return;
        }

        // Prune context for new segment
        messages = pruneContextForNewSegment(result.summary || '');
        const nextSegment = getCurrentSegment(curriculum, state.currentSegmentIndex + 1);
        displaySegmentComplete(result.summary || 'Segment complete', nextSegment?.title);

        // Display new segment header
        displaySegmentHeader(curriculum, segment, state.currentSegmentIndex);

        // Kick off new segment
        resetStreamState();
        setAgentRunning(true);
        startLoading();
        let newLoadingStopped = false;
        const newResult = await runAgentTurn('start', messages, {
          curriculum,
          state,
          segment,
          segmentIndex: state.currentSegmentIndex,
          previousSummary,
          onText: (text) => {
            if (!newLoadingStopped) {
              stopLoading();
              newLoadingStopped = true;
            }
            displayTutorText(text);
          },
          onToolUse: (toolName, status) => displayToolStatus(toolName, status),
          onSegmentComplete: (summary) => {
            previousSummary = summary;
          }
        });
        if (!newLoadingStopped) stopLoading();
        setAgentRunning(false);
        messages = newResult.messages;
        // Extract expected code for next input
        if (newResult.lastResponse) {
          currentExpectedCode = extractExpectedCode(newResult.lastResponse);
        }
        newLine();
      }

    } catch (error: any) {
      stopLoading();
      setAgentRunning(false);
      displayError(error.message);
    }
  }
}
