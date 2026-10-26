"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

// Sign with a finger, stylus or mouse. Reports a PNG data URL after each
// stroke, or null once cleared.
export function SignaturePad({ label, onChange }: { label: string; onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const scale = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * scale;
    c.height = c.offsetHeight * scale;
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(c).color;
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        data-testid="signature-pad"
        className="h-44 w-full touch-none rounded-lg border border-dashed border-line-strong bg-surface text-ink"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = e.currentTarget.getContext("2d")!;
          const [x, y] = point(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const [x, y] = point(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={(e) => {
          if (!drawing.current) return;
          drawing.current = false;
          onChange(e.currentTarget.toDataURL("image/png"));
        }}
      />
      <div className="flex items-center justify-between text-sm text-ink-muted">
        <span>Sign above with your finger</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            onChange(null);
          }}
        >
          Clear signature
        </Button>
      </div>
    </div>
  );
}
