"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addVisitPhoto, deleteVisitPhoto, setPhotoConsent, setPhotoMarketing, visitPhotos, type PhotoResult } from "@/app/clients/photo-actions";
import { Button, IconButton } from "@/components/ui/button";
import { checkboxClass, fieldClass } from "@/components/ui/field";
import { CloseIcon } from "@/components/ui/icons";
import { Segmented } from "@/components/ui/segmented";
import { formatDate } from "@/lib/clients";
import { byVisit, PHOTO_KIND_LABELS, shrinkPhoto, type PhotoKind, type PhotoView } from "@/lib/photos";
import type { PhotoConsent } from "@/lib/photos-load";

type Loaded = { photos: PhotoView[]; consent: PhotoConsent; clientId: string | null };

// Booking details' Photos tab: take or upload before and after photos for
// the visit, see them, and mark them OK for marketing.
export function VisitPhotosTab({ appointmentId, today }: { appointmentId: string; today: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const reload = () => visitPhotos(appointmentId).then(setLoaded);
  useEffect(() => {
    let live = true;
    visitPhotos(appointmentId).then((l) => live && setLoaded(l));
    return () => {
      live = false;
    };
  }, [appointmentId]);

  if (!loaded) return <p className="text-sm text-ink-muted">Loading photos…</p>;
  if (!loaded.clientId) return <p className="text-sm text-ink-muted">Photos are saved to a client; this visit has none.</p>;
  return (
    <div className="flex flex-col gap-4">
      <PhotoUploader appointmentId={appointmentId} onAdded={reload} />
      {loaded.photos.length > 0 ? (
        <PhotoGrid photos={loaded.photos} consent={loaded.consent} onChange={reload} showDate={false} />
      ) : (
        <p className="text-sm text-ink-muted">No photos of this visit yet.</p>
      )}
      <ConsentLine clientId={loaded.clientId} consent={loaded.consent} today={today} onChange={reload} />
    </div>
  );
}

// Before or after, then the camera (phones and iPads) or a file.
export function PhotoUploader({ appointmentId, onAdded }: { appointmentId: string; onAdded: () => Promise<unknown> }) {
  const [kind, setKind] = useState<PhotoKind>("before");
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [pending, start] = useTransition();
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  const save = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    if (!chosen.length) return;
    start(async () => {
      let last: PhotoResult = { ok: false, message: "Choose a photo." };
      for (const file of chosen) {
        const form = new FormData();
        try {
          form.append("photo", await shrinkPhoto(file), "photo.jpg");
        } catch {
          last = { ok: false, message: "Couldn't read that photo. Try another." };
          continue;
        }
        last = await addVisitPhoto(appointmentId, kind, form);
        if (!last.ok) break;
      }
      setResult(last.ok && chosen.length > 1 ? { ok: true, message: `${chosen.length} ${kind} photos saved.` } : last);
      await onAdded();
      if (camera.current) camera.current.value = "";
      if (files.current) files.current.value = "";
    });
  };

  return (
    <section aria-label="Add photos" className="flex flex-wrap items-center gap-2">
      <Segmented<PhotoKind>
        label="Photo of"
        value={kind}
        onChange={setKind}
        options={[
          { value: "before", label: "Before" },
          { value: "after", label: "After" },
        ]}
      />
      <Button size="sm" variant="primary" disabled={pending} onClick={() => camera.current?.click()}>
        Take photo
      </Button>
      <Button size="sm" disabled={pending} onClick={() => files.current?.click()}>
        Upload
      </Button>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label={`Take a ${kind} photo`} onChange={(e) => save(e.target.files)} />
      <input ref={files} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple className="sr-only" tabIndex={-1} aria-label={`Upload ${kind} photos`} onChange={(e) => save(e.target.files)} />
      <p role="status" className={`basis-full text-sm ${result && !result.ok ? "text-danger" : "text-ink-muted"}`}>
        {pending ? "Saving…" : result?.message}
      </p>
    </section>
  );
}

