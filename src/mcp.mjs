import { StringDecoder } from 'node:string_decoder'

/**
 * `keyprompt mcp`: a small MCP server on stdin and stdout, written by hand so
 * keyprompt keeps one dependency (S-45, D-22). It offers two tools and never
 * returns a value: `request_secret` opens the same card as `keyprompt set`,
 * and `check_secrets` says which names are saved, like `keyprompt has`.
 *
 * It speaks the handshake-based protocol versions (2025-11-25 and the three
 * before it). A client that also speaks 2026-07-28 first sends
 * `server/discover`; the "method not found" answer tells it this server uses
 * the handshake, and it falls back to `initialize`
 * (modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio,
 * "Backward Compatibility", R-6).
 */

/** Newest first. Tools work the same way in all four. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

/**
 * After stdin closes, calls still in flight get this long to finish (a card
 * being saved), then any card still open is closed, so the server exits
 * within seconds instead of waiting out a card's 5 minutes (B-21).
 */
export const END_GRACE_MS = 5000

/** A line longer than this is not kept: it is refused as soon as it passes this size (B-22). */
export const MAX_LINE = 1024 * 1024

/**
 * The input's lines, without their line endings. A line that passes `max`
 * characters before its newline yields `null` once, at that moment, and the
 * rest of it is dropped up to the newline, so memory stays near `max`.
 * @param {AsyncIterable<Buffer | string>} input
 * @param {number} max
 * @returns {AsyncGenerator<string | null>}
 */
export async function* boundedLines(input, max) {
  const decoder = new StringDecoder('utf8')
  let line = ''
  let dropping = false
  for await (const chunk of input) {
    let text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
    while (text.length > 0) {
      const end = text.indexOf('\n')
      if (dropping) {
        if (end === -1) break
        dropping = false
        text = text.slice(end + 1)
        continue
      }
      if (end === -1) {
        line += text
        text = ''
        if (line.length > max) {
          yield null
          line = ''
          dropping = true
        }
        break
      }
      const whole = line + text.slice(0, end)
      line = ''
      text = text.slice(end + 1)
      yield whole.length > max ? null : whole.endsWith('\r') ? whole.slice(0, -1) : whole
    }
  }
  const rest = line + decoder.end()
  if (!dropping && rest.length > 0) yield rest.length > max ? null : rest
}

const ERROR = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602 }

const INSTRUCTIONS =
  'keyprompt asks the person for API keys and other secrets on a local card in their browser and saves them in the OS password store. ' +
  'No tool returns a value. Use request_secret instead of asking the person to paste a secret into the chat, and check_secrets first to skip names that are saved. ' +
  'A saved secret reaches a program only through a shell: keyprompt run NAME -- COMMAND.'

