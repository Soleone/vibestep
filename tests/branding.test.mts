import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { brandConfig, brandSlug, companionName } from '../brand.config.js'
import builderConfig from '../electron-builder.config.js'
import { appBrand } from '../src/branding.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeBrandConsumers = [
  'src/branding.ts',
  'src/index.css',
  'src/App.css',
  'src/App.tsx',
  'src/components/AppBrand.tsx',
  'src/components/PerformanceHistoryTransfer.tsx',
  'companion/index.js',
  'companion/server.js',
  'desktop/main.js',
  'desktop/status.html',
  'desktop/status.css',
  'desktop/status.js',
  'electron-builder.config.js',
  'package.json',
]

test('shares one brand configuration across web and companion surfaces', () => {
  assert.equal(appBrand.name, brandConfig.name)
  assert.equal(appBrand.slug, brandSlug)
  assert.deepEqual(appBrand.colors, brandConfig.colors)
  assert.equal(brandConfig.web.wordmarkText.map((part) => part.text).join(''), brandConfig.name)
  assert.equal(companionName, `${brandConfig.name} Companion`)
  assert.equal(builderConfig.productName, companionName)
  assert.ok(builderConfig.files.includes('brand.config.js'))
})

test('keeps current brand literals out of runtime consumers', () => {
  for (const relativePath of runtimeBrandConsumers) {
    const source = readFileSync(resolve(root, relativePath), 'utf8')
    assert.equal(source.includes(brandConfig.name), false, `${relativePath} hardcodes the brand name`)
    assert.equal(source.includes(brandConfig.colors.vibe), false, `${relativePath} hardcodes the Vibe color`)
    assert.equal(source.includes(brandConfig.colors.step), false, `${relativePath} hardcodes the Step color`)
  }
})

test('validates configured colors and optional assets', () => {
  assert.match(brandConfig.colors.vibe, /^#[0-9a-f]{6}$/i)
  assert.match(brandConfig.colors.step, /^#[0-9a-f]{6}$/i)
  assert.match(brandSlug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)

  const webAssets = [brandConfig.web.icon, brandConfig.web.wordmark].filter((value): value is string => Boolean(value))
  for (const asset of webAssets) assert.equal(existsSync(resolve(root, 'public', asset.replace(/^\//, ''))), true, `Missing web brand asset: ${asset}`)

  const companionAssets = [brandConfig.companion.iconPng, brandConfig.companion.iconIco, brandConfig.companion.wordmark].filter((value): value is string => Boolean(value))
  for (const asset of companionAssets) assert.equal(existsSync(resolve(root, asset)), true, `Missing companion brand asset: ${asset}`)
})
