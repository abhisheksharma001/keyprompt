import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { test } from 'node:test'
import { requestSecretWithCard } from '../src/card-server.mjs'

/**
 * Start a card and hand back its URL, the pending result and the values the
 * store received.
 */
function startCard(overrides = {}) {
  const stored = []
  let resolveUrl
  const urlReady = new Promise((r) => {
    resolveUrl = r
  })
  const result = requestSecretWithCard({
    name: 'OPENAI_API_KEY',
    reason: 'Run the <eval> & check "notes"',
    requester: 'Claude Code in repo',
    storeLabel: 'macOS Keychain',
    replacing: false,
    allowSessionOnly: true,
    open: async (url) => {
      resolveUrl(url)
      return true
    },
    onSubmit: async (value, remember) => {
      stored.push({ value, remember })
    },
    ...overrides,
  })
  result.catch(() => {})
  return { urlReady, result, stored }
}

/** Raw HTTP so the test controls Host and Origin exactly. */
function send(url, { method = 'GET', host, origin, contentType = 'application/json', body } = {}) {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const headers = { Host: host ?? u.host }
    if (origin !== null) headers.Origin = origin ?? u.origin
    if (body !== undefined) headers['Content-Type'] = contentType
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

test('serves the card on 127.0.0.1 with the name and an escaped reason, never cached', async () => {
  const { urlReady, result } = startCard()
  const url = await urlReady
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/card\/[A-Za-z0-9_-]{43}$/)
  const page = await send(url)
  assert.equal(page.status, 200)
  assert.equal(page.headers['cache-control'], 'no-store')
  assert.match(page.headers['content-security-policy'], /default-src 'none'/)
  assert.ok(page.text.includes('OPENAI_API_KEY'))
  assert.ok(page.text.includes('Run the &lt;eval&gt; &amp; check &quot;notes&quot;'))
  assert.ok(!page.text.includes('<eval>'))
  assert.ok(page.text.includes('Remember on this computer'))
  await send(`${url}/cancel`, { method: 'POST', body: {} })
  await assert.rejects(result, (e) => e.exitCode === 4)
})

test('a submitted value is trimmed, stored and resolved; the card then refuses further use', async () => {
  const { urlReady, result, stored } = startCard()
  const url = await urlReady
  const res = await send(`${url}/submit`, { method: 'POST', body: { value: '  sk-test-123\n', remember: true } })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.text), { remembered: true })
  assert.deepEqual(await result, { remembered: true, value: 'sk-test-123' })
  assert.deepEqual(stored, [{ value: 'sk-test-123', remember: true }])
  const again = await send(`${url}/submit`, { method: 'POST', body: { value: 'other' } }).catch(() => ({ status: 'closed' }))
  assert.ok(again.status === 410 || again.status === 'closed')
})

test('"this run only" is passed through when allowed, and ignored when not', async () => {
  const once = startCard()
  await send(`${await once.urlReady}/submit`, { method: 'POST', body: { value: 'v1', remember: false } })
  assert.deepEqual(await once.result, { remembered: false, value: 'v1' })

  const always = startCard({ allowSessionOnly: false })
  const page = await send(await always.urlReady)
  assert.ok(!page.text.includes('Remember on this computer'))
  await send(`${await always.urlReady}/submit`, { method: 'POST', body: { value: 'v2', remember: false } })
  assert.deepEqual(await always.result, { remembered: true, value: 'v2' })
})

test('rejects a wrong token, a foreign Host (DNS rebinding) and a foreign or missing Origin', async () => {
  const { urlReady, result, stored } = startCard()
  const url = await urlReady
  const u = new URL(url)
  const wrongToken = `${u.origin}/card/${'A'.repeat(43)}`

  assert.equal((await send(wrongToken)).status, 404)
  assert.equal((await send(`${wrongToken}/submit`, { method: 'POST', body: { value: 'x' } })).status, 404)
  assert.equal((await send(url, { host: `evil.example:${u.port}` })).status, 403)
  assert.equal((await send(url, { host: `localhost:${u.port}` })).status, 403)
  assert.equal((await send(`${url}/submit`, { method: 'POST', origin: 'https://evil.example', body: { value: 'x' } })).status, 403)
  assert.equal((await send(`${url}/submit`, { method: 'POST', origin: null, body: { value: 'x' } })).status, 403)
  assert.equal((await send(`${url}/submit`, { method: 'POST', contentType: 'text/plain', body: { value: 'x' } })).status, 415)
  assert.equal((await send(`${url}/submit`, { method: 'POST', body: { value: '   ' } })).status, 400)
  assert.deepEqual(stored, [])

  await send(`${url}/cancel`, { method: 'POST', body: {} })
  await assert.rejects(result)
})

test('a store failure is shown on the card and the person can try again', async () => {
  let attempts = 0
  const { urlReady, result } = startCard({
    onSubmit: async () => {
      attempts++
      if (attempts === 1) {
        const { KeypromptError } = await import('../src/errors.mjs')
        throw new KeypromptError('Keychain is locked.')
      }
    },
  })
  const url = await urlReady
  const first = await send(`${url}/submit`, { method: 'POST', body: { value: 'k' } })
  assert.equal(first.status, 422)
  assert.equal(JSON.parse(first.text).error, 'Keychain is locked.')
  const second = await send(`${url}/submit`, { method: 'POST', body: { value: 'k' } })
  assert.equal(second.status, 200)
  assert.equal((await result).value, 'k')
})

test('times out with exit code 5 when nobody fills it in', async () => {
  const { result } = startCard({ timeoutMs: 50 })
  await assert.rejects(result, (e) => e.exitCode === 5)
})

test('fails with a clear message when no browser can be opened', async () => {
  const { result } = startCard({ open: async () => false })
  await assert.rejects(result, /Could not open a browser/)
})
