export type BrandConfig = {
  name: string
  colors: {
    vibe: string
    step: string
  }
  web: {
    icon: string | null
    headerIcon: string | null
    wordmark: string | null
    wordmarkText: ReadonlyArray<{
      text: string
      color: 'vibe' | 'step'
    }>
  }
  companion: {
    iconPng: string | null
    iconIco: string | null
    headerIcon: string | null
    wordmark: string | null
  }
}

export const brandConfig: BrandConfig
export const brandSlug: string
export const companionName: string
export const companionArtifactName: string
