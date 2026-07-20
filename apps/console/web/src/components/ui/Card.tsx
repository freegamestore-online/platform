import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5", className)} {...props} />;
}

export type BadgeTone = "accent" | "success" | "danger" | "muted";

const TONES: Record<BadgeTone, string> = {
  accent: "text-[var(--accent)] bg-[var(--accent-soft,rgba(16,185,129,0.12))]",
  success: "text-[#22c55e] bg-[#22c55e]/12",
  danger: "text-[#ef4444] bg-[#ef4444]/12",
  muted: "text-[var(--muted)] bg-[var(--bg)]",
};

export function Badge({ tone = "accent", className, children, ...props }: { tone?: BadgeTone; className?: string; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)} {...props}>
      {children}
    </span>
  );
}
