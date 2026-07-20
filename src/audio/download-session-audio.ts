import type { BuiltInSongAudio } from '../builtin-songs/catalog.ts'

function toHex(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0')
  return result
}

export async function downloadSessionAudio(audio: BuiltInSongAudio, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(audio.url, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Song download failed with HTTP ${response.status}`)

  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== audio.byteLength) throw new Error(`Song download was incomplete: expected ${audio.byteLength} bytes, received ${bytes.byteLength}`)

  const digest = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
  if (digest !== audio.sha256) throw new Error('Song download did not match its expected SHA-256 checksum')

  return new Blob([bytes], { type: audio.contentType })
}
