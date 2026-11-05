/**
 * Streaming redactor: replaces every exact occurrence of a secret's bytes with
 * `[keyprompt:NAME]`, including an occurrence split across chunks. Works on
 * raw bytes, so multi-byte characters split across chunks pass through intact.
 *
 * Only bytes that could still be the start of a secret are held back, so
 * ordinary output (a trailing newline, a progress line) is never delayed.
 * Where one secret is a prefix of another, the longer one wins.
 *
 * Exact matches only: a secret the child transforms (base64, URL-encoding,
 * printing part of it) is not caught. See SECURITY.md.
 *
 * @param {Map<string, string>} secrets name -> value
 */
export function createRedactor(secrets) {
  const patterns = [...secrets]
    .filter(([, value]) => value.length > 0)
    .map(([name, value]) => ({ needle: Buffer.from(value, 'utf8'), label: Buffer.from(`[keyprompt:${name}]`, 'utf8') }))
    .sort((a, b) => b.needle.length - a.needle.length)
  let carry = Buffer.alloc(0)

  /**
   * At `p`: the longest secret that matches fully, and whether a longer one
   * is still possible because `buf` ends before it would.
   * @param {Buffer} buf
   * @param {number} p
   * @param {boolean} final no more bytes will come
   */
  function at(buf, p, final) {
    const rem = buf.length - p
    for (const pattern of patterns) {
      const { needle } = pattern
      if (needle[0] !== buf[p]) continue
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
