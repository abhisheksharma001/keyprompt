import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { test } from 'node:test'
import { MOODS } from '../src/buddy.mjs'
import { requestSecretWithCard } from '../src/card-server.mjs'
import { KeypromptError } from '../src/errors.mjs'
import { saveAll } from '../src/save.mjs'

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
    // A fresh connection each time: the server closes idle ones when a card ends, and a reused one would hang up.
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers, agent: false }, (res) => {
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

test('an ordinary card has no demo banner and names its store', async () => {
  const { urlReady } = startCard()
  const url = await urlReady
  const page = (await send(url)).text
  assert.ok(!page.includes('Demo — nothing you type is saved.'))
  assert.ok(page.includes('<main class="card" aria-live="polite">'))
  assert.ok(page.includes('<span id="footer-text">Stored in your macOS Keychain</span>'))
  // The script finds the footer by this id when the card ends without a save (B-9).
  assert.ok(page.includes('<footer id="footer">'))
  await send(`${url}/cancel`, { method: 'POST', body: {} })
})

test('no card text says the agent never sees a key (B-10)', async () => {
  const claim = 'never shown to your agent'
  for (const file of readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.mjs'))) {
    assert.ok(!readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').includes(claim), file)
  }
  for (const overrides of [{}, { demo: true, storeLabel: 'nowhere (demo)', allowSessionOnly: false }]) {
    const { urlReady } = startCard(overrides)
    const url = await urlReady
    assert.ok(!(await send(url)).text.includes(claim))
    await send(`${url}/cancel`, { method: 'POST', body: {} })
  }
})

test('a demo card says it is a demo and never claims a save or a store', async () => {
  const { urlReady } = startCard({ demo: true, storeLabel: 'nowhere (demo)', allowSessionOnly: false })
  const url = await urlReady
  const page = (await send(url)).text
  assert.ok(page.includes('Demo — nothing you type is saved.'))
  assert.ok(page.includes('<main class="card" aria-live="polite" data-demo>'))
  assert.ok(page.includes('Demo · nothing is stored'))
  assert.ok(!page.includes('Stored in your'))
  assert.ok(!page.includes('nowhere (demo)'))
  assert.ok(!page.includes('Remember on this computer'))
  const script = page.slice(page.indexOf('>', page.indexOf('<script nonce=')) + 1, page.lastIndexOf('</script>'))
  assert.ok(script.includes("finish('Demo finished', 'locked')"))
  assert.doesNotThrow(() => new Function(script))
  await send(`${url}/cancel`, { method: 'POST', body: {} })
})

test('the buddy listens on an ordinary card, and its caption names the store', async () => {
  const { urlReady } = startCard()
  const url = await urlReady
  const page = await send(url)
  assert.match(page.headers['content-security-policy'], /default-src 'none'/)
  assert.ok(page.text.includes('<svg class="buddy" data-mood="listening"'))
  assert.ok(page.text.includes('data-store="macOS Keychain">Paste it here. It goes to your macOS Keychain, not into the chat.</p>'))
  assert.ok(!page.text.includes('data-preview='))
  await send(`${url}/cancel`, { method: 'POST', body: {} })
})

test('a demo buddy names no store and has a button for every mood', async () => {
  const { urlReady } = startCard({ demo: true, storeLabel: 'nowhere (demo)', allowSessionOnly: false })
  const url = await urlReady
  const page = (await send(url)).text
  assert.ok(page.includes('<p class="caption" id="caption" aria-live="polite">Try it: type anything. Nothing is saved.</p>'))
  assert.ok(!page.includes('data-store='))
  for (const { id } of MOODS) assert.ok(page.includes(`<button type="button" data-preview="${id}">${id}</button>`), id)
  await send(`${url}/cancel`, { method: 'POST', body: {} })
})

test('the page carries the deadline for the footer clock, and the clock is not read out every second', async () => {
  const before = Date.now()
  const { urlReady } = startCard({ timeoutMs: 120_000 })
  const url = await urlReady
  const page = (await send(url)).text
  const after = Date.now()
  const [, expires] = page.match(/<span class="clock" id="clock" role="timer" aria-live="off" data-expires="(\d+)"><\/span>/)
  assert.ok(Number(expires) >= before + 120_000 && Number(expires) <= after + 120_000, expires)
  await send(`${url}/cancel`, { method: 'POST', body: {} })
})

test('the answer to a save is a receipt of names and outcomes: saved, handed over, kept or left empty', async () => {
  const fields = [{ name: 'A' }, { name: 'B', optional: true }, { name: 'C', saved: true }, { name: 'D', optional: true }]
  const saved = startCard({ fields })
  const res = await send(`${await saved.urlReady}/submit`, { method: 'POST', body: { values: { A: 'sk-secret-a', B: '', C: '  ', D: '' }, remember: true } })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.text), {
    remembered: true,
    receipt: [
      { name: 'A', outcome: 'saved' },
      { name: 'B', outcome: 'empty' },
      { name: 'C', outcome: 'kept' },
      { name: 'D', outcome: 'empty' },
    ],
  })
  assert.ok(!res.text.includes('sk-secret'))

  const once = startCard({ fields })
  const handed = await send(`${await once.urlReady}/submit`, { method: 'POST', body: { values: { A: 'sk-secret-a', D: 'sk-secret-d' }, remember: false } })
  assert.deepEqual(JSON.parse(handed.text).receipt.map((r) => r.outcome), ['handed', 'empty', 'kept', 'handed'])
  assert.ok(!handed.text.includes('sk-secret'))
})

