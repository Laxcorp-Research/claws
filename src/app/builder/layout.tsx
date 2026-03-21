import { Providers } from "@/components/providers"

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>
}
