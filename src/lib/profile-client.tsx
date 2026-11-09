"use client"

import { createContext, useContext, useEffect, type ReactNode } from "react"

const SelfHostContext = createContext(false)

let selfHostFlag = false

/** Non-hook callers (click handlers). The provider sets this from the server prop. */
export function clientIsSelfHost(): boolean {
  return selfHostFlag
}

export function useSelfHost(): boolean {
  return useContext(SelfHostContext)
}

export function SelfHostProvider({
  selfHost,
  children,
}: {
  selfHost: boolean
  children: ReactNode
}) {
  useEffect(() => {
    selfHostFlag = selfHost
    return () => {
      selfHostFlag = false
    }
  }, [selfHost])
  return <SelfHostContext.Provider value={selfHost}>{children}</SelfHostContext.Provider>
}
