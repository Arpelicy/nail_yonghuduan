"use client";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-scale-in rounded-[28px] border border-white/80 bg-white/80 p-5 shadow-soft backdrop-blur",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function GhostButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-orchid-200 bg-white px-4 py-2 text-sm font-semibold text-orchid-500",
        "transition-all duration-150 ease-out",
        "hover:bg-orchid-50 hover:border-orchid-300 hover:shadow-glow-sm hover:scale-[1.03]",
        "active:scale-[0.97] active:shadow-none",
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function GradientButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white",
        "bg-gradient-to-r from-orchid-500 to-orchid-400 shadow-glow",
        "transition-all duration-150 ease-out",
        "hover:shadow-glow hover:scale-[1.04] hover:opacity-95",
        "active:scale-[0.96] active:shadow-none active:opacity-90",
        "disabled:opacity-50 disabled:pointer-events-none disabled:scale-100",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
