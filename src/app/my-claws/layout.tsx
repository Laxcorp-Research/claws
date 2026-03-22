import type { Metadata } from "next"

export const metadata: Metadata = { title: "My Claws" }

export default function MyClawsLayout({ children }: { children: React.ReactNode }) {
  return children
}
