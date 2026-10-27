"use client";

// VoltRide Button — design-system primitive. Variants map to token classes.
import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "btn-sm",
  md: "btn-md",
  lg: "btn-lg",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", fullWidth = false, loading = false, disabled, children, ...props }, ref) => {
    const base = `btn ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${
      fullWidth ? "w-full" : ""
    } ${loading ? "opacity-80" : ""}`;
    return (
      <button
        ref={ref}
        className={base + (className ? " " + className : "")}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <span className="loader mr-2" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
