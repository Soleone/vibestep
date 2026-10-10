#!/usr/bin/env node
// Plays the built-in song in Play with an autoplayer pressing each lane key on time, and encodes the run as a looping WebP.
// Usage: npm run media:capture -- [--url https://vibestep.soleone.xyz] [--out docs/media/gameplay.webp]
// Needs agent-browser (with its browser installed) and FFmpeg on the PATH.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs, promisify } from 'node:util'

const exec = promisify(execFile)
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

// Collects the session's screencast frames. agent-browser's own recorder writes a fixed 10 fps without frame
// timestamps, which speeds the clip up, so frames are taken from the stream and timed by their own timestamps.
async function streamFrames(url) {
  const frames = []
  const socket = new WebSocket(`${url}/?maxFps=30`)
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.type === 'frame' && message.metadata?.timestamp) frames.push({ at: message.metadata.timestamp, data: message.data })
  }
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error(`Cannot connect to ${url}`)) })
  return { frames, stop: () => socket.close() }
}

async function capture() {
  await exec('agent-browser', ['--version'])
  await exec('ffmpeg', ['-version'])
  const work = await mkdtemp(path.join(tmpdir(), 'vibestep-capture-'))
  // A new session has empty storage, so this is a first visit: the welcome dialog with the built-in song loaded.
  const session = `vibestep-capture-${process.pid}`
  const browser = (...args) => exec('agent-browser', ['--session', session, ...args], { timeout: 60_000, env: { ...process.env, AGENT_BROWSER_STREAM_QUALITY: '92', AGENT_BROWSER_STREAM_MAX_WIDTH: '960' } }).then(({ stdout }) => stdout.trim())
  const evaluate = async (script) => JSON.parse(await browser('eval', script))
  let stream, startAt, endAt, stats
  try {
    await browser('open', 'about:blank')
    await browser('set', 'viewport', '1280', '800')
    await browser('open', values.url)
    await browser('wait', '--fn', `[...document.querySelectorAll('button')].some((button) => button.innerText.trim().startsWith('Play Bouncer'))`)
    stream = await streamFrames((await browser('stream', 'status')).match(/ws:\/\/[\w.:]+/)[0])
    // A real click counts as the user gesture that lets the audio start.
    const ref = (await browser('snapshot', '-i')).match(/button "Play Bouncer" \[ref=(\w+)\]/)?.[1]
    if (!ref) throw new Error('The welcome dialog has no Play Bouncer button')
    await browser('click', `@${ref}`)
    await browser('wait', '--fn', `document.querySelector('audio') && !document.querySelector('audio').paused`)
    // Let the welcome dialog finish closing so the loop starts on a clear playfield.
    await browser('wait', '--fn', `!document.querySelector('[role=dialog]')`)
    await browser('wait', '400')
    startAt = await evaluate(autoplayer)
    await browser('wait', '--fn', `document.querySelector('audio').currentTime >= ${clip.endS}`, '--timeout', String((clip.endS - clip.startS + 10) * 1000))
    endAt = await evaluate('Date.now()')
    stats = await evaluate(`Object.fromEntries(document.body.innerText.match(/(Perfect|Good|Hit) \\d+|MISS\\s+\\d+/g).map((stat) => stat.split(/\\s+/)))`)
  } finally {
    stream?.stop()
    await browser('close').catch(() => {})
  }
  if (stats.MISS !== '0' || stats.Good !== '0') throw Object.assign(new Error(`The autoplayer missed notes, so the clip was not written: ${JSON.stringify(stats)}`), { retry: true })

  // The first frame shows the moment of the seek; each frame lasts until the next one arrives.
  const frames = stream.frames.filter((frame) => frame.at >= startAt && frame.at <= endAt)
  if (frames.length < 2) throw new Error('The stream sent no frames')
  const list = []
  for (const [index, frame] of frames.entries()) {
    const file = `frame-${String(index).padStart(5, '0')}.jpg`
    await writeFile(path.join(work, file), Buffer.from(frame.data, 'base64'))
    list.push(`file '${file}'`, `duration ${((frames[index + 1]?.at ?? endAt) - frame.at) / 1000}`)
  }
  await writeFile(path.join(work, 'frames.txt'), `${list.join('\n')}\nfile '${`frame-${String(frames.length - 1).padStart(5, '0')}.jpg`}'\n`)
  const out = path.resolve(values.out)
  await mkdir(path.dirname(out), { recursive: true })
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'),
    '-vf', 'fps=20,scale=960:-1:flags=lanczos', '-c:v', 'libwebp_anim', '-quality', '75', '-compression_level', '6', '-loop', '0', '-an', out], { timeout: 300_000 })
  await rm(work, { recursive: true })
  console.log(`Wrote ${out} from ${frames.length} frames over ${((endAt - startAt) / 1000).toFixed(1)} s\nPerfect ${stats.Perfect} of ${stats.Hit} hits, no misses`)
}

// A frame hitch longer than the Perfect window costs a note now and then, so a run gets five tries.
async function main() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await capture()
    } catch (error) {
      if (!error.retry || attempt === 5) throw error
      console.error(`${error.message}. Trying again.`)
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
