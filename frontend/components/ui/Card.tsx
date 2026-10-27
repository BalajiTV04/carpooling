"use client";

import { type HTMLAttributes, forwardRef } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padded?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = "", hover = false, padded = true, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`card ${hover ? "card-hover" : ""} ${
          padded ? "p-5" : ""
        } ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

export const CardBody = ({ children }: { children: React.ReactNode }) => (
  <div className="pt-4">{children}</div>
);

CardBody.displayName = "CardBody";

export const CardFooter = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-4 border-t border-line pt-4 flex items-center justify-between gap-3">
    {children}
  </div>
);

CardFooter.displayName = "CardFooter";
