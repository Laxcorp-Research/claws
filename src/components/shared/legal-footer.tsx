import { LEGAL_URLS } from "@/lib/legal/consent"

const LINKS: Array<{ label: string; href: string }> = [
  { label: "Privacy", href: LEGAL_URLS.privacy },
  { label: "Terms", href: LEGAL_URLS.terms },
  { label: "Cookies", href: LEGAL_URLS.cookie },
  { label: "Acceptable Use", href: LEGAL_URLS.aup },
  { label: "Data Processing", href: LEGAL_URLS.dataProcessing },
]

/**
 * App-wide slim legal footer (root layout). Links to the buildclaws.ai
 * legal pages - the app hosts NO legal pages of its own by design.
 */
export function LegalFooter() {
  return (
    <footer className="w-full border-t border-[var(--bd)] bg-[var(--bg)] py-3 px-4">
      <nav
        aria-label="Legal"
        className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-4 gap-y-1"
      >
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[var(--tx3)] transition-colors hover:text-[var(--tx)]"
          >
            {link.label}
          </a>
        ))}
        <span className="text-[11px] text-[var(--tx3)]">
          © {new Date().getFullYear()} Laxcorp Software Design FZCO
        </span>
      </nav>
    </footer>
  )
}
