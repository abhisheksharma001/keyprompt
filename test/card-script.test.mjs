import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { CAPTIONS } from '../src/buddy.mjs'
import { cardScript, clockStep } from '../src/card-script.mjs'

const flush = () => new Promise((resolve) => setImmediate(resolve))

/** A clock the test moves by hand; timers run in order as it moves. */
function fakeTime(start) {
  let now = start
  let last = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimeout: (fn, ms = 0) => {
      timers.set(++last, { fn, at: now + ms })
      return last
    },
    clearTimeout: (id) => timers.delete(id),
    running: () => timers.size,
    async advance(ms) {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].fn()
        await flush()
      }
      now = end
      await flush()
    },
  }
}

/** Just enough of a page element for the card script. */
function element(attrs = {}) {
  const el = {
    attrs: { ...attrs },
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    className: '',
    children: [],
    dataset: {},
    listeners: {},
    classList: { toggle() {}, contains: () => false },
    addEventListener: (type, fn) => (el.listeners[type] ??= []).push(fn),
    getAttribute: (name) => el.attrs[name] ?? null,
    setAttribute: (name, value) => (el.attrs[name] = String(value)),
    removeAttribute: (name) => delete el.attrs[name],
    hasAttribute: (name) => name in el.attrs,
    append: (...kids) => el.children.push(...kids),
    replaceChildren: () => (el.children = []),
    focus() {},
  }
  return el
}

/**
 * Run the real card script against a fake page and a fake clock.
 * `answers` hands out the fake server's replies to each POST, in order; a
 * reply is a promise the test settles when it likes.
 */
function openCard({ names = ['A', 'B'], demo = false, run = false, expiresIn = 65_000 } = {}) {
  const time = fakeTime(1_000_000)
  const byId = {}
  for (const id of ['form', 'save', 'cancel', 'later', 'error', 'receipt', 'form-view', 'done-view']) byId[id] = element()
  // The real page starts with these hidden.
  byId.receipt.hidden = true
  byId.caption = element({ 'data-store': 'macOS Keychain' })
  byId.clock = element({ 'data-expires': String(time.now() + expiresIn) })
  if (run) byId.masking = Object.assign(element(), { hidden: true })
  const main = element(demo ? { 'data-demo': '' } : {})
  const buddy = element()
  const heading = element()
  const rows = names.map((name) => {
    const box = element()
    const row = element()
    row.dataset.name = name
    row.querySelector = (selector) => (selector === '.value' ? box : null)
    return Object.assign(row, { box })
  })
  const posts = []
  const fetch = (path, init) => new Promise((resolve) => posts.push({ path, body: JSON.parse(init.body), resolve }))
  const document = {
    getElementById: (id) => byId[id] ?? null,
    querySelector: (selector) => ({ 'main.card': main, '.buddy': buddy, h1: heading })[selector] ?? null,
    querySelectorAll: (selector) => (selector === '.row' ? rows : []),
    createElement: () => element(),
  }
  const window = { matchMedia: () => ({ matches: false }) }
  runInNewContext(cardScript(), {
    document,
    window,
    location: { pathname: '/card/token' },
    fetch,
    setTimeout: time.setTimeout,
    clearTimeout: time.clearTimeout,
    Date: { now: time.now },
  })
  const reply = async (post, status, data) => {
    post.resolve({ ok: status < 400, status, json: async () => data })
    await flush()
  }
  return {
    time,
    timers: time.running,
    byId,
    rows,
    posts,
    reply,
    mood: () => buddy.getAttribute('data-mood'),
    title: () => heading.textContent,
    clock: () => byId.clock.textContent,
    press: async (id) => {
      for (const fn of byId[id].listeners.click ?? []) fn({})
      await flush()
    },
    submit: async () => {
      for (const fn of byId.form.listeners.submit) fn({ preventDefault() {} })
      await flush()
    },
  }
}

test('the countdown reads m:ss and ticks on the second', () => {
  assert.deepEqual(clockStep(300_000, false), { text: 'Card closes in 5:00', wait: 1000 })
  assert.deepEqual(clockStep(299_500, false), { text: 'Card closes in 5:00', wait: 500 })
  assert.equal(clockStep(251_000, false).text, 'Card closes in 4:11')
  assert.equal(clockStep(61_000, false).text, 'Card closes in 1:01')
  assert.deepEqual(clockStep(1, false), { text: 'Card closes in 0:01', wait: 1 })
})

test('at zero the card sleeps, unless a request is still under way', () => {
  assert.deepEqual(clockStep(0, false), { timeout: true })
  assert.deepEqual(clockStep(-40, false), { timeout: true })
  assert.deepEqual(clockStep(0, true), { text: 'Time is up. Waiting for the answer…', wait: 250 })
  assert.equal(clockStep(-40, true).wait, 250)
})

