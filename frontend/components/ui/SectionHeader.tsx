"use client";

import Link from "next/link";
import { type HTMLAttributes } from "react";

interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, action, className = "", ...props }: SectionHeaderProps) {
  return (
    <div className={`section-head ${className}`} {...props}>
      <div>
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="section-sub">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="flex items-center gap-2 text-xs text-muted" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 && <span className="text-line">/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-brand transition-colors cursor-pointer">
              {item.label}
            </Link>
          ) : (
            <span className="text-ink font-medium">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
