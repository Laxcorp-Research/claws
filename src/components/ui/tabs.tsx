import { cn } from "@/lib/utils";
import { CountBadge } from "@/components/ui/count-badge";

interface Tab {
  id: string;
  label: string;
  badge?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab))
  return (
    <div className="flex gap-0 overflow-x-auto border-b border-[var(--bd)] mb-3.5" role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              if (event.key === "Enter" || event.key === " ") {
                onTabChange(tab.id)
                return
              }
              const delta = event.key === "ArrowRight" ? 1 : -1
              const next = tabs[(activeIndex + delta + tabs.length) % tabs.length]
              onTabChange(next.id)
            }}
            className={cn(
              "inline-flex items-center gap-[6px] py-2 px-[14px] text-xs cursor-pointer border-b-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ac)]/30 whitespace-nowrap",
              active
                ? "text-[var(--tx)] border-b-[var(--tx)] font-medium"
                : "text-[var(--tx2)] hover:text-[var(--tx)]"
            )}
          >
            {tab.label}
            <CountBadge count={tab.badge ?? 0} label="pending approvals" />
          </button>
        );
      })}
    </div>
  );
}
