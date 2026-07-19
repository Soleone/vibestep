const DEFAULT_COMPANION_URL = 'http://127.0.0.1:47831'
const CREDENTIAL_KEY = 'vibestep:companion:credential:v1'
const BASE_URL_KEY = 'vibestep:companion:base-url:v1'
const PAIRING_FRAGMENT_KEY = 'vibestep-companion'

export type CompanionStatus = { ok: true; name: string; version: string; paired: boolean }
export type CompanionPermissionState = PermissionState | 'not-required' | 'unsupported'
export type CompanionAudio = { audioId: string; title: string; durationMs: number; contentType: string; size: number; sourceUrl?: string }
export type CompanionImportJob = { id: string; state: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'; progress: number; error?: string; audio?: CompanionAudio; cached?: boolean }

type PairingData = { credential: string; baseUrl?: string }

function consumePairingFragment(): PairingData | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null
  const params = new URLSearchParams(hash)
  const encoded = params.get(PAIRING_FRAGMENT_KEY) ?? params.get('companion')
  if (!encoded) return null
  let pairing: PairingData
  try {
    const parsed = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as PairingData
    pairing = parsed
  } catch {
    pairing = { credential: encoded }
  }
  if (!pairing.credential) return null
  params.delete(PAIRING_FRAGMENT_KEY)
  params.delete('companion')
  const suffix = params.toString()
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}${suffix ? `#${suffix}` : ''}`)
  return pairing
}

export class CompanionClient {
  readonly baseUrl: string
  readonly pairingReceived: boolean
  private credential: string | null

  constructor(storage: Storage = localStorage) {
    const pairing = consumePairingFragment()
    this.pairingReceived = Boolean(pairing)
    if (pairing) {
      storage.setItem(CREDENTIAL_KEY, pairing.credential)
      if (pairing.baseUrl) storage.setItem(BASE_URL_KEY, pairing.baseUrl)
    }
    this.baseUrl = storage.getItem(BASE_URL_KEY) ?? import.meta.env.VITE_COMPANION_URL ?? DEFAULT_COMPANION_URL
    this.credential = storage.getItem(CREDENTIAL_KEY)
  }

  get paired() { return Boolean(this.credential) }

  async permissionState(): Promise<CompanionPermissionState> {
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)) return 'not-required'
    if (!navigator.permissions) return 'unsupported'

    const permissions = navigator.permissions as Permissions & {
      query(descriptor: { name: string }): Promise<PermissionStatus>
    }
    for (const name of ['loopback-network', 'local-network-access']) {
      try {
        return (await permissions.query({ name })).state
      } catch {
        // Try the permission name used by other Chromium versions.
      }
    }
    return 'unsupported'
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers)
    if (this.credential) headers.set('Authorization', `Bearer ${this.credential}`)
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, cache: 'no-store', headers })
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('application/json') ? await response.json() : null
    if (!response.ok) throw new Error(body?.error ?? `Companion request failed (${response.status})`)
    return body as T
  }

  status(signal?: AbortSignal) { return this.request<CompanionStatus>('/v1/status', { signal }) }
  pair() { window.location.assign(`${this.baseUrl}/v1/pair`) }
  lookupSource(url: string) { return this.request<{ audio: CompanionAudio | null }>(`/v1/library/by-source?url=${encodeURIComponent(url)}`) }
  startImport(url: string) { return this.request<CompanionImportJob>('/v1/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }) }
  getImport(id: string) { return this.request<CompanionImportJob>(`/v1/imports/${encodeURIComponent(id)}`) }
  cancelImport(id: string) { return this.request<CompanionImportJob>(`/v1/imports/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  uploadFile(file: File) { return this.request<{ audio: CompanionAudio }>('/v1/files', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Companion-Filename': encodeURIComponent(file.name) }, body: file }) }
  playbackUrl(audioId: string) { return this.request<{ url: string; expiresAt: string }>(`/v1/audio/${encodeURIComponent(audioId)}?sign=1`) }

  async downloadAudio(audioId: string, signal?: AbortSignal) {
    const { url } = await this.playbackUrl(audioId)
    const response = await fetch(url, { cache: 'no-store', signal })
    if (!response.ok) throw new Error(`Could not copy audio into the browser (${response.status})`)
    const blob = await response.blob()
    if (blob.size === 0) throw new Error('The companion returned an empty audio file')
    return blob
  }

  async waitForImport(id: string, onProgress?: (job: CompanionImportJob) => void, signal?: AbortSignal) {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError')
      const job = await this.getImport(id)
      onProgress?.(job)
      if (job.state === 'complete' && job.audio) return job
      if (job.state === 'failed' || job.state === 'cancelled') throw new Error(job.error ?? `Import ${job.state}`)
      await new Promise((resolve) => window.setTimeout(resolve, 500))
    }
  }
}
