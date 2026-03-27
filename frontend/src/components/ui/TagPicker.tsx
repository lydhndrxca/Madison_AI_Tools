interface TagPickerProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  label?: string;
}

export function TagPicker({ options, selected, onChange, label }: TagPickerProps) {
  const toggle = (tag: string) => {
    onChange(
      selected.includes(tag)
        ? selected.filter((t) => t !== tag)
        : [...selected, tag],
    );
  };

  return (
    <div>
      {label && (
        <span className="text-xs block mb-1" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </span>
      )}
      <div className="flex flex-wrap gap-1">
        {options.map((tag) => {
          const active = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className="px-1.5 py-0.5 text-[10px] rounded-[var(--radius-sm)] cursor-pointer transition-colors border"
              style={{
                background: active ? "var(--color-accent)" : "var(--color-input-bg)",
                color: active ? "var(--color-foreground)" : "var(--color-text-secondary)",
                borderColor: active ? "var(--color-accent)" : "var(--color-border)",
              }}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
