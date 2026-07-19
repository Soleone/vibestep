/**
 * @typedef {object} BrandConfig
 * @property {string} name
 * @property {{ vibe: string, step: string }} colors
 * @property {{ icon: string | null, wordmark: string | null }} web
 * @property {{ iconPng: string | null, iconIco: string | null, wordmark: string | null }} companion
 */

/** @type {BrandConfig} */
export const brandConfig = Object.freeze({
  name: 'Vibestep',
  colors: Object.freeze({
    vibe: '#ff5ea8',
    step: '#c7f464',
  }),
  web: Object.freeze({
    icon: null,
    wordmark: null,
  }),
  companion: Object.freeze({
    iconPng: null,
    iconIco: null,
    wordmark: null,
  }),
})

export const brandSlug = brandConfig.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const companionName = `${brandConfig.name} Companion`
