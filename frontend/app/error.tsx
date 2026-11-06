"use client";

import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";
import { AlertCircle } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <section className="min-h-screen bg-token-bg text-token-ink p-8">
      <div className="mx-auto max-w-2xl text-center">
        <BrandMark size={48} className="mx-auto mb-6" />
        <h1 className="font-display text-4xl font-bold text-ink mb-4">Something went wrong</h1>
        <p className="text-token-muted text-lg mb-6">
          An unexpected error occurred: {error.message}
        </p>
        <button
          onClick={reset}
          className="btn btn-primary mt-6"
        >
          Try Again
        </button>
      </div>
    </section>
  );
}