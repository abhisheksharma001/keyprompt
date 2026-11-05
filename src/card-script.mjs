/** The card's browser script text. renderCard places it inside the page's nonce'd <script> element. */
export function cardScript() {
  return `(() => {
  const base = location.pathname
  const form = document.getElementById('form')
  const rows = Array.from(document.querySelectorAll('.row'))
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

  function plural(n, word) {
    return n.toLocaleString('en-US') + ' ' + word + (n === 1 ? '' : 's')
  }

  // A password box cannot hold line breaks, so a multi-line box hides what
  // was pasted and shows only how much arrived, with Show and Clear.
  function pasteBox(box, row) {
    const pasted = row.querySelector('.pasted')
    const count = row.querySelector('.count')
    const reveal = row.querySelector('.reveal')
    const clear = row.querySelector('.clear')
    function conceal() {
      const text = box.value.trim()
      if (text.length === 0) { box.hidden = false; pasted.hidden = true; return }
      const lines = text.split(/\\r\\n|\\r|\\n/).length
      count.textContent = plural(lines, 'line') + ', ' + plural(text.length, 'character') + ' pasted'
      box.hidden = true
      pasted.hidden = false
      reveal.textContent = 'Show'
      reveal.setAttribute('aria-pressed', 'false')
    }
    box.addEventListener('paste', (event) => {
      if (box.value.length > 0) return
      const text = event.clipboardData ? event.clipboardData.getData('text/plain') : ''
      if (text.length === 0) return
      event.preventDefault()
      box.value = text
      conceal()
      reveal.focus()
    })
    reveal.addEventListener('click', () => {
      if (!box.hidden) { conceal(); return }
      box.hidden = false
      reveal.textContent = 'Hide'
      reveal.setAttribute('aria-pressed', 'true')
    })
    clear.addEventListener('click', () => {
      box.value = ''
      conceal()
      box.focus()
    })
  }

  for (const row of rows) {
    const box = row.querySelector('.value')
    const toggle = row.querySelector('.toggle')
    if (toggle) {
      toggle.addEventListener('click', () => {
        const show = box.type === 'password'
        box.type = show ? 'text' : 'password'
        toggle.textContent = show ? 'Hide' : 'Show'
        toggle.setAttribute('aria-pressed', String(show))
        box.focus()
      })
    }
    if (box.hasAttribute('data-paste')) pasteBox(box, row)
  }

  function finish(title, text) {
    for (const row of rows) row.querySelector('.value').value = ''
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
    const values = {}
    for (const row of rows) {
      const box = row.querySelector('.value')
      box.removeAttribute('aria-invalid')
      values[row.dataset.name] = box.value
    }
    save.disabled = true; cancel.disabled = true
    try {
      const { ok, data } = await post('/submit', { values, remember: remember ? remember.checked : true })
      if (ok) {
        finish(data.remembered ? 'Saved' : 'Ready', data.remembered
          ? 'Saved securely and kept private. You can close this tab.'
          : 'Handed to the command for this run only, not saved. You can close this tab.')
        return
      }
      error.textContent = data.error || 'Could not save. Try again.'
      if (data.final) { finish('Closed', data.error || 'This card is no longer active.') }
      const missing = rows.find((row) => row.dataset.name === data.field)
      if (missing) {
        const box = missing.querySelector('.value')
        box.setAttribute('aria-invalid', 'true')
        box.focus()
      }
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
