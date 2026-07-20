import { BUILT_IN_SONG_CATALOG_URL, parseBuiltInSongCatalog, type BuiltInSongCatalog } from './catalog.ts'

export async function loadBuiltInSongCatalog(url = BUILT_IN_SONG_CATALOG_URL): Promise<BuiltInSongCatalog> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Built-in song catalog failed with HTTP ${response.status}`)
  return parseBuiltInSongCatalog(await response.json())
}
