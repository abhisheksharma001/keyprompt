import { KeypromptError } from '../errors.mjs'
import { runHelper } from '../exec.mjs'

const SERVICE = 'keyprompt'
const SECURITY = '/usr/bin/security'
/** `security` exit status for "The specified item could not be found in the keychain." */
const NOT_FOUND = 44
/**
 * The longest command `security -i` reads as one line, without its line
 * break. It reads stdin into a 4,096-byte buffer and stops after 4,095 bytes;
 * the rest of a longer line is run as the next command (Apple Security
 * source, SecurityTool/macOS/security.c MAX_LINE_LEN and readline.c, read
 * 2026-11-05; seen on macOS 27.0). At exactly 4,095 the line break would be
 * left for the next read, so stay one byte under.
 */
const MAX_COMMAND_BYTES = 4094

/**
 * Quote a value for `security -i`, which reads one command per line from stdin
 * and accepts "..." with \" and \\ escapes. Verified byte-exact for spaces,
 * quotes, backslashes, $, ;, &, | and non-ASCII text.
 * @param {string} value
 */
function quote(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * The line `security -i` runs to save NAME, line break included. A value with
 * a line break goes as hex (`-X`): `security -i` ends a command at a line
 * break and has no escape for one. Any other value keeps the quoted form
 * (`-w`), which fits twice as much. A command longer than one line is refused
 * before anything runs, so no part of a value can run as a command of its own.
 * @param {string} name
 * @param {string} value
 */
export function addCommand(name, value) {
  // Environment variables are C strings, so `run` could never pass a NUL on.
  if (value.includes('\0')) {
    throw new KeypromptError(`${name} contains a NUL character, which an environment variable cannot hold.`)
  }
  const head = `add-generic-password -U -s ${SERVICE} -a ${name} -l ${quote(`keyprompt: ${name}`)}`
  const lines = /[\r\n]/.test(value)
  const data = lines ? `-X ${Buffer.from(value, 'utf8').toString('hex')}` : `-w ${quote(value)}`
  const command = `${head} ${data}`
  if (Buffer.byteLength(command, 'utf8') > MAX_COMMAND_BYTES) {
    // In value bytes: hex takes two per byte; quotes and escapes count for one-line values.
    const fixed = Buffer.byteLength(head, 'utf8') + 4 // ' -X ' or ' -w '
    const room = lines ? Math.floor((MAX_COMMAND_BYTES - fixed) / 2) : MAX_COMMAND_BYTES - fixed - 2
    const size = lines ? Buffer.byteLength(value, 'utf8') : Buffer.byteLength(quote(value), 'utf8') - 2
    throw new KeypromptError(
      `${name} needs ${size} bytes; the macOS Keychain backend takes at most ${room}${lines ? ' for a value with line breaks' : ''}.`,
    )
  }
  return `${command}\n`
}

/**
 * Parse the `password:` line `security find-generic-password -g` writes to
 * stderr. Plain printable text comes as `password: "..."` (no escaping
 * inside); anything else (non-ASCII, tabs, backslashes) as
 * `password: 0x<HEX>  "..."`. The hex form is exact bytes. `-w` is not used
 * because it prints hex WITHOUT a marker, which a real hex-looking key
 * ("deadbeef") would be indistinguishable from.
 * @param {string} stderr
 * @returns {string}
 */
export function parsePasswordLine(stderr) {
  const line = stderr.split('\n').find((l) => l.startsWith('password:'))
  if (line === undefined) throw new KeypromptError('The Keychain answered in an unexpected format.')
  const rest = line.slice('password:'.length).trim()
  if (rest.length === 0) return ''
  const hex = /^0x([0-9A-Fa-f]*)\s/.exec(rest + ' ')
  if (hex) return Buffer.from(hex[1], 'hex').toString('utf8')
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) return rest.slice(1, -1)
  throw new KeypromptError('The Keychain answered in an unexpected format.')
}

/** @type {import('./index.mjs').SecretStore} */
export const macosStore = {
  id: 'macos-keychain',
  label: 'macOS Keychain',
  // No longer value fits on one `security -i` line, even with a one-letter
  // name; `addCommand` checks the exact limit for each name and value.
  maxValueLength: 4029,

  async read(name) {
    const { code, stderr } = await runHelper(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', name, '-g'])
    if (code === NOT_FOUND) return null
    if (code !== 0) throw new KeypromptError(`Could not read ${name} from the macOS Keychain (security exited ${code}).`)
    return parsePasswordLine(stderr.toString('utf8'))
  },

  async write(name, value) {
    const { code } = await runHelper(SECURITY, ['-i'], { input: addCommand(name, value) })
    if (code !== 0) throw new KeypromptError(`Could not save ${name} to the macOS Keychain (security exited ${code}).`)
    // `security -i` reports a failed command in its output but can still exit 0,
    // so confirm the item really holds the new value.
    const stored = await macosStore.read(name)
    if (stored !== value) throw new KeypromptError(`Could not save ${name} to the macOS Keychain.`)
  },

  async remove(name) {
    const { code } = await runHelper(SECURITY, ['delete-generic-password', '-s', SERVICE, '-a', name])
    if (code === NOT_FOUND) return false
    if (code !== 0) throw new KeypromptError(`Could not delete ${name} from the macOS Keychain (security exited ${code}).`)
    return true
  },
}
