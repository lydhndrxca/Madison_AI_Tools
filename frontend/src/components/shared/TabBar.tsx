import { cn } from "@/lib/cn";

interface TabBarProps {
  tabs: string[];
  active: string;
  onSelect: (tab: string) => void;
}

export function TabBar({ tabs, active, onSelect }: TabBarProps) {
  return (
    <div
      className="flex items-center gap-0 shrink-0 overflow-x-auto"
      style={{
        background: "var(--color-card)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onSelect(tab)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap cursor-pointer",
            active === tab
              ? "text-[var(--color-foreground)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]",
          )}
          style={{
            background: active === tab ? "var(--color-hover)" : "transparent",
            border: "none",
            borderBottom: active === tab ? "2px solid var(--color-text-secondary)" : "2px solid transparent",
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
