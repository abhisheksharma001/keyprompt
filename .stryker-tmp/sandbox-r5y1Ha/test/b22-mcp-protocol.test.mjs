// @ts-nocheck
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { MAX_LINE, serveMcp } from '../src/mcp.mjs'

/** A client on in-memory streams whose waits are bounded, so a missing answer fails instead of hanging. */
function connect() {
  const input = new PassThrough()
  /** @type {string[]} */
  const lines = []
  /** @type {((line: string) => void)[]} */
  const waiting = []
  const tools = {
    request_secret: async () => ({ result: { status: 'saved' }, isError: false }),
    check_secrets: async () => ({ result: { status: 'saved' }, isError: false }),
  }
  const served = serveMcp({
    input,
    output: {
      write(/** @type {string} */ text) {
        const line = text.slice(0, -1)
        const wake = waiting.shift()
        if (wake) wake(line)
        else lines.push(line)
      },
    },
    version: '9.9.9',
    tools,
  })
  return {
    write: (/** @type {string} */ text) => input.write(text),
    send: (/** @type {unknown} */ message) => input.write(`${JSON.stringify(message)}\n`),
    next: (/** @type {number} */ ms = 2000) => {
      /** @type {NodeJS.Timeout | undefined} */
      let timer
      return Promise.race([
        new Promise((done) => (lines.length > 0 ? done(lines.shift()) : waiting.push(done))).then((line) => JSON.parse(/** @type {string} */ (line))),
        // Not unref'd: a missing answer must fail the test, not end it as "cancelled".
        new Promise((_, fail) => (timer = setTimeout(() => fail(new Error(`no message within ${ms} ms`)), ms))),
      ]).finally(() => clearTimeout(timer))
    },
    pending: () => lines.length,
    end: async () => {
      input.end()
      await served
    },
  }
}

const rpc = (/** @type {number} */ id, /** @type {string} */ method, params = {}) => ({ jsonrpc: '2.0', id, method, params })

test('B-22: with 2025-03-26, a batch is answered in one array; notifications in it get no answer', async () => {
  const c = connect()
  c.send(rpc(1, 'initialize', { protocolVersion: '2025-03-26' }))
  assert.equal((await c.next()).result.protocolVersion, '2025-03-26')
  c.send([rpc(2, 'ping'), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc(3, 'tools/list')])
  const batch = await c.next()
  assert.ok(Array.isArray(batch), JSON.stringify(batch))
  assert.deepEqual(batch.map((m) => m.id).sort(), [2, 3])
  assert.deepEqual(batch.find((m) => m.id === 2).result, {})
  assert.ok(Array.isArray(batch.find((m) => m.id === 3).result.tools))
  // Only notifications: nothing comes back. An empty batch is one error.
  c.send([{ jsonrpc: '2.0', method: 'notifications/initialized' }])
  c.send([])
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } })
  await c.end()
  assert.equal(c.pending(), 0)
})

test('B-22: with any other version, a batch is still refused', async () => {
  const c = connect()
  c.send(rpc(1, 'initialize', { protocolVersion: '2025-11-25' }))
  await c.next()
  c.send([rpc(2, 'ping')])
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } })
  await c.end()
})

test('B-22: a line that passes 1 MB without a newline is refused at once, not held until its end', async () => {
  const c = connect()
  // No newline yet: the answer must come while the line is still arriving.
  const chunk = 'x'.repeat(64 * 1024)
  for (let sent = 0; sent <= MAX_LINE; sent += chunk.length) c.write(chunk)
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too long.' } })
  // The rest of that line is dropped up to its newline, once; the next line is read normally.
  c.write(chunk)
  c.write(`${chunk}\n`)
  c.send(rpc(2, 'ping'))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 2, result: {} })
  await c.end()
  assert.equal(c.pending(), 0)
})

test('B-22: a cancel for a request that is not in flight does not silence a later request with that id', async () => {
  const c = connect()
  c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } })
  c.send(rpc(5, 'ping'))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 5, result: {} })
  await c.end()
})

test('B-22: an id still in flight cannot be reused by any method, so a later cancel still reaches its card', async () => {
  const input = new PassThrough()
  /** @type {object[]} */
  const out = []
  let aborted = false
  /** @type {() => void} */
  let finish = () => {}
  const served = serveMcp({
    input,
    output: { write: (text) => out.push(JSON.parse(text)) },
    version: '9.9.9',
    tools: {
      request_secret: (_args, _client, signal) =>
        new Promise((done) => {
          finish = () => done({ result: { status: 'saved' }, isError: false })
          signal.addEventListener('abort', () => {
            aborted = true
            done({ result: { status: 'cancelled' }, isError: false })
          })
        }),
      check_secrets: async () => ({ result: { status: 'saved' }, isError: false }),
    },
  })
  const send = (message) => input.write(`${JSON.stringify(message)}\n`)
  const settle = () => new Promise((done) => setTimeout(done, 50))
  send(rpc(7, 'tools/call', { name: 'request_secret', arguments: { fields: ['A_KEY'] } }))
  send(rpc(7, 'ping'))
  await settle()
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: 7, error: { code: -32600, message: 'Request id already in use.' } }])
  send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } })
  await settle()
  assert.equal(aborted, true, 'the cancel reached the card')
  finish()
  input.end()
  await served
  assert.equal(out.length, 1, 'the cancelled request got no answer')
})

test('B-22: initialize inside a 2025-03-26 batch is refused, and the version does not change', async () => {
  const c = connect()
  c.send(rpc(1, 'initialize', { protocolVersion: '2025-03-26' }))
  await c.next()
  c.send([rpc(2, 'initialize', { protocolVersion: '2025-11-25' }), rpc(3, 'ping')])
  const batch = await c.next()
  assert.deepEqual(batch.find((m) => m.id === 2), { jsonrpc: '2.0', id: 2, error: { code: -32600, message: 'Invalid request.' } })
  // Still 2025-03-26: a batch is still accepted.
  c.send([rpc(4, 'ping')])
  assert.deepEqual(await c.next(), [{ jsonrpc: '2.0', id: 4, result: {} }])
  await c.end()
})
