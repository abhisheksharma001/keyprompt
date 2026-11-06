import { buddyStyle, buddySvg, CAPTION_VARIANTS, CAPTIONS, MOODS } from './buddy.mjs'
import { cardScript } from './card-script.mjs'
import { cardStyle } from './card-style.mjs'
import { MASKING_NOTE } from './receipt.mjs'

/** @param {string} text */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * One row per field: the name as a chip, a small tag per hint, then the box.
 * A visible box is plain text; a multi-line one is a paste box that the page
 * script hides once something is pasted (visible and multi-line together is a
 * plain text area); every other box is a password box with Show.
 *
 * @param {import('./card-server.mjs').CardField} field
 * @param {number} index
 */
function renderField(field, index) {
  const name = escapeHtml(field.name)
  const id = `field-${index}`
  const tags = [field.visible && 'shown', field.multiline && 'multi-line', field.optional && 'optional']
    .filter(Boolean)
    .map((tag) => `<span class="tag">${tag}</span>`)
    .join('')
  const placeholder = field.saved ? 'Saved — leave empty to keep' : field.multiline ? 'Paste here' : 'Paste the value'
  const common = `id="${id}" class="value" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="${placeholder}"${index === 0 ? ' autofocus' : ''}`
  let box
  if (field.multiline && field.visible) {
    box = `<textarea ${common} rows="4" aria-label="Value for ${name}"></textarea>`
  } else if (field.multiline) {
    box = `<textarea ${common} rows="3" data-paste aria-label="Secret value for ${name}"></textarea>
        <div class="pasted" hidden><span class="count" aria-live="polite"></span><button type="button" class="reveal" aria-pressed="false">Show</button><button type="button" class="clear">Clear</button></div>`
  } else if (field.visible) {
    box = `<input ${common} type="text" aria-label="Value for ${name}">`
  } else {
    box = `<input ${common} type="password" aria-label="Secret value for ${name}">
        <button type="button" class="toggle" aria-pressed="false">Show</button>`
  }
  return `<div class="row" data-name="${name}">
        <div class="label"><label class="chip" for="${id}">${name}</label>${tags}</div>
        <div class="field${field.multiline ? ' stack' : ''}">
        ${box}
        </div>
      </div>`
}

/**
 * The secure secret card. Everything in it is static except the escaped
 * field names, reason, requester and store label; the values typed into it
 * are only ever POSTed back to the local server, never placed into the page.
 *
 * @param {{
 *   fields: import('./card-server.mjs').CardField[],
 *   reason?: string,
 *   requester?: string,
 *   storeLabel: string,
 *   replacing: boolean,
 *   allowSessionOnly: boolean,
 *   demo?: boolean,
 *   masked?: boolean,
 *   expiresAt: number,
 *   nonce: string,
 * }} options
 */
export function renderCard({ fields, reason, requester, storeLabel, replacing, allowSessionOnly, demo = false, masked = false, expiresAt, nonce }) {
  const several = fields.length > 1
  const title = replacing
    ? several
      ? 'Replace secrets'
      : 'Replace secret'
    : several
      ? 'Secrets requested'
      : 'Secret requested'
  // "Save all N" is true only when every box must be filled. A card with an optional box may save fewer than it shows, so it says plain "Save" (B-14, invariant 9).
  const mayLeaveEmpty = fields.some((f) => f.optional)
  const saveLabel = mayLeaveEmpty ? 'Save' : several ? `Save all ${fields.length}` : 'Save securely'
  const action = replacing ? (several ? 'Replace values' : 'Replace value') : saveLabel
  const demoHtml = demo ? '<p class="note" role="note"><strong>Demo — nothing you type is saved.</strong></p>' : ''
  // The footer says where a Save goes and nothing about what the agent can see (B-10, invariant 9).
  const footerText = demo ? 'Demo · nothing is stored' : `Stored in your ${escapeHtml(storeLabel)}`
  const reasonHtml = reason ? `<p class="reason">${escapeHtml(reason)}</p>` : ''
  const requesterHtml = requester ? `<p class="meta">Requested by ${escapeHtml(requester)}</p>` : ''
  const replaceNote = !replacing
    ? ''
    : several
      ? '<p class="note">These values are already saved and can\'t be shown. Paste a new value to replace one; an empty box keeps its saved value.</p>'
      : '<p class="note">A value is already saved. It can\'t be shown; paste the new one to replace it.</p>'
  // A demo has no store, so its caption must not name one (invariant 9).
  const caption = demo ? CAPTION_VARIANTS.demo.listening : CAPTIONS.listening.split('{store}').join(storeLabel)
  const storeAttr = demo ? '' : ` data-store="${escapeHtml(storeLabel)}"`
  const previewHtml = demo
    ? `<div class="preview" role="group" aria-label="Preview the penguin's poses">
    <span>The penguin's poses:</span>
    ${MOODS.map(({ id }) => `<button type="button" data-preview="${id}">${id}</button>`).join('')}
  </div>`
    : ''
  // Only a card whose command output is masked may say so (not `run --no-redact`, not `set`).
  const maskingHtml = masked ? `<p class="note" id="masking" hidden>${escapeHtml(MASKING_NOTE)}</p>` : ''
  const rememberHtml = allowSessionOnly
    ? `<label class="check"><input type="checkbox" id="remember" checked> Remember on this computer</label>
       <p class="hint" id="remember-hint">Unchecked: used for this one command, then forgotten.</p>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}: ${fields.map((f) => escapeHtml(f.name)).join(', ')}</title>
<style>
${cardStyle()}
${buddyStyle()}
</style>
</head>
<body>
<main class="card" aria-live="polite"${demo ? ' data-demo' : ''}>
  <div class="head">
    ${buddySvg()}
    <div class="head-text">
      <h1>${escapeHtml(title)}</h1>
      <p class="caption" id="caption" aria-live="polite"${storeAttr}>${escapeHtml(caption)}</p>
    </div>
  </div>
  ${previewHtml}
  <section id="form-view">
    ${demoHtml}
    ${reasonHtml}
    ${requesterHtml}
    ${replaceNote}
    <form id="form" autocomplete="off">
      <div class="rows">
      ${fields.map(renderField).join('\n      ')}
      </div>
      ${rememberHtml}
      <p class="error" id="error" role="alert"></p>
      <div class="actions">
        <button type="button" id="later">Later</button>
        <button type="button" id="cancel">Cancel</button>
        <button type="submit" class="primary" id="save">${escapeHtml(action)}</button>
      </div>
    </form>
  </section>
  <section id="done-view" class="done" hidden>
    <ul class="receipt" id="receipt" hidden></ul>
    ${maskingHtml}
    <p>You can close this tab.</p>
  </section>
  <footer id="footer">
    <div class="foot-note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span id="footer-text">${footerText}</span>
    </div>
    <span class="clock" id="clock" role="timer" aria-live="off" data-expires="${Math.trunc(expiresAt)}"></span>
  </footer>
</main>
<script nonce="${nonce}">
${cardScript()}
</script>
</body>
</html>`
}
