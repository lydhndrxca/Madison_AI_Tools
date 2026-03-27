import React from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className = "", ...props }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </label>
      )}
      <textarea
        className={`w-full px-2.5 py-1.5 text-[13px] outline-none transition-colors resize-none placeholder:text-[var(--color-text-muted)] ${className}`}
        style={{
          background: "var(--color-input-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          color: "var(--color-text-primary)",
        }}
        {...props}
      />
    </div>
  );
}
