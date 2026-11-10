// @ts-nocheck
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectSecrets } from '../src/collect.mjs'

/** An in-memory store that remembers every call made to it. */
function fakeStore(initial = {}) {
  const items = new Map(Object.entries(initial))
  const calls = []
  return {
    calls,
    id: 'fake',
    label: 'test store',
    maxValueLength: 100,
    async read(name) {
      calls.push(`read ${name}`)
      return items.has(name) ? items.get(name) : null
    },
    async write(name) {
      calls.push(`write ${name}`)
    },
    async remove(name) {
      calls.push(`remove ${name}`)
      return false
    },
  }
}

/** A fake card: counts how often it is opened and answers with the given values. */
function fakeAsk(answer = {}) {
  const requests = []
  const ask = async (request) => {
    requests.push(request)
    return { remembered: true, values: new Map(Object.entries(answer)) }
  }
  return { ask, requests }
}

test('run A,B,C with B and C missing asks once for B and C, and returns A, B and C', async () => {
  const store = fakeStore({ A: 'a-saved' })
  const { ask, requests } = fakeAsk({ B: 'b-new', C: 'c-new' })
  const secrets = await collectSecrets(store, [{ name: 'A' }, { name: 'B' }, { name: 'C' }], ask)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].fields.map((f) => f.name), ['B', 'C'])
  assert.equal(requests[0].allowSessionOnly, true)
  assert.deepEqual([...secrets], [['A', 'a-saved'], ['B', 'b-new'], ['C', 'c-new']])
})

test('nothing is asked when every name is saved, and hints on saved names change nothing', async () => {
  const store = fakeStore({ A: 'a', B: 'b' })
  const { ask, requests } = fakeAsk()
  const secrets = await collectSecrets(store, [{ name: 'A', multiline: true }, { name: 'B', visible: true, optional: true }], ask)
  assert.equal(requests.length, 0)
  assert.deepEqual([...secrets], [['A', 'a'], ['B', 'b']])
})

test('the hints of a missing name reach the card', async () => {
  const store = fakeStore()
  const { ask, requests } = fakeAsk({ A: 'id', B: 'key' })
  await collectSecrets(store, [{ name: 'A', visible: true }, { name: 'B', multiline: true, optional: true }], ask)
  assert.deepEqual(requests[0].fields, [{ name: 'A', visible: true }, { name: 'B', multiline: true, optional: true }])
})

test('an optional name left empty is simply absent from the result', async () => {
  const store = fakeStore({ A: 'a' })
  const { ask } = fakeAsk({ B: 'b' })
  const secrets = await collectSecrets(
    store,
    [{ name: 'A' }, { name: 'B' }, { name: 'C', optional: true }],
    ask,
  )
  assert.deepEqual([...secrets.keys()], ['A', 'B'])
  assert.equal(secrets.has('C'), false)
})

test('the result follows the order the names were given, not saved-first', async () => {
  const store = fakeStore({ B: 'b' })
  const { ask } = fakeAsk({ A: 'a', C: 'c' })
  const secrets = await collectSecrets(store, [{ name: 'A' }, { name: 'B' }, { name: 'C' }], ask)
  assert.deepEqual([...secrets.keys()], ['A', 'B', 'C'])
})

test('collecting never writes or removes anything: saving is the card submit\'s job', async () => {
  const store = fakeStore({ A: 'a' })
  const { ask } = fakeAsk({ B: 'b' })
  await collectSecrets(store, [{ name: 'A' }, { name: 'B' }], ask)
  assert.deepEqual(store.calls, ['read A', 'read B'])
})

test('a card that fails (cancelled, timed out) fails the collection and nothing is returned', async () => {
  const store = fakeStore()
  const ask = async () => {
    throw new Error('cancelled')
  }
  await assert.rejects(collectSecrets(store, [{ name: 'A' }], ask), /cancelled/)
})
