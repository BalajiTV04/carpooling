"use client";

import { type HTMLAttributes, forwardRef } from "react";

type Variant = "success" | "warning" | "danger" | "info";

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className = "", variant = "info", children, ...props }, ref) => {
    return (
      <div ref={ref} className={`alert alert-${variant} ${className}`} {...props}>
        {children}
      </div>
    );
  }
);

Alert.displayName = "Alert";
