import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { renderCard } from './card-page.mjs'
import { EXIT, KeypromptError } from './errors.mjs'
import { joinNames } from './save.mjs'

/** 12 fields of up to 64 KiB each, with room for JSON escaping. */
const MAX_BODY_BYTES = 1024 * 1024
export const DEFAULT_CARD_TIMEOUT_MS = 5 * 60 * 1000

/**
 * One box on the card. The hints only change how the box looks; they never
 * change what is protected.
 * @typedef {object} CardField
 * @property {string} name
 * @property {boolean} [visible] Shown as plain text (for IDs).
 * @property {boolean} [multiline] A paste box that keeps line breaks.
 * @property {boolean} [optional] May be left empty.
 * @property {boolean} [saved] Already stored, so it may be left empty to keep the saved value.
 */

/**
 * @typedef {object} CardRequest
 * @property {CardField[]} fields
 * @property {string} [reason]
 * @property {string} [requester]
 * @property {string} storeLabel
 * @property {boolean} replacing
 * @property {boolean} allowSessionOnly Show "Remember on this computer"; when false the values are always saved.
 * @property {(values: Map<string, string>, remember: boolean) => Promise<void>} onSubmit Store (or hold) the non-empty values; throw to show the error on the card.
 * @property {(url: string) => Promise<boolean>} open Open the card for the person. Resolves false if nothing could be opened.
 * @property {number} [timeoutMs]
 */

/**
 * Check a submitted `values` object against the fields the card asked for.
 * Returns the non-empty values, trimmed at both ends (line breaks inside are
 * kept), in the card's order, or the 400 body to send back.
 * @param {CardField[]} fields
 * @param {unknown} values
 * @returns {{ values: Map<string, string> } | { error: string, field?: string }}
 */
function readValues(fields, values) {
  if (typeof values !== 'object' || values === null || Object.getPrototypeOf(values) !== Object.prototype) {
    return { error: 'Malformed request.' }
  }
  const posted = /** @type {Record<string, unknown>} */ (values)
  for (const key of Object.keys(posted)) {
    if (!fields.some((f) => f.name === key) || typeof posted[key] !== 'string') {
      return { error: 'Malformed request.' }
    }
  }
  /** @type {Map<string, string>} */
  const filled = new Map()
  for (const field of fields) {
    const raw = posted[field.name]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value.length > 0) filled.set(field.name, value)
    else if (!field.optional && !field.saved) return { error: `Fill in ${field.name}.`, field: field.name }
  }
  if (filled.size === 0) return { error: 'Paste at least one value.' }
  return { values: filled }
}

/** @param {string} a @param {string} b */
function sameString(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Serve the secret card on 127.0.0.1 behind a one-time path token and wait
 * for the person to submit it, cancel it or choose Later.
 *
 * Guards: loopback only; an unguessable 256-bit token in the path; the Host
 * header must be this exact loopback address (stops DNS-rebinding pages) and a
 * POST must carry this exact Origin (stops other sites posting into it); JSON
 * bodies only, size-capped; one successful submit, then the card is spent; a
 * deadline after which nothing is accepted.
 *
 * @param {CardRequest} request
 * @returns {Promise<{ remembered: boolean, values: Map<string, string> }>}
 */
export function requestSecretWithCard(request) {
  const token = randomBytes(32).toString('base64url')
  const timeoutMs = request.timeoutMs ?? DEFAULT_CARD_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    let settled = false
    let busy = false
    /** @type {string} */
    let origin = ''

    const server = createServer((req, res) => {
      const send = (/** @type {number} */ status, /** @type {object} */ body) => {
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        res.end(JSON.stringify(body))
      }

      if (!sameString(req.headers.host ?? '', origin.slice('http://'.length))) {
        send(403, { error: 'Forbidden.' })
        return
      }
      const url = new URL(req.url ?? '/', origin)
      const [, prefix, presented, action] = url.pathname.split('/')
      if (prefix !== 'card' || !presented || !sameString(presented, token)) {
        send(404, { error: 'Not found.' })
        return
      }

      if (req.method === 'GET' && action === undefined) {
        const nonce = randomBytes(16).toString('base64')
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`,
        })
        res.end(
          renderCard({
            fields: request.fields,
            reason: request.reason,
            requester: request.requester,
            storeLabel: request.storeLabel,
            replacing: request.replacing,
            allowSessionOnly: request.allowSessionOnly,
            nonce,
          }),
        )
        return
      }

      if (req.method !== 'POST' || (action !== 'submit' && action !== 'cancel' && action !== 'later')) {
        send(405, { error: 'Method not allowed.' })
        return
      }
      if (!sameString(req.headers.origin ?? '', origin)) {
        send(403, { error: 'Forbidden.' })
        return
      }
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
        send(415, { error: 'Unsupported content type.' })
        return
      }
      if (settled) {
        send(410, { error: 'This card was already used. Close this tab.', final: true })
        return
      }

      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) req.destroy()
        else chunks.push(chunk)
      })
      req.on('end', async () => {
        if (action === 'cancel') {
          send(200, { cancelled: true })
          finish(() => reject(new KeypromptError('The person closed the secret card without saving.', { exitCode: EXIT.CANCELLED })))
          return
        }
        if (action === 'later') {
          // A save already under way may still succeed, and then "Nothing was saved" would be false.
          if (busy) {
            send(409, { error: 'Already saving. Wait a moment.' })
            return
          }
          send(200, { later: true })
          const names = joinNames(request.fields.map((f) => f.name))
          finish(() => reject(new KeypromptError(`The person chose Later for ${names}. Nothing was saved.`, { exitCode: EXIT.DEFERRED })))
          return
        }
        /** @type {{ values?: unknown, remember?: unknown } | null} */
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          send(400, { error: 'Malformed request.' })
          return
        }
        const checked = readValues(request.fields, body?.values)
        if (!('values' in checked)) {
          send(400, checked)
          return
        }
        const { values } = checked
        if (busy) {
          send(409, { error: 'Already saving. Wait a moment.' })
          return
        }
        const remember = request.allowSessionOnly ? body?.remember !== false : true
        busy = true
        try {
          await request.onSubmit(values, remember)
        } catch (error) {
          busy = false
          send(422, { error: error instanceof KeypromptError ? error.message : 'Could not save. Try again.' })
          return
        }
        send(200, { remembered: remember })
        finish(() => resolve({ remembered: remember, values }))
      })
    })

    const timer = setTimeout(() => {
      finish(() =>
        reject(new KeypromptError('Nobody filled in the secret card in time (5 minutes). Run the command again to reopen it.', { exitCode: EXIT.TIMED_OUT })),
      )
    }, timeoutMs)

    /** @param {() => void} settle */
    function finish(settle) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Let the page receive its response before the server goes away.
      setTimeout(() => server.close(), 500).unref()
      server.closeIdleConnections?.()
      settle()
    }

    server.on('error', (error) => finish(() => reject(error)))
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        finish(() => reject(new KeypromptError('Could not start the local secret card.')))
        return
      }
      origin = `http://127.0.0.1:${address.port}`
      const opened = await request.open(`${origin}/card/${token}`).catch(() => false)
      if (!opened) {
        finish(() =>
          reject(
            new KeypromptError(
              'Could not open a browser for the secret card on this machine. keyprompt needs a desktop session (it does not work over plain SSH).',
            ),
          ),
        )
      }
    })
  })
}
