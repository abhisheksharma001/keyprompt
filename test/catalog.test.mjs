import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readCatalog, recordSavedMany } from '../src/catalog.mjs'

test('records several names in one go and keeps an earlier reason when none is given', async () => {
  process.env.KEYPROMPT_HOME = mkdtempSync(join(tmpdir(), 'keyprompt-catalog-'))
  await recordSavedMany(['A', 'B'], { reason: 'send a test SMS', store: 'fake' })
  await recordSavedMany(['B', 'C'], { store: 'fake' })
  const catalog = await readCatalog()
  assert.deepEqual(Object.keys(catalog).sort(), ['A', 'B', 'C'])
  assert.equal(catalog.A.reason, 'send a test SMS')
  assert.equal(catalog.B.reason, 'send a test SMS')
  assert.equal(catalog.C.reason, undefined)
  assert.equal(catalog.B.updatedAt, catalog.C.updatedAt)
})
