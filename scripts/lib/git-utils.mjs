import { execSync } from 'node:child_process';

/**
 * Get the current git branch name.
 * @param {string} [cwd] - Working directory
 * @returns {string|null} Branch name or null if not in a git repo
 */
export function getCurrentBranch(cwd = process.cwd()) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Find the PR number for a given branch using GitHub CLI.
 * @param {string} branch - Branch name
 * @param {string} [cwd] - Working directory
 * @returns {{ number: number, url: string }|null} PR info or null
 */
export function findPrForBranch(branch, cwd = process.cwd()) {
  try {
    const output = execSync(
      `gh pr list --head "${branch}" --json number,url --limit 1`,
      {
        cwd,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const prs = JSON.parse(output);
    if (prs && prs.length > 0) {
      return { number: prs[0].number, url: prs[0].url };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a branch is a main/default branch.
 * @param {string} branch
 * @returns {boolean}
 */
export function isMainBranch(branch) {
  return ['main', 'master', 'develop'].includes(branch);
}

/**
 * Get the current HEAD commit hash.
 * @param {string} [cwd] - Working directory
 * @returns {string|null} Commit hash or null
 */
export function getHeadCommit(cwd = process.cwd()) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the root of the current git repository.
 * In a submodule, returns the submodule root (not the parent superproject),
 * so that git/gh operations target the submodule's own remote.
 * @param {string} [cwd] - Working directory
 * @returns {string} Absolute path to git root
 */
export function getGitRoot(cwd = process.cwd()) {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return cwd;
  }
}

/**
 * Get the diff between a start commit and HEAD.
 * @param {string} startCommit - Commit hash to diff from
 * @param {string} [cwd] - Working directory
 * @param {string[]} [paths] - Optional path filters (e.g. ["packages/api/**"]) for monorepo scoping
 * @returns {{ stat: string, diff: string, filesChanged: number, linesAdded: number, linesRemoved: number }|null}
 */
export function getSessionDiff(startCommit, cwd = process.cwd(), paths = []) {
  if (!startCommit) return null;

  const pathSuffix = paths.length > 0 ? ' -- ' + paths.map(p => `"${p}"`).join(' ') : '';

  try {
    const stat = execSync(`git diff --stat ${startCommit}..HEAD${pathSuffix}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    let diff = execSync(`git diff ${startCommit}..HEAD${pathSuffix}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Truncate diff to 50KB to stay within API limits
    const MAX_DIFF_SIZE = 50 * 1024;
    if (diff.length > MAX_DIFF_SIZE) {
      diff = diff.slice(0, MAX_DIFF_SIZE) + '\n\n... [diff truncated at 50KB]';
    }

    const shortstat = execSync(`git diff --shortstat ${startCommit}..HEAD${pathSuffix}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Parse shortstat: "3 files changed, 10 insertions(+), 2 deletions(-)"
    const filesMatch = shortstat.match(/(\d+) files? changed/);
    const addMatch = shortstat.match(/(\d+) insertions?\(\+\)/);
    const delMatch = shortstat.match(/(\d+) deletions?\(-\)/);

    return {
      stat,
      diff,
      filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      linesAdded: addMatch ? parseInt(addMatch[1], 10) : 0,
      linesRemoved: delMatch ? parseInt(delMatch[1], 10) : 0,
    };
  } catch {
    return null;
  }
}
