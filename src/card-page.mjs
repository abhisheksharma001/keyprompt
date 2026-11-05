import { cardScript } from './card-script.mjs'
import { cardStyle } from './card-style.mjs'

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
 * The secure secret card. Everything in it is static except the escaped
 * name, reason, requester and store label; the value typed into it is only
 * ever POSTed back to the local server, never placed into the page.
 *
 * @param {{
 *   name: string,
 *   reason?: string,
 *   requester?: string,
 *   storeLabel: string,
 *   replacing: boolean,
 *   allowSessionOnly: boolean,
 *   nonce: string,
 * }} options
 */
export function renderCard({ name, reason, requester, storeLabel, replacing, allowSessionOnly, nonce }) {
  const title = replacing ? 'Replace secret' : 'Secret requested'
  const action = replacing ? 'Replace value' : 'Save securely'
  const reasonHtml = reason ? `<p class="reason">${escapeHtml(reason)}</p>` : ''
  const requesterHtml = requester ? `<p class="meta">Requested by ${escapeHtml(requester)}</p>` : ''
  const replaceNote = replacing
    ? '<p class="note">A value is already saved. It can\'t be shown; paste the new one to replace it.</p>'
    : ''
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
<title>${escapeHtml(title)}: ${escapeHtml(name)}</title>
<style>
${cardStyle()}
</style>
</head>
<body>
<main class="card" aria-live="polite">
  <section id="form-view">
    <div class="head">
      <div class="icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </div>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <span class="chip">${escapeHtml(name)}</span>
    ${reasonHtml}
    ${requesterHtml}
    ${replaceNote}
    <form id="form" autocomplete="off">
      <div class="field">
        <input id="value" type="password" spellcheck="false" autocapitalize="off" autocorrect="off" aria-label="Secret value for ${escapeHtml(name)}" placeholder="Paste the value" autofocus>
        <button type="button" id="toggle" aria-pressed="false">Show</button>
      </div>
      ${rememberHtml}
      <p class="error" id="error" role="alert"></p>
      <div class="actions">
        <button type="button" id="cancel">Cancel</button>
        <button type="submit" class="primary" id="save">${escapeHtml(action)}</button>
      </div>
    </form>
  </section>
  <section id="done-view" class="done" hidden>
    <div class="tick" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </div>
    <h2 id="done-title">Saved</h2>
    <p id="done-text">Saved securely and kept private. You can close this tab.</p>
  </section>
  <footer>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    <span id="footer-text">Stored in your ${escapeHtml(storeLabel)} · never shown to your agent</span>
  </footer>
</main>
<script nonce="${nonce}">
${cardScript()}
</script>
</body>
</html>`
}
