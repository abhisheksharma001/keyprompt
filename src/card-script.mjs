import { CAPTION_VARIANTS, CAPTIONS, STASH_MS } from './buddy.mjs'
import { RECEIPT_WORDS } from './receipt.mjs'

/**
 * What the footer countdown does next. `left` is the milliseconds to the
 * deadline; `busy` is true while a request or the finish wait is under way.
 * The card's script embeds this function's source, so it may use nothing
 * outside itself.
 * @param {number} left
 * @param {boolean} busy
 * @returns {{ text: string, wait: number } | { timeout: true }}
 */
export function clockStep(left, busy) {
  if (left > 0) {
    const seconds = Math.ceil(left / 1000)
    const text = 'Card closes in ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
    return { text, wait: left % 1000 || 1000 }
  }
  // At zero a save that is under way decides how the card ends: the server waits for it too.
  if (busy) return { text: 'Time is up. Waiting for the answer…', wait: 250 }
  return { timeout: true }
}

/** The card's browser script text. renderCard places it inside the page's nonce'd <script> element. */
export function cardScript() {
  return `(() => {
  const base = location.pathname
  const form = document.getElementById('form')
  const rows = Array.from(document.querySelectorAll('.row'))
  const remember = document.getElementById('remember')
  const save = document.getElementById('save')
  const cancel = document.getElementById('cancel')
  const later = document.getElementById('later')
  const error = document.getElementById('error')
  // A demo card keeps nothing, so no message may say "Saved".
  const demo = document.querySelector('main.card').hasAttribute('data-demo')
  const buddy = document.querySelector('.buddy')
  const caption = document.getElementById('caption')
  const heading = document.querySelector('h1')
  const clock = document.getElementById('clock')
  const expiresAt = Number(clock.getAttribute('data-expires'))
  const store = caption.getAttribute('data-store') || ''
  const CAPTIONS = ${JSON.stringify(CAPTIONS)}
  const VARIANTS = ${JSON.stringify(CAPTION_VARIANTS)}
  const RECEIPT = ${JSON.stringify(RECEIPT_WORDS)}
  const STASH_MS = ${STASH_MS}
  const clockStep = ${clockStep}
  // Saving or ended: focus no longer changes the buddy's mood.
  let still = false
  // A request or the wait after a save is under way, so the deadline must not end the card.
  let busy = false
  // The card is over: the countdown stops.
  let ended = false
  let clockTimer = 0
  // The first box has focus on load, so focus alone would skip the opening
  // caption. The buddy follows focus from the person's first click, key or
  // paste in the form; it never looks at what was typed.
  let engaged = false

  function lock(locked) {
    busy = locked
    save.disabled = locked; cancel.disabled = locked; later.disabled = locked
    // Unlocked after the deadline: the card is over, so the form must not stay open.
    if (!locked) tick()
  }

  // The footer counts down to the server's deadline. At zero the card sleeps,
  // unless a request is still under way: that request's answer ends the card.
  function tick() {
    clearTimeout(clockTimer)
    if (ended) return
    const step = clockStep(expiresAt - Date.now(), busy)
    if (step.timeout) { finish('Timed out', 'asleep'); return }
    clock.textContent = step.text
    clockTimer = setTimeout(tick, step.wait)
  }

  // A caption must stay true: a demo saves nothing, and with "Remember"
  // unticked the value goes to one command, not to the store.
  function captionFor(id) {
    const variants = demo ? VARIANTS.demo : remember && !remember.checked ? VARIANTS.oneRun : {}
    return (variants[id] || CAPTIONS[id]).split('{store}').join(store)
  }

  // The buddy follows focus, the kind of box and the outcome, never what was typed.
  function setMood(id, text) {
    buddy.setAttribute('data-mood', id)
    caption.textContent = text === undefined ? captionFor(id) : text
    caption.classList.toggle('err', id === 'oops')
  }

  function moodFor(element) {
    if (!element || !element.classList || !element.classList.contains('value')) return 'listening'
    return element.type === 'password' ? 'peek-proof' : 'watching'
  }

  form.addEventListener('focusin', (event) => {
    if (engaged && !still) setMood(moodFor(event.target))
  })
  form.addEventListener('focusout', (event) => {
    if (engaged && !still && moodFor(event.relatedTarget) === 'listening') setMood('listening')
  })
  for (const type of ['pointerdown', 'keydown', 'paste']) {
    form.addEventListener(type, () => {
      if (engaged) return
      engaged = true
      if (!still) setMood(moodFor(document.activeElement))
    }, true)
  }

  if (remember) {
    const footer = document.getElementById('footer-text')
    const savedFooter = footer.textContent
    const savedAction = save.textContent
    remember.addEventListener('change', () => {
      save.textContent = remember.checked ? savedAction : 'Use for this run'
      footer.textContent = remember.checked ? savedFooter : 'Held for this one command only · never shown to your agent'
      if (!still) setMood(moodFor(document.activeElement))
    })
  }

  for (const button of document.querySelectorAll('[data-preview]')) {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-preview')
      const text = CAPTIONS[id] ? CAPTIONS[id].split('{store}').join('password store') : 'the card shows the error from the save, word for word.'
      setMood(id, 'Preview: ' + text)
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
        // The box may have kept focus, so no focus event says it is shown now.
        if (!still) setMood(moodFor(box))
      })
    }
    if (box.hasAttribute('data-paste')) pasteBox(box, row)
  }

  // One line per box on the done screen. The names are text, never markup.
  function showReceipt(lines) {
    const list = document.getElementById('receipt')
    list.replaceChildren()
    for (const { name, outcome } of lines) {
      if (!RECEIPT[outcome]) continue
      const item = document.createElement('li')
      const chip = document.createElement('span')
      chip.className = 'chip'
      chip.textContent = name
      const what = document.createElement('span')
      what.textContent = '— ' + RECEIPT[outcome].split('{store}').join(store)
      item.append(chip, what)
      list.append(item)
    }
    list.hidden = list.children.length === 0
  }

  // The card has ended: the title and the buddy say how. Its caption already
  // says "You can close this tab." when the mood is closed.
  function finish(title, id, text) {
    still = true
    ended = true
    clearTimeout(clockTimer)
    clock.hidden = true
    for (const row of rows) row.querySelector('.value').value = ''
    heading.textContent = title
    setMood(id, text)
    document.getElementById('form-view').hidden = true
    document.getElementById('done-view').hidden = id === 'closed'
  }

  // The server ended the card. 410 means it was already used; anything else is
  // that request's own error.
  function finishFinal(status, message) {
    if (status === 410) finish('Closed', 'closed')
    else finish('Closed', 'oops', message || 'This card is no longer active.')
  }

  // The done screen waits for what is left of the key's trip into the vault,
  // and not at all when the computer asks for less motion.
  function settle(started) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()
    const left = STASH_MS - (Date.now() - started)
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, left)))
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
    return { ok: res.ok, status: res.status, data }
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
    lock(true)
    still = true
    setMood('stashing')
    const started = Date.now()
    try {
      const { ok, status, data } = await post('/submit', { values, remember: remember ? remember.checked : true })
      if (ok) await settle(started)
      if (ok && demo) {
        finish('Demo finished', 'locked')
        return
      }
      if (ok) {
        showReceipt(data.receipt || [])
        // Only a run card's page has this note.
        const masking = document.getElementById('masking')
        if (masking) masking.hidden = false
        finish(data.remembered ? 'Saved' : 'Ready', data.remembered ? 'locked' : 'one-run')
        return
      }
      const message = data.error || 'Could not save. Try again.'
      if (data.final) {
        finishFinal(status, message)
        return
      }
      still = false
      const missing = rows.find((row) => row.dataset.name === data.field)
      if (missing) {
        // The box gets focus, so the buddy follows it and the message stays by the buttons.
        error.textContent = message
        const box = missing.querySelector('.value')
        box.setAttribute('aria-invalid', 'true')
        box.focus()
        setMood(moodFor(box))
      } else {
        setMood('oops', message)
      }
    } catch {
      still = false
      setMood('oops', 'The request stopped waiting. Close this tab and ask your agent to try again.')
    }
    lock(false)
  })

  cancel.addEventListener('click', async () => {
    error.textContent = ''
    lock(true)
    try {
      const { ok, status, data } = await post('/cancel', {})
      if (ok) {
        finish('Cancelled', 'bye')
        return
      }
      if (data.final) {
        finishFinal(status, data.error)
        return
      }
      setMood('oops', data.error || 'That did not work. Try again.')
    } catch {
      // No answer means the card already ended, maybe with a save from another tab.
      finish('Closed', 'closed', 'This card is no longer active. You can close this tab.')
      return
    }
    lock(false)
  })

  later.addEventListener('click', async () => {
    error.textContent = ''
    lock(true)
    try {
      const { ok, status, data } = await post('/later', {})
      if (ok) {
        // Later keeps nothing, so every box reads the same. A demo has no receipt.
        if (!demo) showReceipt(rows.map((row) => ({ name: row.dataset.name, outcome: 'later' })))
        finish('Later', 'later')
        return
      }
      if (data.final) {
        finishFinal(status, data.error)
        return
      }
      setMood('oops', data.error || 'That did not work. Try again.')
    } catch {
      setMood('oops', 'The request stopped waiting. Close this tab and ask your agent to try again.')
    }
    lock(false)
  })

  tick()
})()`
}
