import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = "", hover = false }: CardProps) {
  return (
    <div
      className={`overflow-hidden transition-all duration-200 ${
        hover ? "hover:-translate-y-0.5 hover:shadow-md" : ""
      } ${className}`}
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      {children}
    </div>
  );
}
