import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const bump = process.argv[2] ?? 'patch'
const allowedBumps = new Set(['patch', 'minor'])
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    if (capture && result.stderr) process.stderr.write(result.stderr)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }

  return capture ? result.stdout.trim() : result.status
}

function fail(message) {
  console.error(`Companion release aborted: ${message}`)
  process.exit(1)
}

if (!allowedBumps.has(bump)) fail(`expected "patch" or "minor", received "${bump}"`)

const branch = run('git', ['branch', '--show-current'], { capture: true })
if (branch !== 'main') fail(`releases must be prepared from main, current branch is "${branch || 'detached HEAD'}"`)

const worktreeStatus = run('git', ['status', '--porcelain=v1', '--untracked-files=normal'], { capture: true })
if (worktreeStatus) fail('commit or stash all worktree changes first')

run('git', ['fetch', '--quiet', 'origin', 'main', '--tags'])
const remoteIsAncestor = run('git', ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', 'HEAD'], { allowFailure: true }) === 0
if (!remoteIsAncestor) fail('local main is behind or has diverged from origin/main; update it before releasing')

run(npmCommand, ['version', bump, '-m', 'chore: prepare companion %s'])

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`

try {
  run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`])
} catch (error) {
  console.error(`Companion ${version} was prepared locally, but the push failed.`)
  console.error(`Retry with: git push --atomic origin HEAD:refs/heads/main refs/tags/${tag}`)
  throw error
}

console.log(`Companion ${version} pushed. GitHub Actions will build and publish ${tag}.`)
