import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { BUDDY_NAME, buddyStyle, buddySvg, CAPTION_VARIANTS, MOODS } from '../src/buddy.mjs'

const svg = buddySvg()
const style = buddyStyle()

test('MOODS is the buddy table in the PRD, caption for caption', () => {
  const prd = readFileSync(new URL('../docs/prd/card-v2.md', import.meta.url), 'utf8')
  const section = prd.slice(prd.indexOf('### The buddy'), prd.indexOf('### The receipt'))
  const rows = [...section.matchAll(/^\| [^|]+ \| `([a-z-]+)` \| [^|]+ \| (.+) \|$/gm)].map(([, id, cell]) => ({
    id,
    caption: cell.startsWith('"') ? cell.slice(1, -1) : null,
  }))
  assert.equal(rows.length, 11)
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

test("only src/buddy.mjs spells the buddy's name", () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  const files = readdirSync(src, { recursive: true }).filter((f) => f.endsWith('.mjs'))
  assert.ok(files.length > 10)
  for (const file of files) {
    if (file === 'buddy.mjs') continue
    assert.ok(!readFileSync(join(src, file), 'utf8').includes(BUDDY_NAME), file)
  }
})
