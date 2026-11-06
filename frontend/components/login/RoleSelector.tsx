// Role selection step: Driver or Passenger.
// Emits the chosen role; keeps the role in the URL so refresh/back work.
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Car, User, Shield, MapPin, ChevronRight } from "lucide-react";

type Role = "driver" | "passenger";

const ROLE_INFO: Record<Role, { icon: React.ElementType; label: string; desc: string; badge: string }> = {
  driver: {
    icon: Car,
    label: "Driver",
    desc: "Publish trips, share your route, and earn by carrying passengers.",
    badge: "driver",
  },
  passenger: {
    icon: User,
    label: "Passenger",
    desc: "Search rides, book seats, and track your journey live.",
    badge: "passenger",
  },
};

interface RoleSelectorProps {
  onChoose: (role: Role) => void;
  initialRole?: Role;
  className?: string;
}

export function RoleSelector({ onChoose, initialRole = "passenger", className }: RoleSelectorProps) {
  const [role, setRole] = useState<Role>(initialRole);

  const choose = (r: Role) => {
    setRole(r);
    onChoose(r);
  };

  return (
    <div className={cn("grid gap-4", className)}>
      {(["driver", "passenger"] as Role[]).map((r) => {
        const info = ROLE_INFO[r];
        const active = role === r;
        return (
          <Card
            key={r}
            hover
            className={cn(
              "group cursor-pointer border-2 transition-all duration-200",
              active
                ? "border-brand-teal bg-card/50 shadow-[0_0_20px_rgb(34,211,238,0.15)]"
                : "border-line hover:border-brand-teal/40 hover:bg-surface/40"
            )}
            onClick={() => choose(r)}
            role="menuitemradio"
            aria-checked={active}
          >
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-2xl flex items-center justify-center bg-surface border border-line group-hover:border-brand-teal/50 transition-colors">
                <info.icon className={`h-6 w-6 ${active ? "text-brand-teal" : "text-muted"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-display font-bold text-ink group-hover:text-brand">{info.label}</h3>
                  <Badge variant="muted" className="text-[10px]">{info.badge}</Badge>
                </div>
                <p className="text-sm text-muted leading-relaxed">{info.desc}</p>
              </div>
              <ChevronRight className={`h-5 w-5 ${active ? "text-brand-teal" : "text-muted/40"}`} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}