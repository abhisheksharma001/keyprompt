// @ts-nocheck
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buddyStyle, buddySvg, CAPTION_VARIANTS, MOODS, STASH_MS } from '../src/buddy.mjs'
import { renderCard } from '../src/card-page.mjs'
import { cardScript } from '../src/card-script.mjs'

const svg = buddySvg()
const style = buddyStyle()

/** Every @keyframes set by name, as its frames: where in the run, and what it sets. */
function keyframes() {
  return Object.fromEntries([...style.matchAll(/@keyframes ([a-z-]+) \{ (.*) \}$/gm)].map(([, name, body]) => [
    name,
    [...body.matchAll(/([0-9a-z%, ]+?) \{ ([^}]*) \}/g)].map(([, at, decls]) => ({ at: at.trim(), decls })),
  ]))
}

/** Each rule that starts an animation: the mood, the part, the keyframes name and the whole line. */
function animations() {
  return style.split('\n').filter((l) => / animation: b-/.test(l)).map((line) => {
    const [, mood, part] = line.match(/\[data-mood="([a-z-]+)"\] \.([a-z-]+)/)
    return { mood, part, name: line.match(/animation: (b-[a-z-]+)/)[1], line }
  })
}

test('MOODS is the buddy table in the PRD, caption for caption', () => {
  const prd = readFileSync(new URL('../docs/prd/card-v2.md', import.meta.url), 'utf8')
  const section = prd.slice(prd.indexOf('### The buddy'), prd.indexOf('### The receipt'))
  const rows = [...section.matchAll(/^\| [^|]+ \| `([a-z-]+)` \| [^|]+ \| (.+) \|$/gm)].map(([, id, cell]) => ({
    id,
    caption: cell.startsWith('"') ? cell.slice(1, -1) : null,
  }))
  assert.equal(rows.length, 13)
  assert.deepEqual(MOODS, rows)
})

test('the SVG is inline only: no script, image, link or outside reference, and under 8 KB', () => {
  for (const banned of ['<script', '<image', '<foreignObject', '<use', 'href', 'http', 'url(', 'style=']) {
    assert.ok(!svg.includes(banned), banned)
  }
  assert.doesNotMatch(svg, /\son[a-z]+=/i)
  for (const banned of ['url(', '@import', 'http']) assert.ok(!style.includes(banned), banned)
  assert.ok(Buffer.byteLength(svg) < 8192, `${Buffer.byteLength(svg)} bytes`)
})

