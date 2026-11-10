"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { AnimatePresence, motion } from "framer-motion";

export function AdminLoginPage() {
  const { user, ready, login } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const phone = form.get("phone") as string;
    const password = form.get("password") as string;
    
    try {
      await login(phone, password, "admin");
      router.push("/admin");
    } catch (error) {
      // Login failed - could show error
    }
  };

  if (!ready) {
    return (
      <AnimatePresence>
        {true && (
          <motion.div className="fixed inset-0 z-[50] flex items-center justify-center">
            <motion.div className="p-8 bg-surface border border-line rounded-xl">
              <span className="text-sm text-muted">Checking session…</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  if (user) {
    router.push("/admin");
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-xl p-8 max-w-md w-full">
        <h2 className="font-display font-bold text-ink mb-6 text-center">
          Admin Login
        </h2>
        
        {!user && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="rounded-xl border border-brand-teal/30 p-3">
              <label className="block text-sm text-muted mb-2">
                Username
              </label>
              <input
                type="text"
                className="w-full rounded-xl px-3 py-2 border-transparent focus:border-brand-teal focus:outline-none bg-surface/50"
                placeholder="Username"
              />
            </div>
            
            <div className="rounded-xl border border-brand-teal/30 p-3">
              <label className="block text-sm text-muted mb-2">
                Password
              </label>
              <input
                type="password"
                className="w-full rounded-xl px-3 py-2 border-transparent focus:border-brand-teal focus:outline-none bg-surface/50"
                placeholder="Password"
              />
            </div>
            
            <Button variant="primary" type="submit" className="w-full">
              Sign In
            </Button>
          </form>
        }}
        
        {user && (
          <p className="mt-4 text-center text-sm text-brand-teal">
            Login successful! Redirecting...
          </p>
        )}
      </div>
    </div>
  );
}