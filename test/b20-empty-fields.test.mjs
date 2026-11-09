import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    for (const list of [[' '], [',', '  '], [', ,']]) {
      for (const [tool, key] of [['request_secret', 'fields'], ['check_secrets', 'names']]) {
        const { result, isError } = await tools[tool]({ [key]: list }, {})
        assert.equal(isError, true, `${tool} ${JSON.stringify(list)}`)
        assert.equal(result.status, 'invalid_usage', JSON.stringify(result))
        assert.equal(result.exitCode, 2)
        assert.deepEqual(result.names, [])
        // It names the argument, and repeats nothing that was sent.
        assert.equal(result.message, `${key} must name at least one secret, for example ["OPENAI_API_KEY"].`)
      }
    }
    assert.equal(existsSync(join(home, 'activity.jsonl')), false, 'no card, so no log line')
  } finally {
    rmSync(home, { recursive: true, force: true })
    for (const [key, value] of [['KEYPROMPT_HOME', before.home], ['KEYPROMPT_BROWSER', before.browser]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
