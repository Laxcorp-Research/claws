"use client"

import { Logger, ProxyTransport } from "@axiomhq/logging"
import { createUseLogger, createWebVitalsComponent } from "@axiomhq/react"

export const clientLogger = new Logger({
  transports: [new ProxyTransport({ url: "/api/axiom", autoFlush: true })],
})

export const useLogger = createUseLogger(clientLogger)
export const WebVitals = createWebVitalsComponent(clientLogger)