export function PhotoGrid({ photos, consent, onChange, showDate = true }: { photos: PhotoView[]; consent: PhotoConsent; onChange?: () => Promise<unknown>; showDate?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<PhotoResult | null>(null);
  // Ticked at once, while it saves.
  const [shown, mark] = useOptimistic(photos, (list, { id, ok }: { id: string; ok: boolean }) => list.map((p) => (p.id === id ? { ...p, marketingOk: ok } : p)));
  const after = async (r: PhotoResult) => {
    setMessage(r);
    if (onChange) await onChange();
    else router.refresh();
  };
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photos">
        {shown.map((p) => (
          <li key={p.id} className="flex min-w-0 flex-col gap-1.5" data-testid="visit-photo" data-kind={p.kind}>
            <div className="relative overflow-hidden rounded-lg bg-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived links */}
              <img src={p.url} alt={`${PHOTO_KIND_LABELS[p.kind]} photo, ${formatDate(p.takenOn)}`} className="aspect-[3/4] w-full object-cover" loading="lazy" />
              <span className="absolute top-1.5 left-1.5 rounded-full bg-surface/90 px-2 py-0.5 text-xs font-semibold text-ink">{PHOTO_KIND_LABELS[p.kind]}</span>
              {p.canDelete && (
                <IconButton
                  label={`Remove this ${p.kind} photo`}
                  size="xs"
                  variant="secondary"
                  className="absolute top-1.5 right-1.5"
                  disabled={pending}
                  onClick={() => start(async () => await after(await deleteVisitPhoto(p.id)))}
                >
                  <CloseIcon className="size-3.5" />
                </IconButton>
              )}
            </div>
            <p className="text-xs text-ink-muted">
              {showDate ? formatDate(p.takenOn) : null}
              {showDate && p.stylist ? " · " : null}
              {p.stylist ? `with ${p.stylist}` : null}
            </p>
            <label className={`flex items-center gap-1.5 text-xs ${consent.on ? "text-ink" : "text-ink-subtle"}`} title={consent.on ? undefined : "Record the client's consent first"}>
              <input
                type="checkbox"
                className={checkboxClass}
                checked={p.marketingOk}
                disabled={pending || (!consent.on && !p.marketingOk)}
                onChange={(e) => {
                  const ok = e.target.checked;
                  start(async () => {
                    mark({ id: p.id, ok });
                    await after(await setPhotoMarketing(p.id, ok));
                  });
                }}
              />
              OK for marketing
            </label>
          </li>
        ))}
      </ul>
      {message && !message.ok && (
        <p role="alert" className="text-sm text-danger">
          {message.message}
        </p>
      )}
    </div>
  );
}

// Whether the client agreed to their photos being used in marketing, and
// when; recording it is what lets photos be marked.
export function ConsentLine({ clientId, consent, today, onChange }: { clientId: string; consent: PhotoConsent; today: string; onChange?: () => Promise<unknown> }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [pending, start] = useTransition();
  const save = (on: string | null) =>
    start(async () => {
      const r = await setPhotoConsent(clientId, on);
      setResult(r);
      if (r.ok) setOpen(false);
      if (onChange) await onChange();
      else router.refresh();
    });
  return (
    <section aria-label="Marketing consent" className="flex flex-col gap-2 text-sm" data-testid="photo-consent">
      {consent.on ? (
        <p className="text-ink-muted">
          Consent to use photos in marketing: given {formatDate(consent.on)}
          {consent.by ? ` (recorded by ${consent.by})` : ""}.{" "}
          <button type="button" disabled={pending} onClick={() => save(null)} className="font-medium text-link hover:underline">
            Withdraw
          </button>
        </p>
      ) : open ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-ink">
            Consent given on
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={`${fieldClass} w-40!`} />
          </label>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => save(date)}>
            Record consent
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <p className="text-ink-muted">
          No consent to use their photos in marketing.{" "}
          <button type="button" onClick={() => setOpen(true)} className="font-medium text-link hover:underline">
            They&apos;ve agreed
          </button>
        </p>
      )}
      {result && (
        <p role="status" className={result.ok ? "text-ink-muted" : "text-danger"}>
          {result.message}
        </p>
      )}
    </section>
  );
}

// The client profile's gallery: each visit's photos together, newest first.
export function PhotoGallery({ clientId, photos, consent, today }: { clientId: string; photos: PhotoView[]; consent: PhotoConsent; today: string }) {
  return (
    <div className="flex flex-col gap-5">
      {photos.length === 0 ? (
        <p className="text-sm text-ink-muted">No photos yet. Add them from the visit in booking details.</p>
      ) : (
        <ol className="flex flex-col gap-5" aria-label="Photos by visit">
          {byVisit(photos).map((v) => (
            <li key={v.appointmentId}>
              <h3 className="mb-2 text-sm font-semibold text-ink">
                {formatDate(v.takenOn)}
                {v.photos[0].stylist ? <span className="font-normal text-ink-muted"> · with {v.photos[0].stylist}</span> : null}
              </h3>
              <PhotoGrid photos={v.photos} consent={consent} showDate={false} />
            </li>
          ))}
        </ol>
      )}
      <ConsentLine clientId={clientId} consent={consent} today={today} />
    </div>
  );
}
