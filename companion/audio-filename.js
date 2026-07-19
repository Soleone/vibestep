const MAX_TITLE_LENGTH = 120

export function readableAudioFileName(title, id) {
  const titleWithoutExtension = String(title || 'audio').replace(/\.[a-z0-9]{2,5}$/i, '')
  const readableTitle = titleWithoutExtension
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_LENGTH)
    .replace(/-+$/g, '') || 'audio'
  const stableSuffix = String(id).toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]/g, '')
  return `${readableTitle}-${stableSuffix}.m4a`
}
