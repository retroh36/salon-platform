"use client";

import { useRef } from "react";
import { SideScrollEdges } from "./side-scroll";

// The one box around a table (./table.tsx): with too little room (a narrow
// screen, Denise's panel open) it scrolls sideways rather than squeezing the
// columns, and the side with more columns says so. `className` is for its
// margins.
export function TableCard({ className = "", children, ...rest }: { className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className={`relative mb-6 ${className}`}>
      <div ref={ref} className="overflow-x-auto overscroll-x-contain rounded-lg border border-line bg-surface" {...rest}>
        {children}
      </div>
      <SideScrollEdges target={ref} label="More columns" />
    </div>
  );
}
