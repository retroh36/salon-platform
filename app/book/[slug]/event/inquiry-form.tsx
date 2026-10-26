"use client";

import { useRef, useState, useTransition } from "react";
import { chipClass, inputClass, primaryButton } from "@/app/book/[slug]/styles";
import { Alert } from "@/components/ui/page";
import { shrinkPhoto } from "@/lib/photos";
import { addInquiryPhoto, sendInquiry, type InquiryInput } from "./actions";

const field = inputClass;
const label = "flex flex-col gap-1.5 text-sm font-medium text-ink";

// The event inquiry: what, when, where, how many and what they need, a few
// inspiration photos, and how to reach them. Phone-first, big targets.
export function InquiryForm({ slug, salon, today }: { slug: string; salon: string; today: string }) {
  const [f, setF] = useState<InquiryInput>({ kind: "wedding", date: "", readyBy: "", venue: "", inSalon: false, partySize: "", hair: true, makeup: true, notes: "", firstName: "", lastName: "", phone: "", email: "", website: "" });
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ photos: number; failed: number } | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  if (sent)
    return (
      <div className="flex flex-col gap-2" data-testid="inquiry-sent">
        <h2 className="text-xl font-semibold text-ink">Thank you</h2>
        <p className="text-ink-muted">
          {salon} has your inquiry{sent.photos ? ` and ${sent.photos} ${sent.photos === 1 ? "photo" : "photos"}` : ""} and will be in touch soon to plan the day.
          {sent.failed > 0 ? ` ${sent.failed === 1 ? "One photo" : `${sent.failed} photos`} didn't upload; you can send them when we reply.` : ""}
        </p>
      </div>
    );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await sendInquiry(slug, f);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          let done = 0;
          for (const file of photos.slice(0, 6)) {
            try {
              const data = new FormData();
              data.set("photo", await shrinkPhoto(file), "photo.jpg");
              if ((await addInquiryPhoto(result.eventId, result.photoKey, data)).ok) done += 1;
            } catch {
              // A photo the browser can't read is skipped.
            }
          }
          setSent({ photos: done, failed: Math.min(photos.length, 6) - done });
        });
      }}
    >
      <fieldset className="flex gap-2">
        <legend className="mb-1.5 text-sm font-medium text-ink">What are you planning?</legend>
        {(["wedding", "event"] as const).map((k) => (
          <label key={k} className={`${chipClass(f.kind === k)} h-12 flex-1 cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus`}>
            <input type="radio" name="kind" className="sr-only" checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} />
            {k === "wedding" ? "A wedding" : "Another event"}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          Date
          <input type="date" min={today} required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className={field} />
        </label>
        <label className={label}>
          Ready by
          <input type="time" step={900} value={f.readyBy} onChange={(e) => setF({ ...f, readyBy: e.target.value })} className={field} />
        </label>
      </div>
      <label className={label}>
        Where
        <input value={f.venue} disabled={f.inSalon} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="The venue or hotel, and the town" className={field} maxLength={200} />
      </label>
      <label className="-mt-2 flex min-h-11 items-center gap-3 text-sm font-medium">
        <input type="checkbox" className="size-5 accent-(--accent)" checked={f.inSalon} onChange={(e) => setF({ ...f, inSalon: e.target.checked })} />
        We&rsquo;ll come to the salon
      </label>
      <label className={label}>
        How many people need hair or makeup?
        <input type="number" inputMode="numeric" min={1} max={100} required value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} className={field} />
      </label>
      <fieldset className="flex gap-6">
        <legend className="mb-1 text-sm font-medium text-ink">Services</legend>
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-(--accent)" checked={f.hair} onChange={(e) => setF({ ...f, hair: e.target.checked })} />
          Hair
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-(--accent)" checked={f.makeup} onChange={(e) => setF({ ...f, makeup: e.target.checked })} />
          Makeup
        </label>
      </fieldset>
      <label className={label}>
        Anything else
        <textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={`${inputClass} py-3`} maxLength={2000} placeholder="The look you're after, the schedule, questions" />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Inspiration photos (up to 6)</span>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-label="Inspiration photos"
          onChange={(e) => setPhotos([...(e.target.files ?? [])].slice(0, 6))}
          className="text-sm text-ink-muted file:mr-3 file:inline-flex file:min-h-11 file:cursor-pointer file:rounded-lg file:border file:border-solid file:border-line-strong file:bg-surface file:px-4 file:text-sm file:font-medium file:text-ink hover:file:bg-sunken"
        />
        {photos.length > 0 && <p className="text-sm text-ink-muted">{photos.length === 1 ? "1 photo" : `${photos.length} photos`} chosen</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={label}>
          First name
          <input required autoComplete="given-name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} className={field} maxLength={80} />
        </label>
        <label className={label}>
          Last name
          <input autoComplete="family-name" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} className={field} maxLength={80} />
        </label>
      </div>
      <label className={label}>
        Phone
        <input type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={field} maxLength={40} />
      </label>
      <label className={label}>
        Email
        <input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={field} maxLength={254} />
      </label>
      <label className="sr-only" aria-hidden>
        Website
        <input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      </label>
      {error && <Alert>{error}</Alert>}
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Sending…" : "Send inquiry"}
      </button>
      <p className="text-center text-xs text-ink-subtle">Nothing is booked yet. {salon} replies with a proposal.</p>
    </form>
  );
}
