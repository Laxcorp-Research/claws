/**
 * Builder segment layout — intentionally does NOT nest SessionProvider.
 * Root `app/layout.tsx` seeds Providers with getServerSession; a nested
 * <Providers> without session would reset status to loading and reintroduce
 * the TopBar Sign-in flash on builder routes.
 */
export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return children
}
