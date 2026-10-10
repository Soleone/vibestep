// A saved copy of a built-in song, such as one restored from a library backup, plays the built-in audio unless the user attached their own.
export const usesBuiltInAudio = (association: { storage?: string } | null | undefined) => !association || association.storage === 'builtin'

// Reopens the remembered song, or the first built-in one when nothing is remembered or the remembered song is gone, so Play always has something to play.
export function songToRestore<T extends { id: string; builtIn?: boolean }>(songs: T[], rememberedId: string | null): T | undefined {
  return (rememberedId ? songs.find((song) => song.id === rememberedId) : undefined) ?? songs.find((song) => song.builtIn)
}
