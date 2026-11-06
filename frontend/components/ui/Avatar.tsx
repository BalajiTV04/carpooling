"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarProps
  extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = {
  sm: "h-8 w-8 text-[10px]",
  md: "h-10 w-10 text-[12px]",
  lg: "h-12 w-12 text-[14px]",
  xl: "h-16 w-16 text-[18px]",
};

export function Avatar({
  className,
  src,
  alt,
  fallback = "?",
  size = "md",
  ...props
}: AvatarProps) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink font-semibold",
        sizes[size],
        className
      )}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={alt ?? "User avatar"}
          className="rounded-full h-full w-full object-cover"
        />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
}
