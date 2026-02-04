import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { Curriculum, TutorState, Progress, Segment } from '../types.js';

export interface AgentContext {
  curriculum: Curriculum;
  state: TutorState;
  segment: Segment | null;
  segmentIndex: number;
  previousSummary?: string;
  progress?: Progress;
  onSegmentComplete?: (summary?: string) => void;
}

export interface AgentResult {
  messages: MessageParam[];
  segmentCompleted?: boolean;
  summary?: string;
  lastResponse?: string;
}

export interface AgentCallerDependencies {
  runAgentTurn: (
    message: string,
    messages: MessageParam[],
    context: any
  ) => Promise<AgentResult>;
  displayText: (text: string) => void;
  displayToolStatus: (toolName: string, status: 'start' | 'end') => void;
  displayError: (message: string) => void;
  startLoading: () => void;
  stopLoading: () => void;
  setAgentRunning: (running: boolean) => void;
  resetStreamState: () => void;
}

export interface SigintHandlerConfig {
  saveState: (state: TutorState) => Promise<void>;
  saveProgress: (workingDirectory: string, progress: Progress) => Promise<void>;
  readlineClose: () => void;
  state: TutorState;
  workingDirectory: string;
  progress: Progress;
}

/**
 * Manages agent calls with proper queueing, error handling, and cleanup.
 * Prevents race conditions from concurrent agent calls.
 */
export class AgentCaller {
  private callQueue: Promise<any> = Promise.resolve();
  private deps: AgentCallerDependencies;
  private sigintHandlerInstalled = false;

  constructor(deps: AgentCallerDependencies) {
    this.deps = deps;
  }

  /**
   * Call the agent with proper loading state management and error handling.
   * Calls are automatically queued to prevent concurrent execution.
   */
  async callAgent(
    message: string,
    messages: MessageParam[],
    context: AgentContext
  ): Promise<AgentResult> {
    // Queue this call to prevent race conditions
    const result = this.callQueue.then(() => this.executeAgentCall(message, messages, context));
    this.callQueue = result.catch(() => {}); // Prevent queue from breaking on errors
    return result;
  }

  private async executeAgentCall(
    message: string,
    messages: MessageParam[],
    context: AgentContext
  ): Promise<AgentResult> {
    this.deps.resetStreamState();
    this.deps.setAgentRunning(true);
    this.deps.startLoading();
    let loadingStopped = false;

    try {
      const result = await this.deps.runAgentTurn(message, messages, {
        ...context,
        onText: (text: string) => {
          if (!loadingStopped) {
            this.deps.stopLoading();
            loadingStopped = true;
          }
          this.deps.displayText(text);
        },
        onToolUse: (toolName: string, status: 'start' | 'end') => {
          this.deps.displayToolStatus(toolName, status);
        },
        onSegmentComplete: context.onSegmentComplete,
      });

      if (!loadingStopped) {
        this.deps.stopLoading();
      }
      this.deps.setAgentRunning(false);

      return result;
    } catch (error: any) {
      this.deps.stopLoading();
      this.deps.setAgentRunning(false);
      this.deps.displayError(error.message);
      throw error;
    }
  }

  /**
   * Setup SIGINT (Ctrl+C) handler to save progress before exiting.
   * Should be called once at the start of the tutor loop.
   */
  setupSigintHandler(config: SigintHandlerConfig): void {
    if (this.sigintHandlerInstalled) {
      return;
    }

    process.on('SIGINT', async () => {
      console.log('\n\nSaving progress...');
      
      try {
        await Promise.all([
          config.saveState(config.state),
          config.saveProgress(config.workingDirectory, config.progress),
        ]);
        console.log('Progress saved.');
      } catch (error: any) {
        console.error('Failed to save progress:', error.message);
      }

      config.readlineClose();
      
      // Reset terminal if in raw mode
      if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }

      process.exit(0);
    });

    this.sigintHandlerInstalled = true;
  }
}
