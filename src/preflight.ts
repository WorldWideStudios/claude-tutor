import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import type { PreflightResult } from './types.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the tutor's own installation directory (to prevent self-destruction)
 */
function getTutorInstallDir(): string {
  // This file is in dist/ or src/, go up to package root
  return path.resolve(__dirname, '..');
}

/**
 * Dangerous directories that should never be used as project directories
 */
function isDangerousDirectory(dir: string): { dangerous: boolean; reason?: string } {
  const resolved = path.resolve(dir);
  const tutorDir = getTutorInstallDir();

  // Never allow tutor's own directory or subdirectories
  if (resolved.startsWith(tutorDir) || tutorDir.startsWith(resolved)) {
    return { dangerous: true, reason: 'Cannot use the tutor installation directory as a project folder.' };
  }

  // Never allow system directories
  const systemDirs = [
    '/usr', '/bin', '/sbin', '/etc', '/var', '/System', '/Library',
    '/Applications', '/private', '/opt',
    os.homedir(), // Don't allow home root itself
    path.join(os.homedir(), 'Library'),
    path.join(os.homedir(), 'Documents'), // Don't allow Documents root
    path.join(os.homedir(), 'Desktop'),   // Don't allow Desktop root
  ];

  for (const sysDir of systemDirs) {
    if (resolved === sysDir) {
      return { dangerous: true, reason: `Cannot use ${sysDir} directly. Create a project subfolder instead.` };
    }
  }

  // Check if directory contains package.json with "claude-tutor" (our own project)
  const pkgPath = path.join(resolved, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name === 'claude-tutor') {
        return { dangerous: true, reason: 'Cannot use the tutor source directory as a project folder.' };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return { dangerous: false };
}

/**
 * Get the default projects directory
 */
export function getProjectsBaseDir(): string {
  return path.join(os.homedir(), '.claude-tutor', 'projects');
}

/**
 * Create a safe project directory
 */
export function createProjectDirectory(projectName: string): string {
  const baseDir = getProjectsBaseDir();
  const safeName = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'project';

  const timestamp = Date.now().toString(36);
  const projectDir = path.join(baseDir, `${safeName}-${timestamp}`);

  // Create the directory
  fs.mkdirSync(projectDir, { recursive: true });

  return projectDir;
}

/**
 * Run pre-flight checks before starting the tutor.
 * Hard exit if any check fails - don't let AI try to fix these.
 */
export function runPreflightChecks(cwd: string): PreflightResult {
  // Check 1: Node version >= 18
  try {
    const nodeVersion = execSync('node -v', { encoding: 'utf-8' }).trim();
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
    if (majorVersion < 18) {
      return {
        ok: false,
        error: `Node ${nodeVersion} is too old. Claude Tutor requires Node v18 or higher.`
      };
    }
  } catch {
    return {
      ok: false,
      error: 'Could not determine Node version. Is Node.js installed?'
    };
  }

  // Check 2: Git is installed and in PATH
  try {
    execSync('git --version', { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    return {
      ok: false,
      error: 'Git not found. Please install Git first: https://git-scm.com/downloads'
    };
  }

  // Check 3: Directory is not dangerous
  const dangerCheck = isDangerousDirectory(cwd);
  if (dangerCheck.dangerous) {
    return {
      ok: false,
      error: dangerCheck.reason!
    };
  }

  // Check 4: Directory exists and is writable
  try {
    fs.accessSync(cwd, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      error: `Cannot write to directory: ${cwd}\nPlease choose a writable directory.`
    };
  }

  return { ok: true };
}
