export type BrandConfig = {
  name: string
  colors: {
    vibe: string
    step: string
  }
  web: {
    icon: string | null
    wordmark: string | null
  }
  companion: {
    iconPng: string | null
    iconIco: string | null
    wordmark: string | null
  }
}

export const brandConfig: BrandConfig
export const brandSlug: string
export const companionName: string
