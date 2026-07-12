import { homedir } from 'node:os'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createCompanionApp, DEFAULT_PORT } from './server.js'
import { provisionCompanionTools } from './tools.js'

export function defaultDataDir(platform = process.platform, env = process.env) {
  if (env.BEAT_FIEND_COMPANION_DATA_DIR) return path.resolve(env.BEAT_FIEND_COMPANION_DATA_DIR)
  if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? homedir(), 'Beat Fiend Companion')
  return path.join(env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'beat-fiend-companion')
}

function openUrl(url) {
  const command = process.platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true })
  child.on('error', () => {})
  child.unref()
}

export async function startCompanion(env = process.env, argv = process.argv.slice(2)) {
  const dataDir = defaultDataDir(process.platform, env)
  if (argv.includes('--clear-cache')) {
    await rm(path.join(dataDir, 'audio'), { recursive: true, force: true })
    await rm(path.join(dataDir, 'library.json'), { force: true })
    console.log('Beat Fiend Companion audio cache cleared.')
    return null
  }
  if (argv.includes('--rotate-secret')) {
    await rm(path.join(dataDir, 'secret'), { force: true })
    console.log('Beat Fiend Companion pairing secret rotated. Start the companion to pair again.')
    return null
  }
  const port = Number(env.BEAT_FIEND_COMPANION_PORT ?? DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid companion port')
  const webUrl = env.BEAT_FIEND_WEB_URL ?? 'http://localhost:5173/'
  const allowedOrigins = (env.BEAT_FIEND_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean)
  console.log('Checking pinned media tools...')
  const tools = await provisionCompanionTools({ dataDir, env })
  const { app, secret } = await createCompanionApp({ port, dataDir, allowedOrigins, webUrl, tools })
  const server = app.listen(port, '127.0.0.1', () => {
    const pairing = Buffer.from(JSON.stringify({ credential: secret, baseUrl: `http://127.0.0.1:${port}` })).toString('base64url')
    const target = new URL(webUrl)
    target.hash = `beat-fiend-companion=${pairing}`
    console.log(`Beat Fiend Companion ${port} is ready on loopback.`)
    console.log('Audio stays in the local companion data directory.')
    console.log(`Pair manually if needed: http://127.0.0.1:${port}/v1/pair`)
    if (!argv.includes('--no-open')) setTimeout(() => openUrl(target.toString()), 750)
  })
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  startCompanion().catch((error) => {
    console.error(`Beat Fiend Companion failed: ${error.message}`)
    process.exitCode = 1
  })
}
