import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mcpTools } from '../src/cli.mjs'

// B-20: a list that parses to no name must be refused before any card opens.
// If a card did open, this browser stand-in presses Cancel, so the test ends fast.
test('B-20: request_secret and check_secrets refuse a list that names nothing, before any card or log line', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keyprompt-b20-'))
  const browser = join(home, 'cancel.mjs')
  writeFileSync(browser, `#!${process.execPath}
import { request } from 'node:http'
const url = new URL(process.argv[2])
request({ hostname: url.hostname, port: url.port, path: url.pathname + '/cancel', method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' } }, res => res.resume()).end('{}')
`)
  chmodSync(browser, 0o755)
  const before = { home: process.env.KEYPROMPT_HOME, browser: process.env.KEYPROMPT_BROWSER }
  process.env.KEYPROMPT_HOME = home
  process.env.KEYPROMPT_BROWSER = browser
  try {
    const tools = mcpTools()
    for (const fields of [[' '], [',', '  '], [', ,']]) {
      const { result, isError } = await tools.request_secret({ fields }, {})
      assert.equal(isError, true, JSON.stringify(fields))
      assert.equal(result.status, 'invalid_usage', JSON.stringify(result))
      assert.equal(result.exitCode, 2)
      assert.deepEqual(result.names, [])
    }
    const checked = await tools.check_secrets({ names: [','] })
    assert.equal(checked.isError, true)
    assert.equal(checked.result.status, 'invalid_usage', JSON.stringify(checked.result))
    assert.equal(existsSync(join(home, 'activity.jsonl')), false, 'no card, so no log line')
  } finally {
    for (const [key, value] of [['KEYPROMPT_HOME', before.home], ['KEYPROMPT_BROWSER', before.browser]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
