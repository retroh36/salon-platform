"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { removeStaffPhoto, uploadStaffPhoto, type PhotoResult } from "./actions";

// Upload or remove a stylist's photo (shown on the booking site), for
// owners and managers.
export function StaffPhotoForm({ staffId, hasPhoto }: { staffId: string; hasPhoto: boolean }) {
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      aria-label="Photo"
      className="flex items-center gap-3 sm:ml-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        e.currentTarget.reset();
        start(async () => setResult(await uploadStaffPhoto(staffId, data)));
      }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-ink-muted">
          Photo for online booking
          <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" className="block text-xs" />
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            Upload
          </Button>
          {hasPhoto && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => setResult(await removeStaffPhoto(staffId)))}>
              Remove
            </Button>
          )}
        </div>
        {result && (
          <p role={result.ok ? "status" : "alert"} className={`text-xs ${result.ok ? "text-status-confirmed-ink" : "text-danger"}`}>
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}
