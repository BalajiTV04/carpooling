import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";
import { CheckCircle } from "lucide-react";
import Link from "next/link";

export default function NotFoundPage() {
  return (
    <section className="min-h-screen bg-token-bg text-token-ink p-8">
      <div className="mx-auto max-w-2xl text-center">
        <BrandMark size={48} className="mx-auto mb-6" />
        <h1 className="font-display text-4xl font-bold text-ink mb-4">Page Not Found</h1>
        <p className="text-token-muted text-lg mb-6">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link href="/" className="btn btn-primary">
          Go to Home
        </Link>
      </div>
    </section>
  );
}