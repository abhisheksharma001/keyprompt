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
    fields: [{ name: 'OPENAI_API_KEY' }],
    reason: 'Run the <eval> & check "notes"',
    requester: 'Claude Code in repo',
    storeLabel: 'macOS Keychain',
    replacing: false,
    allowSessionOnly: true,
    open: async (url) => {
      resolveUrl(url)
      return true
    },
    onSubmit: async (values, remember) => {
      stored.push({ values: Object.fromEntries(values), remember })
    },
    ...overrides,
  })
  result.catch(() => {})
  return { urlReady, result, stored }
}

/** The submit body for the default one-field card. */
const one = (value, extra = {}) => ({ values: { OPENAI_API_KEY: value }, ...extra })

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

/** The page's HTML for each field row, keyed by field name. */
function rowsOf(html) {
  const part = html.slice(html.indexOf('<div class="rows">'), html.indexOf('id="error"'))
  return Object.fromEntries(
    part
      .split('<div class="row" data-name="')
      .slice(1)
      .map((row) => [row.slice(0, row.indexOf('"')), row]),
  )
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
  assert.ok(page.text.includes('<h1>Secret requested</h1>'))
  assert.ok(page.text.includes('>Save securely</button>'))
  await send(`${url}/cancel`, { method: 'POST', body: {} })
  await assert.rejects(result, (e) => e.exitCode === 4)
})

test('the page script is valid JavaScript', async () => {
  const { urlReady } = startCard({ fields: [{ name: 'A', multiline: true }, { name: 'B' }] })
  const url = await urlReady
  const page = await send(url)
  const script = page.text.slice(page.text.indexOf('>', page.text.indexOf('<script nonce=')) + 1, page.text.lastIndexOf('</script>'))
  assert.ok(script.includes('pasteBox'))
  assert.doesNotThrow(() => new Function(script))
  await send(`${url}/cancel`, { method: 'POST', body: {} })
})

test('a submitted value is trimmed, stored and resolved; the card then refuses further use', async () => {
  const { urlReady, result, stored } = startCard()
  const url = await urlReady
  const res = await send(`${url}/submit`, { method: 'POST', body: one('  sk-test-123\n', { remember: true }) })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.text), { remembered: true })
  assert.deepEqual(await result, { remembered: true, values: new Map([['OPENAI_API_KEY', 'sk-test-123']]) })
  assert.deepEqual(stored, [{ values: { OPENAI_API_KEY: 'sk-test-123' }, remember: true }])
  const again = await send(`${url}/submit`, { method: 'POST', body: one('other') }).catch(() => ({ status: 'closed' }))
  assert.ok(again.status === 410 || again.status === 'closed')
})

test('"this run only" is passed through when allowed, and ignored when not', async () => {
  const once = startCard()
  await send(`${await once.urlReady}/submit`, { method: 'POST', body: one('v1', { remember: false }) })
  assert.deepEqual(await once.result, { remembered: false, values: new Map([['OPENAI_API_KEY', 'v1']]) })

  const always = startCard({ allowSessionOnly: false })
  const page = await send(await always.urlReady)
  assert.ok(!page.text.includes('Remember on this computer'))
  await send(`${await always.urlReady}/submit`, { method: 'POST', body: one('v2', { remember: false }) })
  assert.deepEqual(await always.result, { remembered: true, values: new Map([['OPENAI_API_KEY', 'v2']]) })
})

test('rejects a wrong token, a foreign Host (DNS rebinding) and a foreign or missing Origin', async () => {
  const { urlReady, result, stored } = startCard()
  const url = await urlReady
  const u = new URL(url)
  const wrongToken = `${u.origin}/card/${'A'.repeat(43)}`

  assert.equal((await send(wrongToken)).status, 404)
  assert.equal((await send(`${wrongToken}/submit`, { method: 'POST', body: one('x') })).status, 404)
  assert.equal((await send(url, { host: `evil.example:${u.port}` })).status, 403)
  assert.equal((await send(url, { host: `localhost:${u.port}` })).status, 403)
  assert.equal((await send(`${url}/submit`, { method: 'POST', origin: 'https://evil.example', body: one('x') })).status, 403)
  assert.equal((await send(`${url}/submit`, { method: 'POST', origin: null, body: one('x') })).status, 403)
  assert.equal((await send(`${url}/submit`, { method: 'POST', contentType: 'text/plain', body: one('x') })).status, 415)
  assert.equal((await send(`${url}/submit`, { method: 'POST', body: one('   ') })).status, 400)
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
  const first = await send(`${url}/submit`, { method: 'POST', body: one('k') })
  assert.equal(first.status, 422)
  assert.equal(JSON.parse(first.text).error, 'Keychain is locked.')
  const second = await send(`${url}/submit`, { method: 'POST', body: one('k') })
  assert.equal(second.status, 200)
  assert.equal((await result).values.get('OPENAI_API_KEY'), 'k')
})

test('times out with exit code 5 when nobody fills it in', async () => {
  const { result } = startCard({ timeoutMs: 50 })
  await assert.rejects(result, (e) => e.exitCode === 5)
})

test('fails with a clear message when no browser can be opened', async () => {
  const { result } = startCard({ open: async () => false })
  await assert.rejects(result, /Could not open a browser/)
})

