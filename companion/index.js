import { homedir } from 'node:os'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { VIBESTEP_WEB_URL } from './config.js'
import { createCompanionApp, DEFAULT_PORT } from './server.js'
import { provisionCompanionTools } from './tools.js'
import { companionName } from '../brand.config.js'

export function defaultDataDir(platform = process.platform, env = process.env) {
  if (env.VIBESTEP_COMPANION_DATA_DIR) return path.resolve(env.VIBESTEP_COMPANION_DATA_DIR)
  if (platform === 'win32') return path.join(env.LOCALAPPDATA ?? homedir(), companionName)
  return path.join(env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share'), 'vibestep-companion')
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
    console.log(`${companionName} audio cache cleared.`)
    return null
  }
  if (argv.includes('--rotate-secret')) {
    await rm(path.join(dataDir, 'secret'), { force: true })
    console.log(`${companionName} pairing secret rotated. Start the companion to pair again.`)
    return null
  }
  const port = Number(env.VIBESTEP_COMPANION_PORT ?? DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid companion port')
  const webUrl = env.VIBESTEP_WEB_URL ?? VIBESTEP_WEB_URL
  const allowedOrigins = [...new Set([
    new URL(webUrl).origin,
    ...(env.VIBESTEP_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim()).filter(Boolean),
  ])]
  console.log('Checking pinned media tools...')
  const tools = await provisionCompanionTools({ dataDir, env })
  const { app, secret } = await createCompanionApp({ port, dataDir, allowedOrigins, webUrl, tools })
  const server = app.listen(port, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const pairing = Buffer.from(JSON.stringify({ credential: secret, baseUrl: `http://127.0.0.1:${port}` })).toString('base64url')
  const target = new URL(webUrl)
  target.hash = `vibestep-companion=${pairing}`
  console.log(`${companionName} ${port} is ready on loopback.`)
  console.log('Audio stays in the local companion data directory.')
  console.log(`Pair manually if needed: http://127.0.0.1:${port}/v1/pair`)
  if (!argv.includes('--no-open')) setTimeout(() => openUrl(target.toString()), 750)
  return server
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  startCompanion().catch((error) => {
    console.error(`${companionName} failed: ${error.message}`)
    process.exitCode = 1
  })
}
