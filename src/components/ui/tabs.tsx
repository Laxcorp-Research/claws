import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div className="flex gap-0 border-b border-[var(--bd)] mb-3.5" role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "py-1.5 px-3.5 text-xs cursor-pointer border-b-2 border-transparent transition-colors",
              active
                ? "text-[var(--tx)] border-b-[var(--tx)] font-medium"
                : "text-[var(--tx2)] hover:text-[var(--tx)]"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
