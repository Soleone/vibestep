import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createCompanionApp } from './server.js'

function request(port, pathName, { method = 'GET', origin = 'http://localhost:5173', token, range } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: '127.0.0.1:0', Origin: origin }
    if (token) headers.Authorization = `Bearer ${token}`
    if (range) headers.Range = range
    const req = http.request({ hostname: '127.0.0.1', port, path: pathName, method, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), json: () => JSON.parse(Buffer.concat(chunks).toString()) }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function fixture() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'vibestep-companion-'))
  const { app, cache } = await createCompanionApp({ dataDir, port: 0, secret: 'test-secret', allowedOrigins: ['http://localhost:5173'] })
  await writeFile(path.join(cache.audioDir, 'audio.m4a'), Buffer.from('0123456789'))
  await cache.add({ id: 'audio-id', fileName: 'audio.m4a', title: 'Fixture', durationMs: 1000, contentType: 'audio/mp4', size: 10, sourceUrl: 'https://youtu.be/fixture', createdAt: new Date().toISOString() })
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)) })
  return { server, port: server.address().port }
}

test('status is public but library data requires authentication and trusted origin', async (t) => {
  const { server, port } = await fixture()
  t.after(() => server.close())
  assert.equal((await request(port, '/v1/status')).status, 200)
  assert.equal((await request(port, '/v1/library/by-source?url=https%3A%2F%2Fyoutu.be%2Ffixture')).status, 401)
  assert.equal((await request(port, '/v1/library/by-source?url=https%3A%2F%2Fyoutu.be%2Ffixture', { token: 'test-secret' })).status, 200)
  assert.equal((await request(port, '/v1/status', { origin: 'https://evil.example' })).status, 403)
})

test('signed audio supports HEAD, range responses, and rejects tampering', async (t) => {
  const { server, port } = await fixture()
  t.after(() => server.close())
  const signed = await request(port, '/v1/audio/audio-id?sign=1', { token: 'test-secret' })
  assert.equal(signed.status, 200)
  const signedUrl = new URL(signed.json().url)
  const ranged = await request(port, `${signedUrl.pathname}${signedUrl.search}`, { range: 'bytes=2-5' })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.body.toString(), '2345')
  assert.equal(ranged.headers['content-range'], 'bytes 2-5/10')
  const head = await request(port, `${signedUrl.pathname}${signedUrl.search}`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.body.length, 0)
  signedUrl.searchParams.set('signature', 'tampered')
  assert.equal((await request(port, `${signedUrl.pathname}${signedUrl.search}`)).status, 401)
})
