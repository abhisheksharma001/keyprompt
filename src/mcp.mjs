import { createInterface } from 'node:readline'

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

/** A line longer than this is not read. */
export const MAX_LINE = 1024 * 1024

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
 * @typedef {{ request_secret(args: unknown, client: ClientInfo): Promise<ToolAnswer>, check_secrets(args: unknown): Promise<ToolAnswer> }} Tools
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
  /** Requests the client cancelled: their answers are never sent. */
  const cancelled = new Set()
  /** @type {Promise<void>[]} */
  const pending = []

  const send = (/** @type {object} */ message) => output.write(`${JSON.stringify(message)}\n`)
  const fail = (/** @type {unknown} */ id, /** @type {number} */ code, /** @type {string} */ message) => send({ jsonrpc: '2.0', id, error: { code, message } })

  /** @param {Record<string, unknown>} message */
  async function answer(message) {
    const { id, method } = message
    const params = message.params && typeof message.params === 'object' ? /** @type {Record<string, any>} */ (message.params) : {}
    /** @param {object} result */
    const reply = (result) => {
      if (!cancelled.has(id)) send({ jsonrpc: '2.0', id, result })
    }
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
        if (name !== 'request_secret' && name !== 'check_secrets') return fail(id, ERROR.INVALID_PARAMS, 'Unknown tool. keyprompt has request_secret and check_secrets.')
        const { result, isError } = name === 'request_secret' ? await tools.request_secret(params.arguments, client) : await tools.check_secrets(params.arguments)
        // structuredContent exists from 2025-06-18; older clients get the same JSON as text only.
        const structured = (protocolVersion ?? PROTOCOL_VERSIONS[0]) >= '2025-06-18' ? { structuredContent: result } : {}
        return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], ...structured, isError })
      }
      default:
        // Also the answer to the 2026-07-28 probe `server/discover`, which makes a dual-era client fall back to `initialize`.
        return fail(id, ERROR.METHOD_NOT_FOUND, 'Method not found.')
    }
  }

  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim().length === 0) continue
    if (line.length > MAX_LINE) {
      fail(null, ERROR.INVALID_REQUEST, 'Message too long.')
      continue
    }
    /** @type {unknown} */
    let message
    try {
      message = JSON.parse(line)
    } catch {
      fail(null, ERROR.PARSE, 'Parse error.')
      continue
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      fail(null, ERROR.INVALID_REQUEST, 'Invalid request.')
      continue
    }
    const m = /** @type {Record<string, unknown>} */ (message)
    const isRequest = 'id' in m && (typeof m.id === 'string' || typeof m.id === 'number')
    if (typeof m.method !== 'string') {
      // A response from the client: this server sends no requests, so there is nothing to match.
      if (!('result' in m) && !('error' in m)) fail(isRequest ? m.id : null, ERROR.INVALID_REQUEST, 'Invalid request.')
      continue
    }
    if (!isRequest) {
      if (m.method === 'notifications/cancelled') {
        const p = m.params && typeof m.params === 'object' ? /** @type {Record<string, unknown>} */ (m.params) : {}
        cancelled.add(p.requestId)
      }
      // notifications/initialized and any other notification need no answer.
      continue
    }
    pending.push(
      answer(m).catch(() => {
        if (!cancelled.has(m.id)) fail(m.id, -32603, 'Internal error.')
      }),
    )
  }
  await Promise.allSettled(pending.splice(0))
}
