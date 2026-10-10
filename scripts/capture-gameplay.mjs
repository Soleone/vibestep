#!/usr/bin/env node
// Plays the built-in song in Play with an autoplayer pressing each lane key on time, and encodes the run as a looping WebP.
// Usage: npm run media:capture -- [--url https://vibestep.soleone.xyz] [--out docs/media/gameplay.webp]
// Needs agent-browser (with its browser installed) and FFmpeg on the PATH. Recording and encoding come from showcase.
import { record } from '@soleone/showcase/capture'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { url: { type: 'string', default: 'https://vibestep.soleone.xyz' }, out: { type: 'string', default: 'docs/media/gameplay.webp' } } })

// Song seconds to record: from just before the first note reaches its pad until the last hold has ended.
const clip = { startS: 13.2, endS: 30.8 }
const keys = { kick: 'KeyA', snare: 'KeyD', low: 'ArrowLeft', mid: 'ArrowDown', high: 'ArrowRight' }

// Runs in the page: reads the projectiles in flight from React state and presses each lane key at its impact time.
// The headless audio clock jitters by up to 100 ms, so following the projectiles is the only way to land Perfects.
const autoplayer = `(() => {
  const keys = ${JSON.stringify(keys)}
  const container = document.getElementById('root')
  const rootKey = Object.keys(container).find((key) => key.startsWith('__reactContainer$'))
  const press = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }))
  const isAttackList = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item?.impactMs === 'number' && 'travelMs' in item)
  function activeAttacks(fiber = container[rootKey].stateNode.current) {
    for (; fiber; fiber = fiber.child) {
      for (let hook = fiber.memoizedState; hook && typeof hook === 'object' && 'next' in hook; hook = hook.next) {
        if (isAttackList(hook.memoizedState)) return hook.memoizedState
      }
    }
    return []
  }
  // Timers fire 40-70 ms late while the page streams frames, so each key goes down on the frame closest to its impact.
  const pending = new Map()
  let lastFrameAt = performance.now()
  let frameMs = 33
  const tick = () => {
    const now = performance.now()
    frameMs = frameMs * 0.9 + (now - lastFrameAt) * 0.1
    lastFrameAt = now
    for (const attack of activeAttacks()) if (!attack.initialMissed && !pending.has(attack.id)) pending.set(attack.id, attack)
    for (const [id, attack] of pending) {
      if (attack.done || attack.impactMs - now > frameMs / 2) continue
      attack.done = true
      const code = keys[attack.lane ?? 'mid']
      press('keydown', code)
      setTimeout(() => press('keyup', code), Math.max(80, attack.durationMs ?? 0))
    }
    if (document.querySelector('audio').currentTime < ${clip.endS}) requestAnimationFrame(tick)
  }
  document.querySelector('audio').currentTime = ${clip.startS}
  requestAnimationFrame(tick)
  return Date.now()
})()`

const runStats = `Object.fromEntries(document.body.innerText.match(/(Perfect|Good|Hit) \\d+|MISS\\s+\\d+/g).map((stat) => stat.split(/\\s+/)))`

let stats
const { frames, durationMs, grid } = await record({
  url: values.url,
  out: values.out,
  // Keeps the band with the lanes, the judgement counter and the run stats; above and below it is empty playfield.
  crop: 'iw:ih*43/75:0:ih*16/75',
  // A frame hitch longer than the Perfect window costs a note now and then, so a run gets five tries.
  attempts: 5,
  // A new session has empty storage, so this is a first visit: the welcome dialog with the built-in song loaded.
  start: (page) => page.waitFor(`[...document.querySelectorAll('button')].some((button) => button.innerText.trim().startsWith('Play Bouncer'))`),
  async drive(page) {
    // A real click counts as the user gesture that lets the audio start.
    await page.click('Play Bouncer')
    await page.waitFor(`document.querySelector('audio') && !document.querySelector('audio').paused`)
    // Let the welcome dialog finish closing so the loop starts on a clear playfield.
    await page.waitFor(`!document.querySelector('[role=dialog]')`)
    await page.sleep(400)
    const startAt = await page.eval(autoplayer)
    await page.waitFor(`document.querySelector('audio').currentTime >= ${clip.endS}`, { timeoutMs: (clip.endS - clip.startS + 10) * 1000 })
    return { startAt }
  },
  async verify(page) {
    stats = await page.eval(runStats)
    if (stats.MISS !== '0' || stats.Good !== '0') return `the autoplayer missed notes (${JSON.stringify(stats)})`
  },
})
console.log(`Wrote ${values.out} from ${frames} frames over ${(durationMs / 1000).toFixed(1)} s\nPerfect ${stats.Perfect} of ${stats.Hit} hits, no misses\nFrames to look at: ${grid}`)
