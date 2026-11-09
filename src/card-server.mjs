import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { renderCard } from './card-page.mjs'
import { EXIT, KeypromptError } from './errors.mjs'
import { receiptFor } from './receipt.mjs'
import { joinNames } from './save.mjs'

/** 12 fields of up to 64 KiB each, with room for JSON escaping. */
const MAX_BODY_BYTES = 1024 * 1024
export const DEFAULT_CARD_TIMEOUT_MS = 5 * 60 * 1000
/** Said to any request that reaches a card after it ended. True however it ended: saved, cancelled, Later or timed out. */
const CARD_ENDED = 'This card is no longer active. Close this tab.'

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
 * @property {boolean} [demo] A demo card: the page says so and never claims a save or a store. Its `onSubmit` must keep nothing.
 * @property {boolean} [masked] The values go to a command whose output keyprompt masks, so the done screen may say so.
 * @property {boolean} [allowEmpty] Save may leave every box empty when no box is required: the card then ends with no values, and `onSubmit` is not called. `run` sets it, so an optional name can be skipped; `set` does not, because saving nothing is not a save (B-4).
 * @property {(values: Map<string, string>, remember: boolean) => Promise<void>} onSubmit Store (or hold) the non-empty values; throw to show the error on the card.
 * @property {(url: string) => Promise<boolean>} open Open the card for the person. Resolves false if nothing could be opened.
 * @property {number} [timeoutMs]
 * @property {AbortSignal} [signal] Ends the card the way Cancel does, for a caller that no longer wants the answer (an MCP client's cancel, B-21). A save already under way finishes first.
 */

/**
 * Check a submitted `values` object against the fields the card asked for.
 * Returns the non-empty values, trimmed at both ends (line breaks inside are
 * kept), in the card's order, or the 400 body to send back. A required box is
 * always checked first, so no values at all can pass only when every box is
 * optional (or already saved) and `allowEmpty` is set.
 * @param {CardField[]} fields
 * @param {unknown} values
 * @param {boolean} allowEmpty
 * @returns {{ values: Map<string, string> } | { error: string, field?: string }}
 */
function readValues(fields, values, allowEmpty) {
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
  if (filled.size === 0 && !allowEmpty) return { error: 'Paste at least one value.' }
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
  // The page counts down to this moment. Both run on this computer, so they share a clock.
  const expiresAt = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const withdrawn = () =>
      new KeypromptError('The request was cancelled, so keyprompt closed the secret card. Nothing was saved.', { exitCode: EXIT.CANCELLED })
    if (request.signal?.aborted) {
      reject(withdrawn())
      return
    }
    let settled = false
    let busy = false
    // The deadline passed while a save was under way, so that save's result ends the card.
    let expired = false
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
            demo: request.demo === true,
            masked: request.masked === true,
            expiresAt,
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
        send(410, { error: CARD_ENDED, final: true })
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
        // The card may have ended while this body was still arriving.
        if (settled) {
          send(410, { error: CARD_ENDED, final: true })
          return
        }
        if (action === 'cancel') {
          // A save already under way may still succeed, and then "without saving" would be false.
          if (busy) {
            send(409, { error: 'Already saving. Wait a moment.' })
            return
          }
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
        const checked = readValues(request.fields, body?.values, request.allowEmpty === true)
        if (!('values' in checked)) {
          send(400, checked)
          return
        }
        const { values } = checked
        if (busy) {
          send(409, { error: 'Already saving. Wait a moment.' })
          return
        }
        if (values.size === 0) {
          // Every box was left empty on a card that allows it: nothing to store or hold, so the store is not called.
          send(200, { remembered: false, receipt: receiptFor(request.fields, values, false) })
          finish(() => resolve({ remembered: false, values }))
          return
        }
        const remember = request.allowSessionOnly ? body?.remember !== false : true
        busy = true
        try {
          await request.onSubmit(values, remember)
        } catch (error) {
          busy = false
          const shown = error instanceof KeypromptError ? error.message : 'Could not save. Try again.'
          if (expired) {
            // Past the deadline there is no second try: the card ends with this save's own error.
            send(422, { error: shown, final: true })
            finish(() => reject(error instanceof KeypromptError ? error : new KeypromptError(shown)))
            return
          }
          send(422, { error: shown })
          return
        }
        // A demo keeps nothing, so it has no receipt to tell.
        send(200, request.demo ? { remembered: remember } : { remembered: remember, receipt: receiptFor(request.fields, values, remember) })
        finish(() => resolve({ remembered: remember, values }))
      })
    })

    const timer = setTimeout(() => {
      // A save under way may still succeed, and then "Nobody filled in" would be false: wait for it.
      if (busy) {
        expired = true
        return
      }
      finish(() =>
        reject(new KeypromptError('Nobody filled in the secret card in time (5 minutes). Run the command again to reopen it.', { exitCode: EXIT.TIMED_OUT })),
      )
    }, timeoutMs)

    const onAbort = () => {
      // A save under way may still succeed, and then "Nothing was saved" would be false: that save ends the card.
      if (busy) {
        expired = true
        return
      }
      finish(() => reject(withdrawn()))
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })

    /** @param {() => void} settle */
    function finish(settle) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', onAbort)
      // Let the page receive its response before the server goes away.
      setTimeout(() => server.close(), 500).unref()
      server.closeIdleConnections?.()
      settle()
    }

    server.on('error', (error) => finish(() => reject(error)))
    server.listen(0, '127.0.0.1', async () => {
      // Aborted before the server was ready: open nothing.
      if (settled) return
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
