/**
 * The tiny git surface M3 needs: HEAD, how far HEAD is ahead of the manifest commit,
 * and the changed-path list relative to that commit.
 *
 * Deliberately narrow and injectable. `execFileSync` never goes through a shell, and a
 * commit is only accepted when it looks like a hex object id, so a manifest cannot
 * inject git options. Without a repository (or git) every call throws a `GitError` and
 * the caller turns that into a status warning rather than a crash.
 */
import { execFileSync } from 'node:child_process'

const COMMIT = /^[0-9a-f]{7,40}$/u

export class GitError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'GitError'
    this.code = 'git_unavailable'
    this.cause = cause
  }
}

/** Whether a value can be passed to git as a revision. */
export function isCommit(value) {
  return typeof value === 'string' && COMMIT.test(value)
}

/**
 * Create a git runner.
 * @param root0.cwd - repository root.
 * @param root0.run - injectable command runner `(args) => stdout` (tests use a fake).
 */
export function createGit({ cwd, run }) {
  const execute = run ?? (args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  const call = args => {
    try {
      return String(execute(args)).trim()
    } catch (error) {
      throw new GitError(`git ${args.join(' ')} failed: ${error?.message ?? error}`, error)
    }
  }
  return {
    cwd,
    head() {
      const value = call(['rev-parse', 'HEAD'])
      return isCommit(value) ? value : null
    },
    /** Commits HEAD is ahead of `commit`; null when the manifest commit is unknown. */
    commitBehind(commit) {
      if (!isCommit(commit)) return null
      try {
        const value = call(['rev-list', '--count', `${commit}..HEAD`])
        return Number.parseInt(value, 10)
      } catch {
        return null
      }
    },
    /**
     * Changes since `commit`: committed diffs, working-tree edits AND untracked files
     * (`git diff` alone hides untracked, which is exactly the new-file case scan must
     * propose).
     */
    diffNameStatus(commit) {
      const revision = isCommit(commit) ? commit : 'HEAD'
      const text = call(['diff', '--name-status', revision, '--'])
      const entries = text === '' ? [] : text.split('\n').map(line => {
        const parts = line.split('\t')
        return { status: parts[0], path: parts[1], from: parts[2] ?? null }
      }).filter(entry => entry.path !== undefined)
      const known = new Set(entries.map(entry => entry.path))
      const untracked = call(['ls-files', '--others', '--exclude-standard'])
      if (untracked !== '') {
        for (const path of untracked.split('\n')) {
          if (path !== '' && !known.has(path)) entries.push({ status: 'A', path, from: null })
        }
      }
      return entries
    },
  }
}