/** The tools, as `tools/list` returns them. */
export const TOOLS = [
  {
    name: 'request_secret',
    title: 'Ask the person for secrets on a card',
    description:
      'Opens one secure card in the person\'s browser for up to 12 secrets and waits until they press Save, Cancel or Later (at most 5 minutes). ' +
      'Saved values go to the OS password store and are never returned: the result names what was saved, replaced or left empty, or why nothing was. ' +
      'A field is a NAME (capital letters, digits and _) with optional hints after a colon: :visible (an ID that is not secret), :multiline, :optional. ' +
      'Use a saved secret with keyprompt run NAME -- COMMAND in a shell.',
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 12,
          description: 'For example ["TWILIO_ACCOUNT_SID:visible", "TWILIO_AUTH_TOKEN"].',
        },
        reason: { type: 'string', description: 'Shown on the card as your words: why the secrets are needed, in plain words.' },
      },
      required: ['fields'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'check_secrets',
    title: 'Check which secrets are saved',
    description: 'Says which of these names are saved in the OS password store. Never returns a value.',
    inputSchema: {
      type: 'object',
      properties: {
        names: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12, description: 'For example ["OPENAI_API_KEY"].' },
      },
      required: ['names'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]

/**
 * @typedef {{ name?: string, title?: string }} ClientInfo
 * @typedef {{ result: object, isError: boolean }} ToolAnswer
 * @typedef {{ request_secret(args: unknown, client: ClientInfo, signal: AbortSignal): Promise<ToolAnswer>, check_secrets(args: unknown): Promise<ToolAnswer> }} Tools
 */

/**
 * Serve MCP until the input ends. Every line written to `output` is one
 * JSON-RPC message; nothing else ever goes there.
 * @param {{ input: NodeJS.ReadableStream, output: { write(text: string): unknown }, version: string, tools: Tools }} options
 * @returns {Promise<void>}
 */
export async function serveMcp({ input, output, version, tools }) {
  /** @type {string | undefined} */
  let protocolVersion
  /** @type {ClientInfo} */
  let client = {}
  /** Request ids in flight, and those of them the client cancelled: a cancelled one is never answered. */
  const active = new Set()
  const cancelled = new Set()
  /** One abort per tool call in flight, so a cancel or the end of input closes its card (B-21). */
  const inFlight = new Map()
  /** @type {Promise<void>[]} */
  const pending = []

  const send = (/** @type {object} */ message) => output.write(`${JSON.stringify(message)}\n`)
  const fail = (/** @type {unknown} */ id, /** @type {number} */ code, /** @type {string} */ message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  /**
   * The response to one request.
   * @param {Record<string, unknown>} message
   * @returns {Promise<object>}
   */
  async function answer(message) {
    const { id, method } = message
    const params = message.params && typeof message.params === 'object' ? /** @type {Record<string, any>} */ (message.params) : {}
    /** @param {object} result */
    const reply = (result) => ({ jsonrpc: '2.0', id, result })
    const fail = (/** @type {number} */ code, /** @type {string} */ text) => ({ jsonrpc: '2.0', id, error: { code, message: text } })
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0]
        const info = params.clientInfo && typeof params.clientInfo === 'object' ? params.clientInfo : {}
        client = {
          name: typeof info.name === 'string' ? info.name : undefined,
          title: typeof info.title === 'string' ? info.title : undefined,
        }
        return reply({ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'keyprompt', version }, instructions: INSTRUCTIONS })
      }
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call': {
        const name = params.name
        if (name !== 'request_secret' && name !== 'check_secrets') return fail(ERROR.INVALID_PARAMS, 'Unknown tool. keyprompt has request_secret and check_secrets.')
        /** @type {import('./mcp.mjs').ToolAnswer} */
        let answered
        if (name === 'request_secret') {
          // One abort per card, so a cancel reaches the right one; an id still in flight cannot be reused.
          if (inFlight.has(id)) return fail(ERROR.INVALID_REQUEST, 'Request id already in use.')
          const controller = new AbortController()
          inFlight.set(id, controller)
          try {
            answered = await tools.request_secret(params.arguments, client, controller.signal)
          } finally {
            inFlight.delete(id)
          }
        } else answered = await tools.check_secrets(params.arguments)
        const { result, isError } = answered
        // structuredContent exists from 2025-06-18; older clients get the same JSON as text only.
        const structured = (protocolVersion ?? PROTOCOL_VERSIONS[0]) >= '2025-06-18' ? { structuredContent: result } : {}
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], ...structured, isError })
      }
      default:
        // Also the answer to the 2026-07-28 probe `server/discover`, which makes a dual-era client fall back to `initialize`.
        return fail(ERROR.METHOD_NOT_FOUND, 'Method not found.')
    }
  }

  const invalid = { jsonrpc: '2.0', id: null, error: { code: ERROR.INVALID_REQUEST, message: 'Invalid request.' } }

  /**
   * One message, answered: the response to send, or null for a notification,
   * a client's response or a request the client cancelled.
   * @param {unknown} message
   * @returns {Promise<object | null>}
   */
  async function handle(message) {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) return invalid
    const m = /** @type {Record<string, unknown>} */ (message)
    const isRequest = 'id' in m && (typeof m.id === 'string' || typeof m.id === 'number')
    if (typeof m.method !== 'string') {
      // A response from the client: this server sends no requests, so there is nothing to match.
      if ('result' in m || 'error' in m) return null
      return isRequest ? { ...invalid, id: m.id } : invalid
    }
    if (!isRequest) {
      if (m.method === 'notifications/cancelled') {
        const p = m.params && typeof m.params === 'object' ? /** @type {Record<string, unknown>} */ (m.params) : {}
        // Only a request in flight can be cancelled; a stray cancel must not silence a later request with that id (B-22).
        if (active.has(p.requestId)) {
          cancelled.add(p.requestId)
          inFlight.get(p.requestId)?.abort()
        }
      }
      // notifications/initialized and any other notification need no answer.
      return null
    }
    active.add(m.id)
    try {
      const response = await answer(m).catch(() => ({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'Internal error.' } }))
      return cancelled.has(m.id) ? null : response
    } finally {
      active.delete(m.id)
      cancelled.delete(m.id)
    }
  }

  for await (const line of boundedLines(input, MAX_LINE)) {
    if (line === null) {
      fail(null, ERROR.INVALID_REQUEST, 'Message too long.')
      continue
    }
    if (line.trim().length === 0) continue
    /** @type {unknown} */
    let message
    try {
      message = JSON.parse(line)
    } catch {
      fail(null, ERROR.PARSE, 'Parse error.')
      continue
    }
    // JSON-RPC batches exist only in 2025-03-26, which requires them; every other version refuses an array (B-22).
    if (Array.isArray(message) && protocolVersion === '2025-03-26') {
      if (message.length === 0) {
        send(invalid)
        continue
      }
      pending.push(
        Promise.all(message.map((item) => handle(item))).then((responses) => {
          const answered = responses.filter((r) => r !== null)
          if (answered.length > 0) send(answered)
        }),
      )
      continue
    }
    pending.push(
      handle(message).then((response) => {
        if (response !== null) send(response)
      }),
    )
  }
  // The client is gone: give calls in flight a moment, then close any card still open.
  const grace = setTimeout(() => {
    for (const controller of inFlight.values()) controller.abort()
  }, END_GRACE_MS)
  await Promise.allSettled(pending.splice(0))
  clearTimeout(grace)
}
