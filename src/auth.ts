import * as readline from "readline";
import { saveConfig, loadConfig } from "./storage.js";
import {
  displayInfo,
  displayError,
  displayQuestionPrompt,
  closeQuestionPrompt,
} from "./display.js";
import type { InitResponse, ResumeResponse } from "./types.js";

/**
 * API Configuration
 */
export const API_HOSTNAME =
  process.env.CLAUDE_TUTOR_API_URL ||
  "https://claudetutor-api-ee850a171821.herokuapp.com";

/**
 * Helper function to call the backend API
 */
export async function callAPI(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_HOSTNAME}${path}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    return response;
  } catch (error: any) {
    throw new Error(`Failed to connect to API: ${error.message}`);
  }
}

/**
 * Call /cli/init to get personalized question based on chat history
 */
export async function callInitEndpoint(): Promise<InitResponse> {
  const config = await loadConfig();

  if (!config) {
    throw new Error("No config found. Please run 'claude-tutor login' first.");
  }

  const response = await callAPI("/cli/init", {
    method: "POST",
    body: JSON.stringify({ token: config.apiKey }),
  });

  if (!response.ok) {
    throw new Error(`Init endpoint failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data as InitResponse;
}

/**
 * Call /cli/resume to notify backend of session resume
 */
export async function callResumeEndpoint(): Promise<ResumeResponse> {
  const config = await loadConfig();

  if (!config) {
    throw new Error("No config found. Please run 'claude-tutor login' first.");
  }

  const response = await callAPI("/cli/resume", {
    method: "POST",
    body: JSON.stringify({ token: config.apiKey }),
  });

  if (!response.ok) {
    throw new Error(`Resume endpoint failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data as ResumeResponse;
}

/**
 * Handle login command
 */
export async function loginCommand(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Prompt for email
    const email = await new Promise<string>((resolve) => {
      displayQuestionPrompt("Enter your email address:");
      rl.once("line", (answer) => {
        closeQuestionPrompt("Enter your email address:", answer);
        resolve(answer.trim());
      });
    });

    if (!email) {
      displayError("Email is required.");
      rl.close();
      process.exit(1);
    }

    displayInfo("Initializing login...");

    const response = await callAPI("/user-session/init", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      displayError(`Login failed: ${response.statusText} - ${errorText}`);
      rl.close();
      process.exit(1);
    }

    const data = await response.json();
    const token =
      (data as any).token || (data as any).sessionToken || (data as any).apiKey;

    if (!token) {
      displayError("No token received from server");
      rl.close();
      process.exit(1);
    }

    // Save token to config file
    await saveConfig({ apiKey: token });

    displayInfo("✓ Login initiated successfully!");
    displayInfo("Please check your email for the confirmation link.");
    displayInfo('After confirming, come back and run "claude-tutor" to start.');
    rl.close();
  } catch (error: any) {
    displayError(error.message);
    rl.close();
    process.exit(1);
  }
}
