export type AppWordmark =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string; alt?: string }

export type AppBrand = {
  name: string
  icon: string
  wordmark: AppWordmark
}

export const appBrand: AppBrand = {
  name: 'Beat Fiend',
  icon: '/beat-fiend-logo.png',
  wordmark: { type: 'text', value: 'Beat Fiend' },
}

export function applyAppBrandToDocument(brand: AppBrand = appBrand) {
  document.title = brand.name

  const icon = document.querySelector<HTMLLinkElement>('link[data-app-icon]')
  if (icon) icon.href = brand.icon
}
