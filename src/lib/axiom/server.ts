import axiomClient from "@/lib/axiom/axiom"
import { Logger, ConsoleTransport, AxiomJSTransport, type Transport } from "@axiomhq/logging"
import { createAxiomRouteHandler, nextJsFormatters } from "@axiomhq/nextjs"

const consoleTransport = new ConsoleTransport({ prettyPrint: process.env.NODE_ENV === "development" })

const transports: [Transport, ...Transport[]] = [consoleTransport]

if (process.env.AXIOM_TOKEN || process.env.NEXT_PUBLIC_AXIOM_TOKEN) {
  transports.push(
    new AxiomJSTransport({
      axiom: axiomClient,
      dataset: process.env.AXIOM_DATASET || "claws",
    })
  )
}

export const logger = new Logger({
  transports,
  formatters: nextJsFormatters,
})

export const withAxiom = createAxiomRouteHandler(logger)