test('a demo card keeps nothing, so its answer has no receipt', async () => {
  const demo = startCard({ demo: true, storeLabel: 'nowhere (demo)', allowSessionOnly: false })
  const res = await send(`${await demo.urlReady}/submit`, { method: 'POST', body: one('anything') })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.text), { remembered: true })
})

test('only a card whose command output is masked says so', async () => {
  const run = startCard({ masked: true })
  const runUrl = await run.urlReady
  const runPage = (await send(runUrl)).text
  assert.ok(runPage.includes('<p class="note" id="masking" hidden>keyprompt masks exact copies in that command&#39;s output.'))
  await send(`${runUrl}/cancel`, { method: 'POST', body: {} })

  const set = startCard()
  const setUrl = await set.urlReady
  const setPage = (await send(setUrl)).text
  assert.ok(!setPage.includes('masks exact copies'))
  assert.ok(!setPage.includes('id="masking"'))
  await send(`${setUrl}/cancel`, { method: 'POST', body: {} })
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
  assert.deepEqual(JSON.parse(res.text), { remembered: true, receipt: [{ name: 'OPENAI_API_KEY', outcome: 'saved' }] })
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

test('several saved fields: the card says Replace secrets and that empty boxes keep their values', async () => {
  const { urlReady, result } = startCard({
    fields: [{ name: 'A', saved: true }, { name: 'B', saved: true }],
    replacing: true,
  })
  const url = await urlReady
  const page = (await send(url)).text
  assert.ok(page.includes('<h1>Replace secrets</h1>'))
  assert.ok(page.includes("These values are already saved and can't be shown. Paste a new value to replace one; an empty box keeps its saved value."))
  assert.ok(page.includes('>Replace values</button>'))
  await send(`${url}/cancel`, { method: 'POST', body: {} })
  await assert.rejects(result, (e) => e.exitCode === 4)
})

test('when the 2nd of 3 saves fails, the card shows the error and the store holds what it held before', async () => {
  const items = new Map([['A', 'old-a']])
  const store = {
    id: 'fake',
    label: 'test store',
    maxValueLength: 100,
    read: async (name) => items.get(name) ?? null,
    write: async (name, value) => {
      if (name === 'B') throw new KeypromptError('Could not save B to the test store.')
      items.set(name, value)
    },
    remove: async (name) => items.delete(name),
  }
  const { urlReady, result } = startCard({
    fields: [{ name: 'A', saved: true }, { name: 'B' }, { name: 'C' }],
    onSubmit: (values) => saveAll(store, values),
  })
  const url = await urlReady
  const res = await send(`${url}/submit`, { method: 'POST', body: { values: { A: 'new-a', B: 'b', C: 'c' } } })
  assert.equal(res.status, 422)
  assert.deepEqual(JSON.parse(res.text), { error: 'Could not save B: Could not save B to the test store. Nothing was changed.' })
  assert.deepEqual([...items], [['A', 'old-a']])
  await send(`${url}/cancel`, { method: 'POST', body: {} })
  await assert.rejects(result, (e) => e.exitCode === 4)
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

test('Later sits left of Cancel; it answers 200, saves nothing and rejects with exit code 6 naming every box', async () => {
  const { urlReady, result, stored } = startCard({ fields: [{ name: 'A' }, { name: 'B', optional: true }, { name: 'C' }] })
  const url = await urlReady
  const page = (await send(url)).text
  assert.ok(page.includes('<button type="button" id="later">Later</button>'))
  assert.ok(page.indexOf('id="later"') < page.indexOf('id="cancel"'))

  const res = await send(`${url}/later`, { method: 'POST', body: {} })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.text), { later: true })
  await assert.rejects(result, (e) => {
    assert.ok(e instanceof KeypromptError)
    assert.equal(e.exitCode, 6)
    assert.equal(e.message, 'The person chose Later for A, B and C. Nothing was saved.')
    return true
  })
  const again = await send(`${url}/submit`, { method: 'POST', body: { values: { A: 'a', C: 'c' } } }).catch(() => ({ status: 'closed' }))
  assert.ok(again.status === 410 || again.status === 'closed')
  assert.deepEqual(stored, [])
})

test('Later from a foreign Host or Origin, without JSON, or as a GET is refused, and the card keeps waiting', async () => {
  const { urlReady, result, stored } = startCard()
  const url = await urlReady
  const u = new URL(url)
  assert.equal((await send(`${url}/later`, { method: 'POST', origin: 'https://evil.example', body: {} })).status, 403)
  assert.equal((await send(`${url}/later`, { method: 'POST', origin: null, body: {} })).status, 403)
  assert.equal((await send(`${url}/later`, { method: 'POST', host: `evil.example:${u.port}`, body: {} })).status, 403)
  assert.equal((await send(`${u.origin}/card/${'A'.repeat(43)}/later`, { method: 'POST', body: {} })).status, 404)
  assert.equal((await send(`${url}/later`, { method: 'POST', contentType: 'text/plain', body: {} })).status, 415)
  assert.equal((await send(`${url}/later`)).status, 405)

  // None of those ended the card: a real submit still works.
  assert.equal((await send(`${url}/submit`, { method: 'POST', body: one('sk') })).status, 200)
  assert.equal((await result).values.get('OPENAI_API_KEY'), 'sk')
  assert.deepEqual(stored, [{ values: { OPENAI_API_KEY: 'sk' }, remember: true }])
})

test('Later while a save is under way gives 409, so "Nothing was saved" is never said about a card that saved', async () => {
  let release
  const gate = new Promise((r) => {
    release = r
  })
  let saving
  const started = new Promise((r) => {
    saving = r
  })
  const { urlReady, result } = startCard({
    onSubmit: async () => {
      saving()
      await gate
    },
  })
  const url = await urlReady
  const submit = send(`${url}/submit`, { method: 'POST', body: one('sk') })
  await started
  const later = await send(`${url}/later`, { method: 'POST', body: {} })
  assert.equal(later.status, 409)
  assert.deepEqual(JSON.parse(later.text), { error: 'Already saving. Wait a moment.' })
  release()
  assert.equal((await submit).status, 200)
  assert.equal((await result).values.get('OPENAI_API_KEY'), 'sk')
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A save that starts, then waits until the test releases it; `outcome` runs after the release. */
function gatedSave(outcome = async () => {}) {
  let release
  const gate = new Promise((r) => {
    release = r
  })
  let saving
  const started = new Promise((r) => {
    saving = r
  })
  const onSubmit = async () => {
    saving()
    await gate
    await outcome()
  }
  return { onSubmit, started, release }
}

test('Cancel while a save is under way gives 409, and the save decides the outcome', async () => {
  const save = gatedSave()
  const { urlReady, result } = startCard({ onSubmit: save.onSubmit })
  const url = await urlReady
  const submit = send(`${url}/submit`, { method: 'POST', body: one('sk') })
  await save.started
  const cancel = await send(`${url}/cancel`, { method: 'POST', body: {} })
  assert.equal(cancel.status, 409)
  assert.deepEqual(JSON.parse(cancel.text), { error: 'Already saving. Wait a moment.' })
  save.release()
  assert.equal((await submit).status, 200)
  assert.equal((await result).values.get('OPENAI_API_KEY'), 'sk')
})

test('the deadline during a save waits for it, and a save that succeeds resolves the card', async () => {
  const save = gatedSave()
  const { urlReady, result } = startCard({ timeoutMs: 400, onSubmit: save.onSubmit })
  let outcome = 'waiting'
  result.then(
    () => (outcome = 'resolved'),
    () => (outcome = 'rejected'),
  )
  const url = await urlReady
  const submit = send(`${url}/submit`, { method: 'POST', body: one('sk') })
  await save.started
  await sleep(600)
  assert.equal(outcome, 'waiting')
  save.release()
  assert.equal((await submit).status, 200)
  assert.equal((await result).values.get('OPENAI_API_KEY'), 'sk')
})

test('the deadline during a save that fails ends the card with that error, final on the page, never a raw error', async () => {
  for (const [thrown, shown] of [
    [new KeypromptError('Could not save OPENAI_API_KEY: the Keychain is locked. Nothing was changed.'), 'Could not save OPENAI_API_KEY: the Keychain is locked. Nothing was changed.'],
    [new Error('EACCES: /secret/path'), 'Could not save. Try again.'],
  ]) {
    const save = gatedSave(async () => {
      throw thrown
    })
    const { urlReady, result } = startCard({ timeoutMs: 400, onSubmit: save.onSubmit })
    const url = await urlReady
    const submit = send(`${url}/submit`, { method: 'POST', body: one('sk') })
    await save.started
    await sleep(600)
    save.release()
    const res = await submit
    assert.equal(res.status, 422)
    assert.deepEqual(JSON.parse(res.text), { error: shown, final: true })
    await assert.rejects(result, (e) => {
      assert.ok(e instanceof KeypromptError)
      assert.equal(e.exitCode, 1)
      assert.equal(e.message, shown)
      return true
    })
    const again = await send(`${url}/submit`, { method: 'POST', body: one('sk') }).catch(() => ({ status: 'closed' }))
    assert.ok(again.status === 410 || again.status === 'closed')
  }
})

test('a submit whose body is still arriving at the deadline gets 410 and is never saved', async () => {
  const { urlReady, result, stored } = startCard({ timeoutMs: 100 })
  const u = new URL(await urlReady)
  const body = JSON.stringify(one('sk'))
  let req
  const res = new Promise((resolve, reject) => {
    req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}/submit`,
        method: 'POST',
        headers: { Origin: u.origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (r) => {
        const chunks = []
        r.on('data', (c) => chunks.push(c))
        r.on('end', () => resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
      },
    )
    req.on('error', reject)
  })
  req.write(body.slice(0, 5))
  await assert.rejects(result, (e) => e.exitCode === 5)
  req.end(body.slice(5))
  assert.equal((await res).status, 410)
  assert.deepEqual(JSON.parse((await res).text), { error: 'This card is no longer active. Close this tab.', final: true })
  assert.deepEqual(stored, [])
})

test('a card that has ended answers with one sentence that is true however it ended', async () => {
  const ended = { error: 'This card is no longer active. Close this tab.', final: true }
  const endings = {
    saved: { end: (url) => send(`${url}/submit`, { method: 'POST', body: one('sk') }) },
    cancelled: { end: (url) => send(`${url}/cancel`, { method: 'POST', body: {} }) },
    later: { end: (url) => send(`${url}/later`, { method: 'POST', body: {} }) },
    'timed out': { options: { timeoutMs: 100 } },
  }
  for (const [how, { end, options }] of Object.entries(endings)) {
    const { urlReady, result } = startCard(options)
    const url = await urlReady
    if (end) await end(url)
    await result.catch(() => {})
    const again = await send(`${url}/submit`, { method: 'POST', body: one('sk') })
    assert.equal(again.status, 410, how)
    assert.deepEqual(JSON.parse(again.text), ended, how)
  }
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
