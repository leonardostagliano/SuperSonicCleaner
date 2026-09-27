// Evaluate one expression in the dev renderer and print its JSON value.
import { connect } from './cdp.mjs'

const expression = process.argv.slice(2).join(' ')
if (!expression) {
  console.error('usage: node scripts/ui-audit/cdp-eval.mjs "<expression>"')
  process.exit(2)
}
const s = await connect()
try {
  console.log(JSON.stringify(await s.evaluate(expression)))
} finally {
  s.close()
}
process.exit(0)
