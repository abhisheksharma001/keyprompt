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
  :root {
    --bg: #f4f4f5; --card: #ffffff; --text: #18181b; --muted: #71717a; --line: #e4e4e7;
    --field: #fafafa; --accent: #18181b; --accent-text: #ffffff; --ok: #15803d; --err: #b91c1c;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #09090b; --card: #18181b; --text: #fafafa; --muted: #a1a1aa; --line: #27272a;
      --field: #0f0f11; --accent: #fafafa; --accent-text: #09090b; --ok: #4ade80; --err: #f87171;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
  }
  .card {
    width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,.08);
  }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .icon { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--field); border: 1px solid var(--line); }
  h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .chip {
    display: inline-block; font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 6px 9px; border-radius: 8px; background: var(--field); border: 1px solid var(--line);
    word-break: break-all;
  }
  .reason { margin: 12px 0 0; }
  .meta, .hint, .note, footer { color: var(--muted); font-size: 13px; }
  .meta { margin: 6px 0 0; }
  .note { margin: 10px 0 0; }
  .field { display: flex; gap: 8px; margin-top: 16px; }
  input[type=password], input[type=text] {
    flex: 1; min-width: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--field); color: var(--text); font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--card);
    color: var(--text); font: inherit; font-weight: 600; cursor: pointer;
  }
  button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  .check { display: flex; gap: 8px; align-items: center; margin-top: 14px; font-size: 14px; }
  .hint { margin: 4px 0 0 24px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .error { color: var(--err); font-size: 13px; margin: 10px 0 0; min-height: 1em; }
  footer { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; gap: 6px; align-items: center; }
  .done { text-align: center; padding: 8px 0; }
  .done .tick { width: 44px; height: 44px; margin: 0 auto 10px; border-radius: 50%; display: grid; place-items: center; background: var(--field); border: 1px solid var(--line); color: var(--ok); }
  .done h2 { font-size: 17px; margin: 0 0 4px; }
  .done p { margin: 0; color: var(--muted); font-size: 14px; }
  [hidden] { display: none !important; }
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
(() => {
  const base = location.pathname
  const form = document.getElementById('form')
  const value = document.getElementById('value')
  const toggle = document.getElementById('toggle')
  const remember = document.getElementById('remember')
  const save = document.getElementById('save')
  const cancel = document.getElementById('cancel')
  const error = document.getElementById('error')

  if (remember) {
    const footer = document.getElementById('footer-text')
    const savedFooter = footer.textContent
    const savedAction = save.textContent
    remember.addEventListener('change', () => {
      save.textContent = remember.checked ? savedAction : 'Use for this run'
      footer.textContent = remember.checked ? savedFooter : 'Held for this one command only · never shown to your agent'
    })
  }

  toggle.addEventListener('click', () => {
    const show = value.type === 'password'
    value.type = show ? 'text' : 'password'
    toggle.textContent = show ? 'Hide' : 'Show'
    toggle.setAttribute('aria-pressed', String(show))
    value.focus()
  })

  function finish(title, text) {
    value.value = ''
    document.getElementById('done-title').textContent = title
    document.getElementById('done-text').textContent = text
    document.getElementById('form-view').hidden = true
    document.getElementById('done-view').hidden = false
  }

  async function post(path, body) {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    let data = {}
    try { data = await res.json() } catch {}
    return { ok: res.ok, data }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    error.textContent = ''
    if (value.value.trim().length === 0) { error.textContent = 'Paste the value first.'; return }
    save.disabled = true; cancel.disabled = true
    try {
      const { ok, data } = await post('/submit', { value: value.value, remember: remember ? remember.checked : true })
      if (ok) {
        finish(data.remembered ? 'Saved' : 'Ready', data.remembered
          ? 'Saved securely and kept private. You can close this tab.'
          : 'Handed to the command for this run only, not saved. You can close this tab.')
        return
      }
      error.textContent = data.error || 'Could not save. Try again.'
      if (data.final) { finish('Closed', data.error || 'This card is no longer active.') }
    } catch {
      error.textContent = 'The request stopped waiting. Close this tab and ask your agent to try again.'
    }
    save.disabled = false; cancel.disabled = false
  })

  cancel.addEventListener('click', async () => {
    save.disabled = true; cancel.disabled = true
    try { await post('/cancel', {}) } catch {}
    finish('Cancelled', 'Nothing was saved. You can close this tab.')
  })
})()
</script>
</body>
</html>`
}
