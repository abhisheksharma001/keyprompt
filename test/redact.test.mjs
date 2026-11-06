import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRedactor } from '../src/redact.mjs'

/** Feed `text` to a redactor in the given chunk sizes and return the output. */
function redactInChunks(secrets, text, sizes) {
  const r = createRedactor(new Map(Object.entries(secrets)))
  const input = Buffer.from(text, 'utf8')
  const out = []
  let pos = 0
  let i = 0
  while (pos < input.length) {
    const size = sizes[i++ % sizes.length]
    out.push(r.push(input.subarray(pos, pos + size)))
    pos += size
  }
  out.push(r.flush())
  return Buffer.concat(out).toString('utf8')
}

test('replaces an exact value in one chunk', () => {
  assert.equal(redactInChunks({ API_KEY: 'sk-abc123' }, 'key=sk-abc123 done', [100]), 'key=[keyprompt:API_KEY] done')
})

test('catches a value split across chunks at every possible split point', () => {
  const secret = 'sk-live-0123456789'
  const text = `before ${secret} middle ${secret} after`
  for (let size = 1; size <= text.length; size++) {
    assert.equal(
      redactInChunks({ TOKEN: secret }, text, [size]),
      'before [keyprompt:TOKEN] middle [keyprompt:TOKEN] after',
      `chunk size ${size}`,
    )
  }
})

test('handles several secrets, preferring the longer one when one contains another', () => {
  const out = redactInChunks({ SHORT: 'abc', LONG: 'abcdef' }, 'x abcdef y abc z', [2, 3])
  assert.equal(out, 'x [keyprompt:LONG] y [keyprompt:SHORT] z')
})

test('passes text without secrets through unchanged, including multi-byte characters split across chunks', () => {
  const text = 'ключ — naïve café 🙂 done'
  assert.equal(redactInChunks({ K: 'not-present' }, text, [1, 2, 3]), text)
})

test('redacts a non-ASCII secret', () => {
  assert.equal(redactInChunks({ K: 'пароль🙂' }, 'value: пароль🙂!', [1]), 'value: [keyprompt:K]!')
})

test('holds back only bytes that could start a secret, so a trailing newline is not delayed', () => {
  const r = createRedactor(new Map([['K', 'sk-123456']]))
  assert.equal(r.push(Buffer.from('value: sk-123456\n')).toString(), 'value: [keyprompt:K]\n')
  assert.equal(r.push(Buffer.from('progress 50%\n')).toString(), 'progress 50%\n')
  assert.equal(r.push(Buffer.from('next: sk-1')).toString(), 'next: ')
  assert.equal(r.push(Buffer.from('23456 ok')).toString(), '[keyprompt:K] ok')
  assert.equal(r.push(Buffer.from('ends with s')).toString(), 'ends with ')
  assert.equal(r.flush().toString(), 's')
})

test('when one secret is a prefix of another, waits and lets the longer one win', () => {
  const r = createRedactor(new Map([['SHORT', 'ab'], ['LONG', 'abc']]))
  assert.equal(r.push(Buffer.from('x ab')).toString(), 'x ')
  assert.equal(r.push(Buffer.from('c y')).toString(), '[keyprompt:LONG] y')
  assert.equal(r.push(Buffer.from(' ab')).toString(), ' ')
  assert.equal(r.flush().toString(), '[keyprompt:SHORT]')
})

// A value whose encoded forms all differ: its base64 has "+" and padding, "!" splits the two URL forms, and JSON escapes '"' and the line break (S-18).
const VALUE = 'k3y/Of~!x"y\nz>>?'
const BYTES = Buffer.from(VALUE, 'utf8')
const ENCODED = {
  'base64': BYTES.toString('base64'),
  'base64 without padding': BYTES.toString('base64').replace(/=+$/, ''),
  'base64url': BYTES.toString('base64url'),
  'base64url with padding': BYTES.toString('base64').replaceAll('+', '-').replaceAll('/', '_'),
  'hex': BYTES.toString('hex'),
  'encodeURIComponent': encodeURIComponent(VALUE),
  'RFC 3986 URL-encoding': encodeURIComponent(VALUE).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
  'JSON-escaped': JSON.stringify(VALUE).slice(1, -1),
}

test('masks each encoded form of a value of 8 or more characters (S-18)', () => {
  assert.equal(new Set([VALUE, ...Object.values(ENCODED)]).size, 9, 'the sample value must give nine different texts')
  for (const [form, text] of Object.entries(ENCODED)) {
    assert.equal(redactInChunks({ TOKEN: VALUE }, `a ${text} b`, [100]), 'a [keyprompt:TOKEN] b', form)
  }
})

test('catches an encoded form split across chunks at every possible split point (S-18)', () => {
  const text = `x ${ENCODED.base64} y ${ENCODED.hex} z`
  for (let size = 1; size <= text.length; size++) {
    assert.equal(redactInChunks({ TOKEN: VALUE }, text, [size]), 'x [keyprompt:TOKEN] y [keyprompt:TOKEN] z', `chunk size ${size}`)
  }
})

test('a value under 8 characters is masked only as an exact copy; characters, not bytes, are counted (S-18)', () => {
  const encoded = (value) => `${value} ${Buffer.from(value).toString('base64')} ${Buffer.from(value).toString('hex')}`
  // 7 characters: only the exact copy goes.
  assert.equal(redactInChunks({ K: 'sk-1234' }, encoded('sk-1234'), [100]), '[keyprompt:K] c2stMTIzNA== 736b2d31323334')
  // 7 characters even though the emoji is 4 bytes and 2 UTF-16 units.
  const seven = 'abcdef🙂'
  assert.equal(redactInChunks({ K: seven }, encoded(seven), [100]), `[keyprompt:K] ${encoded(seven).split(' ').slice(1).join(' ')}`)
  // 8 characters, 14 bytes: every form goes.
  assert.equal(redactInChunks({ K: 'пароль12' }, encoded('пароль12'), [100]), '[keyprompt:K] [keyprompt:K] [keyprompt:K]')
})

test('with no secrets it is a pass-through', () => {
  const r = createRedactor(new Map())
  assert.equal(r.push(Buffer.from('hello')).toString(), 'hello')
  assert.equal(r.flush().length, 0)
})
