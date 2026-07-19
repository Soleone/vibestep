/**
 * @typedef {object} BrandConfig
 * @property {string} name
 * @property {{ vibe: string, step: string }} colors
 * @property {{ icon: string | null, headerIcon: string | null, wordmark: string | null, wordmarkText: Array<{ text: string, color: 'vibe' | 'step' }> }} web
 * @property {{ iconPng: string | null, iconIco: string | null, headerIcon: string | null, wordmark: string | null }} companion
 */

/** @type {BrandConfig} */
export const brandConfig = Object.freeze({
  name: 'Vibestep',
  colors: Object.freeze({
    vibe: '#ff5ea8',
    step: '#c7f464',
  }),
  web: Object.freeze({
    icon: '/vibestep-logo.png',
    headerIcon: null,
    wordmark: null,
    wordmarkText: Object.freeze([
      Object.freeze({ text: 'Vibe', color: 'vibe' }),
      Object.freeze({ text: 'step', color: 'step' }),
    ]),
  }),
  companion: Object.freeze({
    iconPng: 'desktop/vibestep-logo.png',
    iconIco: 'desktop/vibestep-logo.ico',
    headerIcon: null,
    wordmark: null,
  }),
})

export const brandSlug = brandConfig.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const companionName = `${brandConfig.name} Companion`
export const companionArtifactName = `${brandConfig.name}-Companion-Setup.exe`
