import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  generating?: boolean;
  generatingText?: string;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-foreground)] hover:bg-[var(--color-accent-hover)]",
  secondary:
    "bg-[#3A3A3A] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[#5A5A5A]",
  ghost:
    "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text-primary)]",
  danger:
    "bg-[var(--color-destructive)] text-[var(--color-foreground)] hover:opacity-90",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs rounded-[var(--radius-sm)]",
  md: "px-3 py-1.5 text-[13px] rounded-[var(--radius-md)]",
  lg: "px-4 py-2 text-[13px] rounded-[var(--radius-md)]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  generating = false,
  generatingText,
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isActive = loading || generating;
  const glowClass = generating ? "btn-generating" : "";

  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${variantStyles[variant]} ${sizeStyles[size]} ${glowClass} ${className}`}
      disabled={disabled || isActive}
      {...props}
    >
      {isActive && (
        <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {generating && generatingText ? generatingText : children}
    </button>
  );
}
