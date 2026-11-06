"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "brand" | "success" | "warning" | "danger" | "muted";
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "muted", ...props }, ref) => {
    const variants = {
      brand: "border-brand-teal/20 bg-brand-teal/10 text-brand-teal",
      success: "border-success/20 bg-success/10 text-success",
      warning: "border-warn/20 bg-warn/10 text-ink",
      danger: "border-danger/20 bg-danger/10 text-danger",
      muted: "border-line/50 bg-surface text-muted",
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full border px-3 py-0.5 text-[10px] font-semibold leading-none uppercase tracking-wider",
          variants[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";

export { Badge };
