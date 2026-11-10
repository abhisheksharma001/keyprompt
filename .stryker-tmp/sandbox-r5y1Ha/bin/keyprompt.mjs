#!/usr/bin/env node
// @ts-nocheck
import { main } from '../src/cli.mjs'
import { EXIT, KeypromptError } from '../src/errors.mjs'

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error) => {
    if (error instanceof KeypromptError) {
      process.stderr.write(`keyprompt: ${error.message}\n`)
      process.exitCode = error.exitCode
    } else {
      process.stderr.write(`keyprompt: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = EXIT.ERROR
    }
  },
)
