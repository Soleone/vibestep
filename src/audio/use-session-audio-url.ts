import { useCallback, useEffect, useRef } from 'react'

export type SessionAudioLoad = {
  id: number
  signal: AbortSignal
}

export function useSessionAudioUrl() {
  const currentUrl = useRef<string | null>(null)
  const currentLoadId = useRef(0)
  const currentController = useRef<AbortController | null>(null)

  const beginSessionAudioLoad = useCallback((): SessionAudioLoad => {
    currentController.current?.abort()
    const controller = new AbortController()
    currentController.current = controller
    currentLoadId.current += 1
    return { id: currentLoadId.current, signal: controller.signal }
  }, [])

  const isCurrentSessionAudioLoad = useCallback((load: SessionAudioLoad) => load.id === currentLoadId.current && !load.signal.aborted, [])

  const commitSessionAudioBlob = useCallback((load: SessionAudioLoad, blob: Blob): string | null => {
    if (!isCurrentSessionAudioLoad(load)) return null
    const nextUrl = URL.createObjectURL(blob)
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
    currentUrl.current = nextUrl
    return nextUrl
  }, [isCurrentSessionAudioLoad])

  useEffect(() => () => {
    currentController.current?.abort()
    currentLoadId.current += 1
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
  }, [])

  return { beginSessionAudioLoad, commitSessionAudioBlob, isCurrentSessionAudioLoad }
}
