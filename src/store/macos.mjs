import { KeypromptError } from '../errors.mjs'
import { runHelper } from '../exec.mjs'

const SERVICE = 'keyprompt'
const SECURITY = '/usr/bin/security'
/** `security` exit status for "The specified item could not be found in the keychain." */
const NOT_FOUND = 44

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
  maxValueLength: 64 * 1024,

  async read(name) {
    const { code, stderr } = await runHelper(SECURITY, ['find-generic-password', '-s', SERVICE, '-a', name, '-g'])
    if (code === NOT_FOUND) return null
    if (code !== 0) throw new KeypromptError(`Could not read ${name} from the macOS Keychain (security exited ${code}).`)
    return parsePasswordLine(stderr.toString('utf8'))
  },

  async write(name, value) {
    // `security -i` runs one command per line: a line break inside the value
    // would end this command and run the rest as another `security` command.
    if (/[\r\n\0]/.test(value)) {
      throw new KeypromptError(`${name} contains a line break, which the macOS Keychain backend does not accept. Paste the key on one line.`)
    }
    const command = `add-generic-password -U -s ${SERVICE} -a ${name} -l ${quote(`keyprompt: ${name}`)} -w ${quote(value)}\n`
    const { code } = await runHelper(SECURITY, ['-i'], { input: command })
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
