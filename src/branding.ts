import { brandConfig, brandSlug } from '../brand.config.js'

export type AppWordmark =
  | { type: 'text'; parts: ReadonlyArray<{ text: string; color: 'vibe' | 'step' }> }
  | { type: 'image'; src: string; alt?: string }

export type AppBrand = {
  name: string
  slug: string
  icon?: string
  wordmark: AppWordmark
  colors: {
    vibe: string
    step: string
  }
}

export const appBrand: AppBrand = {
  name: brandConfig.name,
  slug: brandSlug,
  ...(brandConfig.web.icon ? { icon: brandConfig.web.icon } : {}),
  wordmark: brandConfig.web.wordmark
    ? { type: 'image', src: brandConfig.web.wordmark, alt: brandConfig.name }
    : { type: 'text', parts: brandConfig.web.wordmarkText },
  colors: brandConfig.colors,
}

export function applyAppBrandToDocument(brand: AppBrand = appBrand) {
  document.title = brand.name
  document.documentElement.style.setProperty('--brand-vibe', brand.colors.vibe)
  document.documentElement.style.setProperty('--brand-step', brand.colors.step)

  const icon = document.querySelector<HTMLLinkElement>('link[data-app-icon]')
  if (!icon) return
  if (brand.icon) icon.href = brand.icon
  else icon.removeAttribute('href')
}
