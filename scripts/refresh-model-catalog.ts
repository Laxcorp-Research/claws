import dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.staging" })
}

import { refreshAllModelCatalogs } from "../src/lib/models/catalog"

async function main() {
  const result = await refreshAllModelCatalogs()
  console.log(JSON.stringify(result, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
