import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Names, reasons and dates of saved secrets: never values. Lets `list` work
 * the same on every OS (the OS stores have no portable "list" call), and lets
 * an agent see which keys exist without seeing any of them.
 *
 * @typedef {{ reason?: string, store: string, updatedAt: string }} CatalogEntry
 */

export function catalogDir() {
  return process.env.KEYPROMPT_HOME || join(homedir(), '.keyprompt')
}

export function catalogPath() {
  return join(catalogDir(), 'catalog.json')
}

/** @returns {Promise<Record<string, CatalogEntry>>} */
export async function readCatalog() {
  try {
    const parsed = JSON.parse(await readFile(catalogPath(), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return {}
    throw error
  }
}

/** @param {Record<string, CatalogEntry>} catalog */
async function writeCatalog(catalog) {
  await mkdir(catalogDir(), { recursive: true, mode: 0o700 })
  const tmp = `${catalogPath()}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, catalogPath())
}

/**
 * Record names that were just saved, in one catalog write. A name saved
 * without a reason keeps the reason it had.
 * @param {string[]} names
 * @param {{ reason?: string, store: string }} entry
 */
export async function recordSavedMany(names, entry) {
  const catalog = await readCatalog()
  const updatedAt = new Date().toISOString()
  for (const name of names) {
    catalog[name] = {
      ...(entry.reason ? { reason: entry.reason } : catalog[name]?.reason ? { reason: catalog[name].reason } : {}),
      store: entry.store,
      updatedAt,
    }
  }
  await writeCatalog(catalog)
}

/** @param {string} name */
export async function recordRemoved(name) {
  const catalog = await readCatalog()
  if (!(name in catalog)) return
  delete catalog[name]
  await writeCatalog(catalog)
}
