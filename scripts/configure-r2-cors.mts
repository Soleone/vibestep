import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

async function readBucket(): Promise<string> {
  if (process.env.R2_BUCKET) return process.env.R2_BUCKET
  try {
    const contents = await readFile('.env.r2.local', 'utf8')
    const line = contents.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('R2_BUCKET='))
    const value = line?.slice(line.indexOf('=') + 1).trim().replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')
    if (value) return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  throw new Error('Set R2_BUCKET in the environment or .env.r2.local')
}

const bucket = await readBucket()
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(executable, ['--yes', 'wrangler@4.112.0', 'r2', 'bucket', 'cors', 'set', bucket, '--file', 'config/r2-cors.json', '--force'], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Wrangler CORS configuration failed with exit code ${String(result.status)}`)