test('one card, several fields: a shown box, a hidden box and an optional box saved together', async () => {
  const { urlReady, result, stored } = startCard({
    fields: [{ name: 'A', visible: true }, { name: 'B' }, { name: 'C', optional: true }],
  })
  const url = await urlReady
  const page = await send(url)
  assert.ok(page.text.includes('<h1>Secrets requested</h1>'))
  assert.ok(page.text.includes('>Save all 3</button>'))
  const rows = rowsOf(page.text)
  assert.deepEqual(Object.keys(rows), ['A', 'B', 'C'])
  assert.match(rows.A, /<input [^>]*type="text" aria-label="Value for A"/)
  assert.match(rows.A, /class="tag">shown</)
  assert.match(rows.B, /<input [^>]*type="password" aria-label="Secret value for B"/)
  assert.ok(!rows.B.includes('class="tag"'))
  assert.match(rows.C, /class="tag">optional</)

  const res = await send(`${url}/submit`, { method: 'POST', body: { values: { A: 'id', B: 'tok', C: '' }, remember: true } })
  assert.equal(res.status, 200)
  const expected = new Map([
    ['A', 'id'],
    ['B', 'tok'],
  ])
  assert.deepEqual(await result, { remembered: true, values: expected })
  assert.deepEqual(stored, [{ values: { A: 'id', B: 'tok' }, remember: true }])
})

test('a name that was not asked for, a non-string value, or the old { value } body gives 400 and saves nothing', async () => {
  const { urlReady, result, stored } = startCard()
  const url = await urlReady
  const bad = [
    { value: 'sk' },
    { values: { OPENAI_API_KEY: 'sk', OTHER_KEY: 'x' } },
    { values: { OPENAI_API_KEY: 5 } },
    { values: ['sk'] },
    { values: null },
    null,
  ]
  for (const body of bad) {
    const res = await send(`${url}/submit`, { method: 'POST', body })
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.deepEqual(JSON.parse(res.text), { error: 'Malformed request.' })
  }
  assert.deepEqual(stored, [])
  // The card is still usable after a bad request.
  assert.equal((await send(`${url}/submit`, { method: 'POST', body: one('sk') })).status, 200)
  assert.equal((await result).values.get('OPENAI_API_KEY'), 'sk')
})

test('a required box left empty gives 400 naming it; empty optional and saved boxes are left out', async () => {
  const { urlReady, result, stored } = startCard({
    fields: [{ name: 'A' }, { name: 'B', optional: true }, { name: 'C', saved: true }],
  })
  const url = await urlReady
  const page = await send(url)
  assert.ok(rowsOf(page.text).C.includes('placeholder="Saved — leave empty to keep"'))

  for (const values of [{ A: '  ', B: 'b', C: 'c' }, { B: 'b' }]) {
    const res = await send(`${url}/submit`, { method: 'POST', body: { values } })
    assert.equal(res.status, 400)
    assert.deepEqual(JSON.parse(res.text), { error: 'Fill in A.', field: 'A' })
  }
  assert.deepEqual(stored, [])

  assert.equal((await send(`${url}/submit`, { method: 'POST', body: { values: { A: 'a', B: '', C: '' } } })).status, 200)
  assert.deepEqual((await result).values, new Map([['A', 'a']]))
})

test('every box empty gives 400 asking for at least one value', async () => {
  const { urlReady, stored } = startCard({
    fields: [{ name: 'A', optional: true }, { name: 'B', saved: true }],
  })
  const url = await urlReady
  for (const values of [{}, { A: '', B: ' \n ' }]) {
    const res = await send(`${url}/submit`, { method: 'POST', body: { values } })
    assert.equal(res.status, 400)
    assert.deepEqual(JSON.parse(res.text), { error: 'Paste at least one value.' })
  }
  assert.deepEqual(stored, [])
  await send(`${url}/cancel`, { method: 'POST', body: {} })
})

test('a multi-line value keeps its line breaks; the page gives it a paste box', async () => {
  const { urlReady, result } = startCard({
    fields: [{ name: 'KEY', multiline: true }, { name: 'NOTE', multiline: true, visible: true, optional: true }],
  })
  const url = await urlReady
  const rows = rowsOf((await send(url)).text)
  assert.match(rows.KEY, /<textarea [^>]*data-paste aria-label="Secret value for KEY"/)
  assert.match(rows.KEY, /class="count"/)
  assert.match(rows.KEY, /class="tag">multi-line</)
  // Shown and multi-line together is a plain text area, not a paste box.
  assert.match(rows.NOTE, /<textarea [^>]*aria-label="Value for NOTE"/)
  assert.ok(!rows.NOTE.includes('data-paste'))

  const pem = '-----BEGIN PRIVATE KEY-----\r\nMIIE\nabc\n-----END PRIVATE KEY-----'
  await send(`${url}/submit`, { method: 'POST', body: { values: { KEY: `\n${pem}\n\n` } } })
  assert.equal((await result).values.get('KEY'), pem)
})

test('the size cap allows a large value and refuses a body over 1 MiB', async () => {
  const { urlReady, result, stored } = startCard()
  const url = await urlReady
  const tooBig = await send(`${url}/submit`, { method: 'POST', body: one('x'.repeat(1024 * 1024)) }).catch(() => ({ status: 'closed' }))
  assert.equal(tooBig.status, 'closed')
  assert.deepEqual(stored, [])

  const large = 'y'.repeat(200 * 1024)
  assert.equal((await send(`${url}/submit`, { method: 'POST', body: one(large) })).status, 200)
  assert.equal((await result).values.get('OPENAI_API_KEY'), large)
})
