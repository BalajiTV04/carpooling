"use client";

import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helper?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helper, className = "", id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold text-ink/90 uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`input ${error ? "border-danger focus:ring-danger focus:border-danger" : ""} ${
            className ? className : ""
          }`}
          aria-invalid={error ? true : undefined}
          aria-describedby={helper ? inputId + "-helper" : undefined}
          {...props}
        />
        {helper && (
          <p id={inputId + "-helper"} className="text-xs text-muted">
            {helper}
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
