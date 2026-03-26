import Link from "next/link"

interface PricingCardProps {
  tier: string
  price: number
  tagline: string
  templates: string[]
  featured?: boolean
}

export function PricingCard({ tier, price, tagline, templates, featured }: PricingCardProps) {
  return (
    <div className={`border rounded-xl p-5 text-center ${featured ? "border-2 border-[var(--ac)]" : "border-[var(--bd)]"}`}>
      {featured && <p className="text-[10px] font-semibold text-[var(--ac)] mb-1">MOST POPULAR</p>}
      <h3 className="text-lg font-semibold mb-1">{tier}</h3>
      <div className="text-[28px] font-semibold text-[var(--tx)]">${price}</div>
      <p className="text-xs text-[var(--tx2)]">one-time purchase</p>

      <ul className="text-left text-xs my-3.5 leading-[2]">
        {templates.map((t) => (
          <li key={t} className="text-[var(--tx2)]">
            {t}
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-[var(--tx3)] italic mb-3">{tagline}</p>

      <Link
        href="/store"
        className="text-[13px] font-medium text-[var(--ac)] hover:text-[var(--tx)] transition-colors"
      >
        Browse templates →
      </Link>
    </div>
  )
}
