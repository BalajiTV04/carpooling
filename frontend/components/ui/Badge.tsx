"use client";

import { type HTMLAttributes, forwardRef } from "react";

type Variant = "brand" | "success" | "warning" | "danger" | "muted";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className = "", variant = "brand", children, ...props }, ref) => {
    const base = `badge badge-${variant} ${className}`;
    return <span ref={ref} className={base} {...props}>{children}</span>;
  }
);

Badge.displayName = "Badge";
