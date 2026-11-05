import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KeypromptError } from '../src/errors.mjs'
import { joinNames, saveAll } from '../src/save.mjs'

/**
 * An in-memory store. `fail(op, name, value)` returning true makes that call
 * throw; `changeThenFail` makes a write change the item first, then throw
 * (the way a macOS write can fail its read-back check).
 */
function fakeStore(initial = {}, { fail = () => false, changeThenFail = false } = {}) {
  const items = new Map(Object.entries(initial))
  const calls = []
  return {
    items,
    calls,
    id: 'fake',
    label: 'test store',
    maxValueLength: 20,
    async read(name) {
      calls.push(`read ${name}`)
      if (fail('read', name)) throw new KeypromptError(`Could not read ${name} from the test store.`)
      return items.has(name) ? items.get(name) : null
    },
    async write(name, value) {
      calls.push(`write ${name}`)
      if (fail('write', name, value)) {
        if (changeThenFail) items.set(name, value)
        throw new KeypromptError(`Could not save ${name} to the test store.`)
      }
      items.set(name, value)
    },
    async remove(name) {
      calls.push(`remove ${name}`)
      if (fail('remove', name)) throw new KeypromptError(`Could not delete ${name} from the test store.`)
      return items.delete(name)
    },
  }
}

const values = (entries) => new Map(Object.entries(entries))

test('joins names the way a sentence does', () => {
  assert.equal(joinNames(['A']), 'A')
  assert.equal(joinNames(['A', 'B']), 'A and B')
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C')
})

test('saves every value, new and replaced', async () => {
  const store = fakeStore({ A: 'old-a' })
  await saveAll(store, values({ A: 'a', B: 'b' }))
  assert.deepEqual(Object.fromEntries(store.items), { A: 'a', B: 'b' })
})

test('the 2nd of 3 writes fails and the 1st was new: the 1st is removed, the 3rd never written', async () => {
  const store = fakeStore({}, { fail: (op, name) => op === 'write' && name === 'B' })
  await assert.rejects(saveAll(store, values({ A: 'a', B: 'b', C: 'c' })), {
    message: 'Could not save B: Could not save B to the test store. Nothing was changed.',
  })
  assert.deepEqual(Object.fromEntries(store.items), {})
  assert.ok(!store.calls.includes('write C'))
})

test('the 2nd of 3 writes fails and the 1st existed: the old value is written back', async () => {
  const store = fakeStore({ A: 'old-a' }, { fail: (op, name) => op === 'write' && name === 'B' })
  await assert.rejects(saveAll(store, values({ A: 'a', B: 'b', C: 'c' })), /Nothing was changed\.$/)
  assert.deepEqual(Object.fromEntries(store.items), { A: 'old-a' })
})

test('a write that changed its item before failing is put back too', async () => {
  const store = fakeStore(
    { A: 'old-a', B: 'old-b' },
    { fail: (op, name, value) => op === 'write' && name === 'B' && value === 'b', changeThenFail: true },
  )
  await assert.rejects(saveAll(store, values({ A: 'a', B: 'b' })), /Nothing was changed\.$/)
  assert.deepEqual(Object.fromEntries(store.items), { A: 'old-a', B: 'old-b' })
})

test('a read that fails puts back the names already written', async () => {
  const store = fakeStore({}, { fail: (op, name) => op === 'read' && name === 'B' })
  await assert.rejects(saveAll(store, values({ A: 'a', B: 'b' })), {
    message: 'Could not save B: Could not read B from the test store. Nothing was changed.',
  })
  assert.deepEqual(Object.fromEntries(store.items), {})
})

test('when undoing fails too, the message names the failed name and every name that may be mixed', async () => {
  const store = fakeStore({}, { fail: (op, name) => (op === 'write' && name === 'B') || (op === 'remove' && name === 'A') })
  await assert.rejects(saveAll(store, values({ A: 'a', B: 'b' })), {
    message:
      'Could not save B: Could not save B to the test store. Undoing also failed for A, so it may not hold what it held before. To fix it, run: keyprompt set A',
  })
})

test('a value too long for the store is refused before anything is written', async () => {
  const store = fakeStore()
  await assert.rejects(saveAll(store, values({ A: 'a', B: 'x'.repeat(21) })), {
    message: 'B is 21 characters; the test store holds at most 20. Nothing was changed.',
  })
  assert.deepEqual(store.calls, [])
})

test('an unexpected error is not repeated on the card', async () => {
  const store = fakeStore()
  store.write = async () => {
    throw new Error('spawn helper with unchecked text')
  }
  await assert.rejects(saveAll(store, values({ A: 'a' })), {
    message: 'Could not save A: an unexpected error. Nothing was changed.',
  })
})
