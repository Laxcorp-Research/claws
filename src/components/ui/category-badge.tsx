export type ClawCategory = "MONEY_MAKING" | "CREATOR" | "BUSINESS_OPS" | "VERTICAL" | "LIFESTYLE";

interface CategoryBadgeProps {
  category: ClawCategory;
}

const styles: Record<ClawCategory, { bg: string; text: string; border: string; label: string }> = {
  MONEY_MAKING: { bg: "#FFF8E7", text: "#8A6D00", border: "#FFE9A0", label: "Money Making" },
  CREATOR:      { bg: "#EDFFF3", text: "#0D6B32", border: "#B8FFCF", label: "Creator" },
  BUSINESS_OPS: { bg: "#EEF5FF", text: "#1A5BBF", border: "#A8CFFF", label: "Business Ops" },
  VERTICAL:     { bg: "#FFF0EF", text: "#8B2018", border: "#FFD4D0", label: "Vertical" },
  LIFESTYLE:    { bg: "#F5F0FF", text: "#5B3A99", border: "#E0D0FF", label: "Lifestyle" },
};

export function CategoryBadge({ category }: CategoryBadgeProps) {
  const s = styles[category];
  return (
    <span
      className="inline-block text-[11px] font-semibold tracking-[0.5px] uppercase py-[3px] px-3 rounded-lg mb-1.5"
      style={{ background: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}
