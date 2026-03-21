import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Check, X } from "lucide-react"

interface PlanFeature {
  text: string
  included: boolean
}

interface PlanCardProps {
  name: string
  price: string
  period: string
  features: PlanFeature[]
  featured?: boolean
  ctaLabel: string
  ctaVariant: "primary" | "outline"
  onCta?: () => void
}

export function PlanCard({ name, price, period, features, featured, ctaLabel, ctaVariant, onCta }: PlanCardProps) {
  return (
    <div className={cn(
      "border rounded-xl p-5 text-center",
      featured ? "border-2 border-[var(--tx)]" : "border-[var(--bd)]"
    )}>
      {featured && <p className="text-[10px] font-semibold text-[var(--tx)] mb-1">MOST POPULAR</p>}
      <h3 className="text-lg font-semibold mb-1">{name}</h3>
      <div className="text-[28px] font-semibold text-[var(--tx)]">{price}</div>
      <p className="text-xs text-[var(--tx2)]">{period}</p>

      <ul className="text-left text-xs my-3.5 leading-[2]">
        {features.map((f) => (
          <li key={f.text} className="flex items-center gap-2">
            <span className={cn("flex items-center", f.included ? "text-[var(--ok)]" : "text-[var(--tx3)]")}>
              {f.included ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
            </span>
            <span className={f.included ? "" : "text-[var(--tx3)]"}>{f.text}</span>
          </li>
        ))}
      </ul>

      <Button variant={ctaVariant} size="full" onClick={onCta}>
        {ctaLabel}
      </Button>
    </div>
  )
}
