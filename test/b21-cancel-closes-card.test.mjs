import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { CardWithdrawnError, requestSecretWithCard } from '../src/card-server.mjs'
import { KeypromptError } from '../src/errors.mjs'

const BIN = fileURLToPath(new URL('../bin/keyprompt.mjs', import.meta.url))

/** POST to the card the way its page does, and resolve the status code (or the error code if nothing answers). */
function post(url, action, body) {
  const u = new URL(url)
  return new Promise((done) => {
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: `${u.pathname}/${action}`, method: 'POST', headers: { Origin: u.origin, 'Content-Type': 'application/json' } }, (res) => {
      res.resume()
      done(res.statusCode)
    })
    req.on('error', (error) => done(error.code))
    req.end(JSON.stringify(body))
  })
}

test('B-21: aborting the signal closes an open card like Cancel, and no save is accepted after it', async () => {
  const controller = new AbortController()
  /** @type {string} */
  let url = ''
  let submits = 0
  const card = requestSecretWithCard({
    fields: [{ name: 'A_KEY' }],
    storeLabel: 'Test Store',
    replacing: false,
    allowSessionOnly: false,
    // Short, so the code before the fix ends by its deadline (exit 5) instead of hanging.
    timeoutMs: 3000,
    onSubmit: async () => {
      submits++
    },
    open: async (opened) => {
      url = opened
      setTimeout(() => controller.abort(), 50)
      return true
    },
    signal: controller.signal,
  })
  await assert.rejects(card, (error) => error.exitCode === 4 && /cancelled/.test(error.message) && /Nothing was saved/.test(error.message))
  const status = await post(url, 'submit', { values: { A_KEY: 'dummy-sensitive-b21' }, remember: true })
  assert.ok(status === 410 || status === 'ECONNREFUSED', `a save after the abort is refused: ${status}`)
  assert.equal(submits, 0)
})

test('B-21: a signal that is already aborted opens no card', async () => {
  const controller = new AbortController()
  controller.abort()
  let opened = false
  await assert.rejects(
    requestSecretWithCard({
      fields: [{ name: 'A_KEY' }],
      storeLabel: 'Test Store',
      replacing: false,
      allowSessionOnly: false,
      timeoutMs: 3000,
      onSubmit: async () => {},
      open: async () => {
        opened = true
        return true
      },
      signal: controller.signal,
    }),
    (error) => error.exitCode === 4,
  )
  assert.equal(opened, false)
})

