import { execSync } from "child_process";
import { fileURLToPath } from "url";
import * as path from "path";
import { startLoading, stopLoading, updateLoadingStatus } from "./display.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

/**
 * Check for updates and auto-update if a new version is available
 * Returns true if an update was performed and restart is needed
 */
export async function checkAndAutoUpdate(): Promise<boolean> {
  try {
    // Check if we're in a git repo
    try {
      execSync("git rev-parse --git-dir", { cwd: projectRoot, stdio: "ignore" });
    } catch {
      // Not a git repo, skip update check
      return false;
    }

    // Fetch latest from remote (quietly)
    try {
      execSync("git fetch origin main --quiet", { cwd: projectRoot, stdio: "ignore", timeout: 10000 });
    } catch {
      // Network error or no remote, skip update
      return false;
    }

    // Check if we're behind origin/main
    let localCommit: string;
    let remoteCommit: string;

    try {
      localCommit = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
      remoteCommit = execSync("git rev-parse origin/main", { cwd: projectRoot, encoding: "utf-8" }).trim();
    } catch {
      return false;
    }

    if (localCommit === remoteCommit) {
      // Already up to date
      return false;
    }

    // Check if remote is ahead (we need to update)
    try {
      const behindCount = execSync(`git rev-list --count HEAD..origin/main`, {
        cwd: projectRoot,
        encoding: "utf-8"
      }).trim();

      if (parseInt(behindCount) === 0) {
        // We're ahead or diverged, don't auto-update
        return false;
      }
    } catch {
      return false;
    }

    // New version available - start update
    startLoading();
    updateLoadingStatus("New version available, updating...");

    try {
      // Stash any local changes
      execSync("git stash --quiet", { cwd: projectRoot, stdio: "ignore" });

      // Pull latest
      updateLoadingStatus("Pulling latest changes...");
      execSync("git pull origin main --quiet", { cwd: projectRoot, stdio: "ignore", timeout: 30000 });

      // Rebuild
      updateLoadingStatus("Rebuilding...");
      execSync("npm run build", { cwd: projectRoot, stdio: "ignore", timeout: 60000 });

      stopLoading();
      // Update complete - restart silently (no messages shown)

      return true; // Signal that restart is needed
    } catch (error: any) {
      stopLoading();
      // Update failed, try to recover
      try {
        execSync("git stash pop --quiet", { cwd: projectRoot, stdio: "ignore" });
      } catch {
        // Ignore stash pop errors
      }
      // Silently continue with current version
      return false;
    }
  } catch {
    // Any unexpected error, just continue with current version
    return false;
  }
}

/**
 * Restart the current process with the same arguments
 */
export function restartProcess(): void {
  const args = process.argv.slice(1);
  const nodeExecutable = process.argv[0];

  // Use spawn to start a new process and exit this one
  const { spawn } = require("child_process");

  const child = spawn(nodeExecutable, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    detached: true,
    env: process.env
  });

  child.unref();
  process.exit(0);
}
