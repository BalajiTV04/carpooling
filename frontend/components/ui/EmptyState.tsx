"use client";

import { type HTMLAttributes } from "react";

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title?: string;
  message?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  className = "",
  icon,
  title,
  message,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`} {...props}>
      {icon && <div className="empty-icon">{icon}</div>}
      {title && <h3 className="text-lg font-bold text-ink">{title}</h3>}
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
