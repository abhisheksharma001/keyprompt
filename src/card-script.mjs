/** The card's browser script text. renderCard places it inside the page's nonce'd <script> element. */
export function cardScript() {
  return `(() => {
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
})()`
}
