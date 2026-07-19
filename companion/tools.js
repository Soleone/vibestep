import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const YT_DLP_VERSION = '2026.07.04'
const FFMPEG_VERSION = '8.0.1-1'

// Release-specific URLs only. Checksums are the SHA-256 asset digests published
// by the upstream GitHub releases and independently verified during provisioning.
export const PINNED_TOOL_MANIFEST = Object.freeze({
  manifestVersion: 1,
  reviewedAt: '2026-07-12',
  tools: {
    ytDlp: {
      'linux-x64': { version: YT_DLP_VERSION, fileName: 'yt-dlp', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp_linux`, sha256: '6bbb3d314cde4febe36e5fa1d55462e29c974f63444e707871834f6d8cc210ae' },
      'win32-x64': { version: YT_DLP_VERSION, fileName: 'yt-dlp.exe', url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp.exe`, sha256: '52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8' },
    },
    ffmpeg: {
      'linux-x64': { version: FFMPEG_VERSION, fileName: 'ffmpeg', url: `https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n${FFMPEG_VERSION}/ffmpeg-linux-x64`, sha256: 'b66cc32cd45584ff5f65b8957be4fa93b43d002c502808248f6de3fc5cbc1c31' },
      'win32-x64': { version: FFMPEG_VERSION, fileName: 'ffmpeg.exe', url: `https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n${FFMPEG_VERSION}/ffmpeg-win-x64.exe`, sha256: '73d555001653d97d3bb328e68e3eb36cf0dca395babd3714d4e51c42da9b16ba' },
    },
    ffprobe: {
      'linux-x64': { version: FFMPEG_VERSION, fileName: 'ffprobe', url: `https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n${FFMPEG_VERSION}/ffprobe-linux-x64`, sha256: 'bf17ec7817000216e6e2c9aada94678225d85dadee9c79040906256bcc48f84b' },
      'win32-x64': { version: FFMPEG_VERSION, fileName: 'ffprobe.exe', url: `https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n${FFMPEG_VERSION}/ffprobe-win-x64.exe`, sha256: '1a37f089d21c177c189e0fd8c5d8cafe775f64f7ebca847f66ae3fd192ea6090' },
    },
  },
})

export function configuredTools(env = process.env) {
  return {
    ytDlp: env.VIBESTEP_YT_DLP ?? 'yt-dlp',
    ffmpeg: env.VIBESTEP_FFMPEG ?? 'ffmpeg',
    ffprobe: env.VIBESTEP_FFPROBE ?? 'ffprobe',
  }
}

export function toolPlatformKey(platform = process.platform, arch = process.arch) {
  const platformKey = `${platform}-${arch}`
  if (platformKey !== 'linux-x64' && platformKey !== 'win32-x64') throw new Error(`No reviewed media tools for ${platformKey}. Configure trusted binary overrides.`)
  return platformKey
}

async function hasExpectedChecksum(file, sha256) {
  try {
    const bytes = await readFile(file)
    return createHash('sha256').update(bytes).digest('hex') === sha256
  } catch {
    return false
  }
}

export async function provisionPinnedTool({ name, platformKey, dataDir, fetchImpl = fetch, manifest = PINNED_TOOL_MANIFEST }) {
  const descriptor = manifest.tools?.[name]?.[platformKey]
  if (!descriptor?.url || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) throw new Error(`No reviewed pinned ${name} binary for ${platformKey}. Configure a trusted binary override.`)
  const toolDir = path.join(dataDir, 'tools', descriptor.version)
  const destination = path.join(toolDir, descriptor.fileName)
  if (await hasExpectedChecksum(destination, descriptor.sha256)) return destination
  await mkdir(toolDir, { recursive: true })
  const temporary = `${destination}.tmp`
  await rm(temporary, { force: true })
  const response = await fetchImpl(descriptor.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Failed to provision ${name}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const checksum = createHash('sha256').update(bytes).digest('hex')
  if (checksum !== descriptor.sha256) throw new Error(`Checksum mismatch while provisioning ${name}`)
  await writeFile(temporary, bytes, { mode: 0o700 })
  await rename(temporary, destination)
  await chmod(destination, 0o700)
  return destination
}

export async function provisionCompanionTools({ dataDir, env = process.env, platform = process.platform, arch = process.arch, fetchImpl = fetch, manifest = PINNED_TOOL_MANIFEST }) {
  const overrides = { ytDlp: env.VIBESTEP_YT_DLP, ffmpeg: env.VIBESTEP_FFMPEG, ffprobe: env.VIBESTEP_FFPROBE }
  if (Object.values(overrides).every(Boolean)) return overrides
  const platformKey = toolPlatformKey(platform, arch)
  const entries = await Promise.all(Object.entries(overrides).map(async ([name, override]) => [name, override ?? await provisionPinnedTool({ name, platformKey, dataDir, fetchImpl, manifest })]))
  return Object.fromEntries(entries)
}
