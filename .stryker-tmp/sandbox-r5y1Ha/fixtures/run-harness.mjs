// @ts-nocheck
// Calls runWithSecrets the way the CLI does, so tests can capture its output.
// argv: <secretsJson> <command> [args...]
import { runWithSecrets } from '../src/run.mjs'

const [secretsJson, command, ...args] = process.argv.slice(2)
const secrets = new Map(Object.entries(JSON.parse(secretsJson)))
runWithSecrets(command, args, secrets).then((code) => {
  process.exitCode = code
})
