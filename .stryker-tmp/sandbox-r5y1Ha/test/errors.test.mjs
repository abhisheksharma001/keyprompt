// @ts-nocheck
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXIT, KeypromptError, helperError } from '../src/errors.mjs'

test('a KeypromptError says the same in JSON unless it is given a JSON message (B-19)', () => {
  const plain = new KeypromptError('Usage: keyprompt has NAME', { exitCode: EXIT.USAGE })
  assert.equal(plain.jsonMessage, plain.message)
  const typed = new KeypromptError('Unknown option --x. See keyprompt --help.', { jsonMessage: 'Unknown option. See keyprompt --help.' })
  assert.equal(typed.message, 'Unknown option --x. See keyprompt --help.')
  assert.equal(typed.jsonMessage, 'Unknown option. See keyprompt --help.')
})

test("a store helper's error: text mode adds its first line, the JSON message leaves it out (B-19)", () => {
  const loud = helperError('Could not read A from the Linux keyring', Buffer.from('  helper said this\nand more\n'))
  assert.equal(loud.message, 'Could not read A from the Linux keyring: helper said this')
  assert.equal(loud.jsonMessage, 'Could not read A from the Linux keyring.')
  assert.equal(loud.exitCode, EXIT.ERROR)
  const quiet = helperError('Could not save A to Windows Credential Manager', Buffer.alloc(0))
  assert.equal(quiet.message, 'Could not save A to Windows Credential Manager')
  assert.equal(quiet.jsonMessage, 'Could not save A to Windows Credential Manager.')
})