test('B-21: in keyprompt mcp, a cancelled request_secret frees the card, gets no answer, and closing stdin ends the process', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b21-'))
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child
  try {
    const preload = join(dir, 'store.mjs')
    writeFileSync(preload, `import { getStore } from ${JSON.stringify(new URL('../src/store/index.mjs', import.meta.url).href)}
const store = getStore()
store.read = async () => null
store.write = async () => { throw new Error('no save expected') }
`)
    // A browser that opens nothing and leaves the card waiting.
    const browser = join(dir, 'idle.mjs')
    writeFileSync(browser, `#!${process.execPath}\n`)
    chmodSync(browser, 0o755)
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, BIN, 'mcp'], {
      env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: browser },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const exited = new Promise((done) => child.on('exit', (code) => done(code)))
    /** @type {Map<number, object>} */
    const answers = new Map()
    const waiting = new Map()
    createInterface({ input: child.stdout }).on('line', (line) => {
      const message = JSON.parse(line)
      answers.set(message.id, message)
      waiting.get(message.id)?.(message)
    })
    let cards = 0
    const cardOpened = []
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.includes('opened a secure card')) {
        cards++
        cardOpened.shift()?.()
      }
    })
    const nextCard = () => new Promise((done) => cardOpened.push(done))
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
    const answer = (id) => new Promise((done) => (answers.has(id) ? done(answers.get(id)) : waiting.set(id, done)))

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'b21', version: '1' } } })
    await answer(1)
    const first = nextCard()
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'request_secret', arguments: { fields: ['A_KEY'] } } })
    await first
    send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2, reason: 'timed out' } })
    // The lock is free again: a new request opens a new card instead of "A card is already open".
    const second = nextCard()
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'request_secret', arguments: { fields: ['B_KEY'] } } })
    const outcome = await Promise.race([second.then(() => 'card'), answer(3).then((m) => `answer: ${JSON.stringify(m)}`)])
    assert.equal(outcome, 'card')
    assert.equal(cards, 2)
    // Once the cancelled call has finished its own cleanup (its log line is written), it must not free B's lock.
    const logPath = join(dir, 'activity.jsonl')
    for (let i = 0; i < 100 && !(existsSync(logPath) && readFileSync(logPath, 'utf8').includes('A_KEY')); i++) await new Promise((done) => setTimeout(done, 20))
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'request_secret', arguments: { fields: ['C_KEY'] } } })
    const refused = await answer(4)
    assert.equal(refused.result.structuredContent.message, 'A card is already open. Wait for its answer before asking again.')
    // An id still in flight cannot be reused, so a later cancel always reaches the right card.
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'request_secret', arguments: { fields: ['D_KEY'] } } })
    const reused = await answer(3)
    assert.deepEqual(reused.error, { code: -32600, message: 'Request id already in use.' })
    answers.delete(3)
    // Closing stdin with a card open: the process ends after the short grace, not after the 5-minute deadline.
    const started = Date.now()
    child.stdin.end()
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
    const code = await exited
    clearTimeout(timer)
    assert.equal(code, 0, 'exited by itself')
    assert.ok(Date.now() - started < 20000, `exited after ${Date.now() - started} ms`)
    assert.equal(answers.has(2), false, 'a cancelled request gets no answer')
    assert.equal(cards, 2, 'the refused and reused requests opened no card')
    const log = readFileSync(join(dir, 'activity.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(log.map((e) => [e.event, e.command, e.names]), [['withdrawn', 'mcp', ['A_KEY']], ['withdrawn', 'mcp', ['B_KEY']]])
  } finally {
    // A failed assertion must not leave the server waiting on its card and the test runner with it.
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A card whose save takes 300 ms, aborted 20 ms into it. */
function abortDuringSave(onSubmit) {
  const controller = new AbortController()
  let calls = 0
  const card = requestSecretWithCard({
    fields: [{ name: 'A_KEY' }],
    storeLabel: 'Test Store',
    replacing: false,
    allowSessionOnly: false,
    timeoutMs: 5000,
    onSubmit: async (values, remember) => {
      calls++
      setTimeout(() => controller.abort(), 20)
      await new Promise((done) => setTimeout(done, 300))
      await onSubmit(values, remember)
    },
    open: async (url) => {
      setTimeout(() => post(url, 'submit', { values: { A_KEY: 'dummy-sensitive-b21-save' }, remember: true }), 10)
      return true
    },
    signal: controller.signal,
  })
  return { card, calls: () => calls }
}

test('B-21: a cancel during a save lets that save decide: a save that works is returned, never "Nothing was saved"', async () => {
  const { card, calls } = abortDuringSave(async () => {})
  const answer = await card
  assert.equal(answer.remembered, true)
  assert.deepEqual([...answer.values.keys()], ['A_KEY'])
  assert.equal(calls(), 1)
})

test('B-21: a cancel during a save that then fails ends with the save\'s own error, not "withdrawn"', async () => {
  const { card } = abortDuringSave(async () => {
    throw new KeypromptError('The test store is full.')
  })
  await assert.rejects(card, (error) => !(error instanceof CardWithdrawnError) && error.message === 'The test store is full.')
})

test('B-21: an abort before the server is ready opens no browser', async () => {
  const controller = new AbortController()
  let opened = false
  const card = requestSecretWithCard({
    fields: [{ name: 'A_KEY' }],
    storeLabel: 'Test Store',
    replacing: false,
    allowSessionOnly: false,
    timeoutMs: 3000,
    onSubmit: async () => {},
    open: async () => {
      opened = true
      return true
    },
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(card, (error) => error instanceof CardWithdrawnError)
  await new Promise((done) => setTimeout(done, 100))
  assert.equal(opened, false)
})

test('B-21: in keyprompt mcp, a request cancelled before its card opens prints and logs nothing', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keyprompt-b21-early-'))
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child
  try {
    const preload = join(dir, 'store.mjs')
    // A slow store, so the cancel arrives while keyprompt is still checking which names are saved.
    writeFileSync(preload, `import { getStore } from ${JSON.stringify(new URL('../src/store/index.mjs', import.meta.url).href)}
const store = getStore()
store.read = () => new Promise((done) => setTimeout(() => done(null), 400))
`)
    const browser = join(dir, 'idle.mjs')
    writeFileSync(browser, `#!${process.execPath}\n`)
    chmodSync(browser, 0o755)
    child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, BIN, 'mcp'], {
      env: { ...process.env, KEYPROMPT_HOME: dir, KEYPROMPT_BROWSER: browser },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const exited = new Promise((done) => child.on('exit', (code) => done(code)))
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'request_secret', arguments: { fields: ['A_KEY'] } } })
    send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } })
    await new Promise((done) => setTimeout(done, 1000))
    child.stdin.end()
    assert.equal(await exited, 0)
    assert.ok(!stderr.includes('opened a secure card'), stderr)
    assert.equal(existsSync(join(dir, 'activity.jsonl')), false, 'nothing logged')
    assert.ok(!stdout.split('\n').some((line) => line.includes('"id":2')), 'a cancelled request gets no answer')
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
})
