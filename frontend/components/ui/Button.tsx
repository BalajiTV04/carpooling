"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", asChild = false, ...props }, ref) => {
    const Comp = asChild ? React.Fragment : "button";

    const variants = {
      primary: "bg-gradient-indigo-teal text-white shadow-sm hover:shadow-glow-brand hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-teal/50",
      secondary:
        "bg-card text-ink border border-line hover:bg-card-hover hover:border-line-hover focus-visible:ring-2 focus-visible:ring-brand-teal/50",
      ghost:
        "bg-transparent text-muted hover:bg-surface hover:text-brand focus-visible:ring-2 focus-visible:ring-brand-teal/50",
      danger:
        "bg-danger text-white hover:bg-danger/90 shadow-sm focus-visible:ring-2 focus-visible:ring-danger/50",
    };

    const sizes = {
      sm: "px-3 py-1.5 text-xs",
      md: "px-4 py-2 text-sm",
      lg: "px-6 py-3 text-base",
    };

    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };
