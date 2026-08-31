/**
 * Re-run the Critic procedure on Version A / Version B without an LLM.
 * Usage: npx tsx scripts/critic-claims-harness.ts
 */
import {
  VERSION_A_CLAIMS_TABLE,
  VERSION_B_CLAIMS_TABLE,
  runWave0ClaimsHarness,
} from "../src/lib/critic/claims-table"

const { a, b } = runWave0ClaimsHarness()

console.log("VERSION A claims table:")
console.log(VERSION_A_CLAIMS_TABLE)
console.log(`verdict=${a.verdict}`)
console.log("")
console.log("VERSION B claims table:")
console.log(VERSION_B_CLAIMS_TABLE)
console.log(`verdict=${b.verdict}`)
if (b.reasons.length > 0) {
  console.log("reasons:")
  for (const reason of b.reasons) console.log(`- ${reason}`)
}