test('the page counts down to the deadline; at zero the creature sleeps and the card says nothing was saved', async () => {
  const card = openCard({ expiresIn: 65_000 })
  assert.equal(card.clock(), 'Card closes in 1:05')
  await card.time.advance(1000)
  assert.equal(card.clock(), 'Card closes in 1:04')
  await card.time.advance(63_999)
  assert.equal(card.clock(), 'Card closes in 0:01')
  assert.equal(card.title(), '')
  await card.time.advance(1)
  assert.equal(card.title(), 'Timed out')
  assert.equal(card.mood(), 'asleep')
  assert.equal(card.byId.caption.textContent, CAPTIONS.asleep)
  assert.equal(card.byId.clock.hidden, true)
  assert.equal(card.byId['form-view'].hidden, true)
})

test('a save under way at zero decides: the card waits, then shows the receipt, not "Timed out"', async () => {
  const card = openCard({ expiresIn: 10_000 })
  card.rows[0].box.value = 'sk-secret-a'
  await card.submit()
  assert.equal(card.posts.length, 1)
  await card.time.advance(12_000)
  assert.equal(card.title(), '')
  assert.equal(card.clock(), 'Time is up. Waiting for the answer…')
  assert.equal(card.mood(), 'stashing')
  await card.reply(card.posts[0], 200, { remembered: true, receipt: [{ name: 'A', outcome: 'saved' }, { name: 'B', outcome: 'empty' }] })
  await card.time.advance(1000)
  assert.equal(card.title(), 'Saved')
  assert.equal(card.mood(), 'locked')
  assert.equal(card.byId.receipt.hidden, false)
  const lines = card.byId.receipt.children.map((li) => li.children.map((part) => part.textContent))
  assert.deepEqual(lines, [
    ['A', '— Saved in your macOS Keychain'],
    ['B', '— Left empty'],
  ])
  assert.equal(card.rows[0].box.value, '')
})

test('a save that fails after zero ends the card asleep; the form does not open again', async () => {
  const card = openCard({ expiresIn: 10_000 })
  card.rows[0].box.value = 'sk-secret-a'
  await card.submit()
  await card.time.advance(12_000)
  await card.reply(card.posts[0], 422, { error: 'Could not save. Try again.' })
  await card.time.advance(0)
  assert.equal(card.title(), 'Timed out')
  assert.equal(card.mood(), 'asleep')
  assert.equal(card.byId['form-view'].hidden, true)
})

test('once the card has ended, no timer is left running and it never turns into "Timed out"', async () => {
  const card = openCard({ expiresIn: 60_000 })
  assert.equal(card.timers(), 1)
  card.rows[0].box.value = 'sk-secret-a'
  await card.submit()
  await card.reply(card.posts[0], 200, { remembered: true, receipt: [{ name: 'A', outcome: 'saved' }] })
  await card.time.advance(700)
  assert.equal(card.title(), 'Saved')
  assert.equal(card.timers(), 0)
  await card.time.advance(600_000)
  assert.equal(card.title(), 'Saved')
  assert.equal(card.mood(), 'locked')

  const asleep = openCard({ expiresIn: 5_000 })
  await asleep.time.advance(5_000)
  assert.equal(asleep.title(), 'Timed out')
  assert.equal(asleep.timers(), 0)
})

test('a run card shows the masking sentence after a save; Later shows "Not saved (Later)" for every box and not that sentence', async () => {
  const saved = openCard({ run: true })
  saved.rows[0].box.value = 'sk-secret-a'
  await saved.submit()
  await saved.reply(saved.posts[0], 200, { remembered: false, receipt: [{ name: 'A', outcome: 'handed' }, { name: 'B', outcome: 'empty' }] })
  await saved.time.advance(700)
  assert.equal(saved.title(), 'Ready')
  assert.equal(saved.byId.masking.hidden, false)
  assert.equal(saved.byId.receipt.children[0].children[1].textContent, '— Handed to this one command, not saved')

  const later = openCard({ run: true })
  await later.press('later')
  await later.reply(later.posts[0], 200, { later: true })
  await later.time.advance(0)
  assert.equal(later.title(), 'Later')
  assert.deepEqual(
    later.byId.receipt.children.map((li) => li.children.map((part) => part.textContent)),
    [
      ['A', '— Not saved (Later)'],
      ['B', '— Not saved (Later)'],
    ],
  )
  assert.equal(later.byId.masking.hidden, true)
})

test('a demo card shows no receipt, even after Later', async () => {
  const card = openCard({ demo: true })
  await card.press('later')
  await card.reply(card.posts[0], 200, { later: true })
  await card.time.advance(0)
  assert.equal(card.title(), 'Later')
  assert.equal(card.byId.receipt.children.length, 0)
  assert.equal(card.byId.receipt.hidden, true)
})
