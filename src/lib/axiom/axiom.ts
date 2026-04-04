import { Axiom } from "@axiomhq/js"

const axiomClient = new Axiom({
  token: process.env.AXIOM_TOKEN || process.env.NEXT_PUBLIC_AXIOM_TOKEN || "",
})

export default axiomClient
