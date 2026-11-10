// @ts-nocheck
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { MAX_LINE, PROTOCOL_VERSIONS, serveMcp, TOOLS } from '../src/mcp.mjs'

/**
 * A client on two in-memory streams. `send` writes one message; `next` waits
 * for the server's next line, parsed. Every line the server writes must be
 * one JSON object.
 */
function connect(tools = fakeTools()) {
  const input = new PassThrough()
  /** @type {string[]} */
  const lines = []
  /** @type {((line: string) => void)[]} */
  const waiting = []
  const output = {
    write(/** @type {string} */ text) {
      assert.ok(text.endsWith('\n') && !text.slice(0, -1).includes('\n'), `one message per line: ${text}`)
      const line = text.slice(0, -1)
      const wake = waiting.shift()
      if (wake) wake(line)
      else lines.push(line)
    },
  }
  const served = serveMcp({ input, output, version: '9.9.9', tools })
  return {
    send: (/** @type {unknown} */ message) => input.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`),
    next: () => new Promise((done) => (lines.length > 0 ? done(lines.shift()) : waiting.push(done))).then((line) => JSON.parse(/** @type {string} */ (line))),
    pending: () => lines.length,
    end: async () => {
      input.end()
      await served
    },
  }
}

function fakeTools() {
  return {
    calls: /** @type {unknown[]} */ ([]),
    async request_secret(/** @type {unknown} */ args, /** @type {unknown} */ client) {
      this.calls.push(['request_secret', args, client])
      return { result: { status: 'saved', names: ['A_KEY'] }, isError: false }
    },
    async check_secrets(/** @type {unknown} */ args) {
      this.calls.push(['check_secrets', args])
      return { result: { status: 'missing', names: ['B_KEY'] }, isError: false }
    },
  }
}

const rpc = (/** @type {number} */ id, /** @type {string} */ method, params = {}) => ({ jsonrpc: '2.0', id, method, params })

test('a dual-era client probing with server/discover gets "method not found", then the handshake works (S-45, R-6)', async () => {
  const c = connect()
  c.send(rpc(1, 'server/discover', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } }))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found.' } })
  c.send(rpc(2, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }))
  const init = await c.next()
  assert.equal(init.id, 2)
  assert.equal(init.result.protocolVersion, '2025-11-25')
  assert.deepEqual(init.result.capabilities, { tools: {} })
  assert.deepEqual(init.result.serverInfo, { name: 'keyprompt', version: '9.9.9' })
  assert.match(init.result.instructions, /No tool returns a value/)
  c.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  c.send(rpc(3, 'ping'))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 3, result: {} })
  c.send(rpc(4, 'tools/list'))
  const list = await c.next()
  assert.deepEqual(list.result.tools.map((t) => t.name), ['request_secret', 'check_secrets'])
  assert.deepEqual(list.result.tools, TOOLS)
  await c.end()
})

test('initialize answers with the version asked for when it is one of ours, otherwise the newest (S-45)', async () => {
  for (const [asked, answered] of [['2025-06-18', '2025-06-18'], ['2024-11-05', '2024-11-05'], ['2099-01-01', PROTOCOL_VERSIONS[0]], [undefined, PROTOCOL_VERSIONS[0]]]) {
    const c = connect()
    c.send(rpc(1, 'initialize', { protocolVersion: asked }))
    assert.equal((await c.next()).result.protocolVersion, answered, String(asked))
    await c.end()
  }
})

test('a tool call gets the tool\'s JSON as text, and as structuredContent from 2025-06-18 on; an unknown tool is invalid params (S-45)', async () => {
  for (const [version, structured] of [['2025-11-25', true], ['2025-03-26', false]]) {
    const tools = fakeTools()
    const c = connect(tools)
    c.send(rpc(1, 'initialize', { protocolVersion: version, clientInfo: { name: 'agent', title: 'The Agent' } }))
    await c.next()
    c.send(rpc(2, 'tools/call', { name: 'request_secret', arguments: { fields: ['A_KEY'] } }))
    const answer = await c.next()
    const expected = { content: [{ type: 'text', text: '{"status":"saved","names":["A_KEY"]}' }], isError: false }
    if (structured) expected.structuredContent = { status: 'saved', names: ['A_KEY'] }
    assert.deepEqual(answer, { jsonrpc: '2.0', id: 2, result: expected }, version)
    assert.deepEqual(tools.calls, [['request_secret', { fields: ['A_KEY'] }, { name: 'agent', title: 'The Agent' }]])
    c.send(rpc(3, 'tools/call', { name: 'get_secret', arguments: {} }))
    assert.deepEqual((await c.next()).error, { code: -32602, message: 'Unknown tool. keyprompt has request_secret and check_secrets.' })
    await c.end()
  }
})

test('bad lines get JSON-RPC errors that never repeat them; notifications and client responses get no answer (S-45)', async () => {
  const c = connect()
  c.send('{ not json dummy-sensitive-45')
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } })
  c.send('[1, 2]')
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request.' } })
  c.send(`"${'x'.repeat(MAX_LINE)}"`)
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too long.' } })
  c.send(rpc(7, 'resources/list'))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 7, error: { code: -32601, message: 'Method not found.' } })
  c.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  c.send({ jsonrpc: '2.0', method: 'notifications/whatever', params: { a: 1 } })
  c.send({ jsonrpc: '2.0', id: 99, result: {} })
  c.send(rpc(8, 'ping'))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 8, result: {} })
  assert.equal(c.pending(), 0)
  await c.end()
})

test('a request the client cancelled is never answered, as the spec requires (S-45)', async () => {
  /** @type {(value: { result: object, isError: boolean }) => void} */
  let finish = () => {}
  const tools = {
    request_secret: () => new Promise((done) => (finish = done)),
    check_secrets: async () => ({ result: { status: 'saved' }, isError: false }),
  }
  const c = connect(tools)
  c.send(rpc(1, 'tools/call', { name: 'request_secret', arguments: { fields: ['A_KEY'] } }))
  c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, reason: 'user stopped' } })
  // Let the cancellation be read before the tool answers.
  c.send(rpc(2, 'ping'))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 2, result: {} })
  finish({ result: { status: 'saved' }, isError: false })
  c.send(rpc(3, 'ping'))
  assert.deepEqual(await c.next(), { jsonrpc: '2.0', id: 3, result: {} })
  await c.end()
  assert.equal(c.pending(), 0)
})