test('the SVG names its parts, and no colour is written into it', () => {
  for (const part of ['body', 'eyes', 'lids', 'arms', 'key', 'door', 'envelope', 'note', 'zzz']) {
    assert.match(svg, new RegExp(`<g class="${part}"`), part)
  }
  assert.doesNotMatch(svg, /\s(fill|stroke|color)="/)
  assert.doesNotMatch(svg, /#[0-9a-f]{3,8}\b/i)
  assert.ok(buddySvg('later').includes('<svg class="buddy" data-mood="later"'))
})

test('every part names real moods, and each mood has its own pose', () => {
  const ids = MOODS.map((m) => m.id)
  const parts = [...svg.matchAll(/data-(show|hide)="([^"]+)"/g)].map(([, kind, list]) => ({ kind, moods: list.split(' ') }))
  for (const { moods } of parts) for (const id of moods) assert.ok(ids.includes(id), `unknown mood ${id}`)

  // A pose is the parts a mood shows and hides, plus where it looks or leans.
  const pose = Object.fromEntries(ids.map((id) => [id, []]))
  parts.forEach(({ kind, moods }, i) => {
    for (const id of moods) pose[id].push(`${kind}${i}`)
  })
  for (const line of style.split('\n').filter((l) => l.includes('transform:') && l.includes('[data-mood='))) {
    const transform = line.slice(line.indexOf('transform:'))
    for (const [, id, part] of line.matchAll(/\[data-mood="([a-z-]+)"\] \.([a-z-]+)/g)) pose[id].push(`${part} ${transform}`)
  }
  const shapes = ids.map((id) => pose[id].sort().join('|'))
  assert.equal(new Set(shapes).size, ids.length, JSON.stringify(pose))
})

test('every colour the buddy uses is set for light and for dark', () => {
  const darkAt = style.indexOf('@media (prefers-color-scheme: dark)')
  const defined = (text) => new Set([...text.matchAll(/--b-([a-z-]+):/g)].map((m) => m[1]))
  const light = defined(style.slice(0, darkAt))
  const dark = defined(style.slice(darkAt, style.indexOf('}', style.indexOf('.buddy {', darkAt))))
  const used = new Set([...style.matchAll(/var\(--b-([a-z-]+)\)/g)].map((m) => m[1]))
  assert.ok(used.size > 10)
  for (const name of used) {
    assert.ok(light.has(name), `light --b-${name}`)
    assert.ok(dark.has(name), `dark --b-${name}`)
  }
  assert.deepEqual([...dark].sort(), [...light].sort())
})

test('a caption that names the store has a demo caption that does not', () => {
  for (const { id, caption } of MOODS.filter((m) => m.caption?.includes('{store}'))) {
    assert.ok(CAPTION_VARIANTS.demo[id], `demo caption for ${id}`)
  }
  for (const text of [...Object.values(CAPTION_VARIANTS.demo), ...Object.values(CAPTION_VARIANTS.oneRun)]) {
    assert.ok(!text.includes('{store}'), text)
  }
  assert.ok(CAPTION_VARIANTS.oneRun.listening)
})

test('motion: every mood but watching, handing, skipped and closed moves, only transform and opacity, and only listening and asleep loop', () => {
  const frames = keyframes()
  const runs = animations()
  const moved = [...new Set(runs.map((r) => r.mood))].sort()
  assert.deepEqual(moved, ['asleep', 'bye', 'later', 'listening', 'locked', 'one-run', 'oops', 'peek-proof', 'stashing'])
  assert.deepEqual([...new Set(runs.map((r) => r.name))].sort(), Object.keys(frames).sort())
  for (const [name, list] of Object.entries(frames)) {
    for (const { decls } of list) {
      for (const [, prop] of decls.matchAll(/([a-z-]+):/g)) assert.ok(['transform', 'opacity'].includes(prop), `${name} moves ${prop}`)
    }
  }
  for (const { mood, line } of runs) {
    if (line.includes('infinite')) assert.ok(['listening', 'asleep'].includes(mood), `${mood} loops`)
  }
})

test('motion: when the computer asks for less motion, nothing moves and the card does not wait', () => {
  assert.match(style, /@media \(prefers-reduced-motion: reduce\) \{ \.buddy, \.buddy \* \{ animation: none !important; \} \}/)
  assert.ok(cardScript().includes("if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()"))
})

test('motion: a part with a still transform ends its animation on that transform', () => {
  const frames = keyframes()
  const still = {}
  for (const line of style.split('\n').filter((l) => l.includes('{ transform:') && l.includes('[data-mood='))) {
    const transform = line.slice(line.indexOf('{ transform: ') + 13, line.lastIndexOf(';'))
    for (const [, mood, part] of line.matchAll(/\[data-mood="([a-z-]+)"\] \.([a-z-]+)/g)) still[`${mood} ${part}`] = transform
  }
  let checked = 0
  for (const { mood, part, name } of animations()) {
    const pose = still[`${mood} ${part}`]
    if (!pose) continue
    const end = frames[name].filter(({ at, decls }) => /\b(to|100%)/.test(at) && decls.includes('transform:')).pop()
    if (end) assert.ok(end.decls.includes(`transform: ${pose};`), `${name} in ${mood} ends off ${pose}`)
    checked++
  }
  assert.ok(checked >= 2, `checked ${checked}`)
})

test("the done screen waits only for the key's trip into the vault, which is under 1.2 s", () => {
  assert.ok(STASH_MS > 0 && STASH_MS <= 1200, String(STASH_MS))
  assert.ok(style.includes(`.key { animation: b-key-in ${STASH_MS}ms `))
  const script = cardScript()
  assert.ok(script.includes(`const STASH_MS = ${STASH_MS}`))
  // A one-run Save hands an envelope over and nothing travels, so there is no trip to wait for (B-8).
  assert.ok(script.includes('if (ok && !blank && !handing) await settle(started)'))
})

test('with Remember unticked the penguin holds out an envelope and the vault stays shut: only a real save opens it (B-8, S-31)', () => {
  const shows = (part) => svg.match(new RegExp(`<g class="${part}" data-show="([^"]+)"`))[1].split(' ')
  const hides = (part) => svg.match(new RegExp(`<g class="${part}" data-hide="([^"]+)"`))[1].split(' ')
  assert.ok(shows('envelope').includes('handing'), 'the envelope is in hand')
  assert.ok(!hides('door').includes('handing'), 'the vault door stays shut')
  assert.ok(!shows('door-open').includes('handing'), 'the open vault is not shown')
  assert.ok(!shows('key').includes('handing'), 'no key is carried')
  // The same three parts are what a real save shows, and it still does.
  assert.ok(hides('door').includes('stashing') && shows('door-open').includes('stashing') && shows('key').includes('stashing'))
  assert.equal(MOODS.find((m) => m.id === 'handing').caption, 'Handing it over…')
  assert.equal(CAPTION_VARIANTS.oneRun.stashing, undefined, 'a one-run Save never shows the vault pose, so it needs no caption for it')
})

// The penguin has no name (decision R-4, 2026-11-06): "Pingu" is a toy character whose
// owner, a Mattel subsidiary, has a US trademark application pending, and "Pinguu" is
// one letter away. Neither may come back into the code.
test('the penguin is unnamed: no source file spells it, and the demo card does not either', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  const files = readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.mjs'))
  assert.ok(files.length > 10)
  for (const file of files) {
    assert.ok(!/pingu/i.test(readFileSync(join(src, file), 'utf8')), file)
  }
  const page = renderCard({
    fields: [{ name: 'API_KEY' }],
    storeLabel: 'nowhere (demo)',
    replacing: false,
    allowSessionOnly: false,
    demo: true,
    expiresAt: Date.now() + 60_000,
    nonce: 'n',
  })
  assert.ok(!/pingu/i.test(page))
  assert.ok(page.includes("<span>The penguin's poses:</span>"))
  assert.ok(page.includes(`aria-label="Preview the penguin's poses"`))
})
