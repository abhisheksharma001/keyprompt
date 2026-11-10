// @ts-nocheck
import { KeypromptError, helperError } from '../errors.mjs'
import { runHelper } from '../exec.mjs'

/**
 * The Secret Service (GNOME Keyring, KWallet) through libsecret's
 * `secret-tool`, which reads the secret to store from stdin and prints a
 * looked-up secret to stdout. Install: `sudo apt install libsecret-tools`
 * (Debian/Ubuntu) or `sudo dnf install libsecret` (Fedora).
 */
const ATTRS = (/** @type {string} */ name) => ['service', 'keyprompt', 'account', name]

/** @param {NodeJS.ErrnoException} error */
function missingTool(error) {
  if (error.code === 'ENOENT') {
    return new KeypromptError(
      'keyprompt needs `secret-tool` on Linux. Install it with `sudo apt install libsecret-tools` (Debian/Ubuntu) or `sudo dnf install libsecret` (Fedora), and run a desktop keyring such as GNOME Keyring or KWallet.',
    )
  }
  return error
}

/** @type {import('./index.mjs').SecretStore} */
export const linuxStore = {
  id: 'linux-secret-service',
  label: 'Linux keyring (Secret Service)',
  maxValueLength: 64 * 1024,

  async read(name) {
    const result = await runHelper('secret-tool', ['lookup', ...ATTRS(name)]).catch((e) => {
      throw missingTool(e)
    })
    // secret-tool exits 1 with no output when nothing matches.
    if (result.code === 1 && result.stdout.length === 0 && result.stderr.length === 0) return null
    if (result.code !== 0) throw helperError(`Could not read ${name} from the Linux keyring`, result.stderr)
    return result.stdout.toString('utf8')
  },

  async write(name, value) {
    const result = await runHelper('secret-tool', ['store', '--label', `keyprompt: ${name}`, ...ATTRS(name)], {
      input: value,
    }).catch((e) => {
      throw missingTool(e)
    })
    if (result.code !== 0) throw helperError(`Could not save ${name} to the Linux keyring`, result.stderr)
  },

  async remove(name) {
    if ((await linuxStore.read(name)) === null) return false
    const result = await runHelper('secret-tool', ['clear', ...ATTRS(name)]).catch((e) => {
      throw missingTool(e)
    })
    if (result.code !== 0) throw helperError(`Could not delete ${name} from the Linux keyring`, result.stderr)
    return true
  },
}
