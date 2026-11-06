/** Values shorter than this many characters are masked only as exact copies: their encoded forms are short enough to turn up in ordinary output by chance. */
export const MIN_ENCODED_LENGTH = 8

/** Bytes that RFC 3986 leaves as they are when URL-encoding; `encodeURIComponent` also leaves `!*'()`. */
const RFC3986_KEEP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
const URI_COMPONENT_KEEP = `${RFC3986_KEEP}!*'()`

/**
 * URL-encode bytes: keep the characters in `keep`, write every other byte as `%XX` (uppercase).
 * @param {Buffer} bytes
 * @param {string} keep
 */
function percentEncode(bytes, keep) {
  let out = ''
  for (const byte of bytes) {
    const char = String.fromCharCode(byte)
    out += byte < 0x80 && keep.includes(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return out
}

/**
 * Every text that counts as a copy of `value`: the value itself and, when it
 * has at least MIN_ENCODED_LENGTH characters, its base64 (with and without
 * padding), base64url (with and without padding), lowercase hex, URL-encoded
 * (RFC 3986 and `encodeURIComponent`) and JSON-escaped forms. SECURITY.md
 * lists the same forms; keep the two in step.
 * @param {string} value
 * @returns {string[]}
 */
export function copiesOf(value) {
  if ([...value].length < MIN_ENCODED_LENGTH) return [value]
  const bytes = Buffer.from(value, 'utf8')
  const base64 = bytes.toString('base64')
  const base64url = bytes.toString('base64url')
  return [...new Set([
    value,
    base64,
    base64.replace(/=+$/, ''),
    base64url,
    base64url.padEnd(base64.length, '='),
    bytes.toString('hex'),
    percentEncode(bytes, RFC3986_KEEP),
    percentEncode(bytes, URI_COMPONENT_KEEP),
    JSON.stringify(value).slice(1, -1),
  ])]
}

/**
 * Streaming redactor: replaces every occurrence of a secret's bytes, or of one
 * of its encoded forms (`copiesOf`), with `[keyprompt:NAME]`, including an
 * occurrence split across chunks. Works on raw bytes, so multi-byte characters
 * split across chunks pass through intact.
 *
 * Only bytes that could still be the start of a copy are held back, so
 * ordinary output (a trailing newline, a progress line) is never delayed.
 * Where one copy is a prefix of another, the longer one wins.
 *
 * Any other transformation (another encoding, part of the value, a hash) is
 * not caught. See SECURITY.md.
 *
 * @param {Map<string, string>} secrets name -> value
 */
export function createRedactor(secrets) {
  const patterns = [...secrets]
    .filter(([, value]) => value.length > 0)
    .flatMap(([name, value]) => {
      const label = Buffer.from(`[keyprompt:${name}]`, 'utf8')
      return copiesOf(value).map((copy) => ({ needle: Buffer.from(copy, 'utf8'), label }))
    })
    .sort((a, b) => b.needle.length - a.needle.length)
  // Patterns by first byte, longest first, so each position checks only the ones that can start there.
  /** @type {typeof patterns[]} */
  const byFirstByte = Array.from({ length: 256 }, () => [])
  for (const pattern of patterns) byFirstByte[pattern.needle[0]].push(pattern)
  let carry = Buffer.alloc(0)

  /**
   * At `p`: the longest copy that matches fully, and whether a longer one
   * is still possible because `buf` ends before it would.
   * @param {Buffer} buf
   * @param {number} p
   * @param {boolean} final no more bytes will come
   */
  function at(buf, p, final) {
    const rem = buf.length - p
    for (const pattern of byFirstByte[buf[p]]) {
      const { needle } = pattern
      // Cheap reject before the full comparison: most near misses differ at the second byte.
      if (rem > 1 && needle.length > 1 && needle[1] !== buf[p + 1]) continue
      if (rem >= needle.length) {
        if (buf.compare(needle, 0, needle.length, p, p + needle.length) === 0) return { match: pattern, pending: false }
      } else if (!final && buf.compare(needle, 0, rem, p, buf.length) === 0) {
        // Longest-first order: this longer secret may still complete, so wait
        // even if a shorter one matches here.
        return { match: null, pending: true }
      }
    }
    return { match: null, pending: false }
  }

  /**
   * @param {Buffer} buf
   * @param {boolean} final
   */
  function scan(buf, final) {
    const out = []
    let run = 0
    let p = 0
    while (p < buf.length) {
      const { match, pending } = at(buf, p, final)
      if (pending) break
      if (match) {
        out.push(buf.subarray(run, p), match.label)
        p += match.needle.length
        run = p
      } else {
        p++
      }
    }
    out.push(buf.subarray(run, p))
    carry = Buffer.from(buf.subarray(p))
    return Buffer.concat(out)
  }

  return {
    /** @param {Buffer} chunk */
    push(chunk) {
      if (patterns.length === 0) return chunk
      return scan(carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk, false)
    },
    flush() {
      if (patterns.length === 0) return Buffer.alloc(0)
      return scan(carry, true)
    },
  }
}
