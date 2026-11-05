import { KeypromptError } from '../errors.mjs'
import { linuxStore } from './linux.mjs'
import { macosStore } from './macos.mjs'
import { windowsStore } from './windows.mjs'

/**
 * @typedef {object} SecretStore
 * @property {string} id
 * @property {string} label Shown to people: "macOS Keychain".
 * @property {number} maxValueLength
 * @property {(name: string) => Promise<string | null>} read Null when absent. Only `run` and tests call this; nothing prints the result.
 * @property {(name: string, value: string) => Promise<void>} write Creates or replaces.
 * @property {(name: string) => Promise<boolean>} remove False when absent.
 */

/**
 * The OS password store for this machine. No fallback to a file: a platform
 * without a supported store gets an error, never a weaker store.
 * @param {NodeJS.Platform} [platform]
 * @returns {SecretStore}
 */
export function getStore(platform = process.platform) {
  if (platform === 'darwin') return macosStore
  if (platform === 'win32') return windowsStore
  if (platform === 'linux') return linuxStore
  throw new KeypromptError(`keyprompt does not support ${platform} yet (macOS, Windows and Linux are supported).`)
}
