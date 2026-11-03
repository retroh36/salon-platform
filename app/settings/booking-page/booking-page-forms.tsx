"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { BIO_MAX, DESCRIPTION_MAX, PORTFOLIO_MAX, SERVICE_DESCRIPTION_MAX, SPECIALTY_MAX } from "@/lib/online-booking/profile";
import { shrinkPhoto } from "@/lib/photos";
import { reach } from "@/lib/reach";
import type { StaffLevel } from "@/lib/schedule-forms";
import { useUnsavedChanges } from "@/components/unsaved";
import {
  addPortfolioPhoto,
  removeCategoryPhoto,
  removeCover,
  removePortfolioPhoto,
  removePortrait,
  saveDescription,
  saveProfile,
  saveServiceDescriptions,
  uploadCategoryPhoto,
  uploadCover,
  uploadPortrait,
  type PageResult,
} from "./actions";

function Result({ result }: { result: PageResult | null }) {
  if (!result) return null;
  return <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>;
}

// Shrinks the photo chosen to a JPEG (2000px at most, without location or
// device details) and sends it.
async function send(file: File, upload: (form: FormData) => Promise<PageResult>): Promise<PageResult> {
  const form = new FormData();
  try {
    form.set("photo", await shrinkPhoto(file), "photo.jpg");
  } catch {
    return { ok: false, message: "Couldn't read that photo. Try a JPEG or PNG." };
  }
  return reach(upload(form)).catch(() => ({ ok: false, message: "Couldn't upload that photo. Check your connection and try again." }));
}

// A photo with Upload (or Replace) and Remove.
export function PhotoField({
  label,
  url,
  shape,
  empty,
  upload,
  remove,
  testId,
}: {
  label: string;
  url: string | null;
  // The preview's size and shape.
  shape: string;
  empty?: React.ReactNode;
  upload: (form: FormData) => Promise<PageResult>;
  remove: () => Promise<PageResult>;
  testId?: string;
}) {
  const [result, setResult] = useState<PageResult | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-end gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className={`${shape} rounded-md border border-line bg-sunken object-cover`} />
        ) : (
          <div className={`${shape} flex items-center justify-center rounded-md border border-dashed border-line-strong bg-sunken text-13 text-ink-muted`}>{empty ?? "No photo"}</div>
        )}
        <div className="flex flex-wrap gap-2">
          <label className={`inline-flex h-9 cursor-pointer items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-ink hover:bg-sunken has-focus-visible:outline-2 has-focus-visible:outline-focus ${busy ? "pointer-events-none opacity-55" : ""}`}>
            {busy ? "Uploading…" : url ? "Replace" : "Upload"}
            <span className="sr-only"> {label}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) start(async () => setResult(await send(file, upload)));
              }}
            />
          </label>
          {url && (
            <Button variant="quiet" size="sm" disabled={busy} onClick={() => start(async () => setResult(await reach(remove()).catch(() => ({ ok: false, message: "Couldn't remove it. Try again." }))))}>
              Remove<span className="sr-only"> {label}</span>
            </Button>
          )}
        </div>
      </div>
      <Result result={result} />
    </div>
  );
}

export function CoverForm({ coverUrl, description }: { coverUrl: string | null; description: string }) {
  const [text, setText] = useState(description);
  const [result, setResult] = useState<PageResult | null>(null);
  const [saving, start] = useTransition();
  useUnsavedChanges(text !== description);
  return (
    <div className="flex flex-col gap-5">
      <div className={labelClass}>
        <span>Cover photo</span>
        <PhotoField label="Cover photo" url={coverUrl} shape="aspect-[3/1] w-full max-w-md" empty="No cover photo" upload={uploadCover} remove={removeCover} testId="cover-field" />
        <span className="font-normal text-ink-muted">A wide photo of the salon works best. It shows across the top of your booking site.</span>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setResult(await reach(saveDescription(text)).catch(() => ({ ok: false, message: "Couldn't save. Try again." }))));
        }}
      >
        <label className={labelClass}>
          Short description
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={DESCRIPTION_MAX} rows={3} className={fieldClass} />
          <span className="font-normal text-ink-muted">Under your name: what the salon is about, in a sentence or two.</span>
        </label>
        <Result result={result} />
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save description"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export type StylistProfile = {
  id: string;
  name: string;
  firstName: string;
  level: StaffLevel | null;
  color: string | null;
  photoUrl: string | null;
  specialty: string;
  bio: string;
  portfolio: { path: string; url: string }[];
};

export function StylistProfileForm({ stylist: s }: { stylist: StylistProfile }) {
  const [specialty, setSpecialty] = useState(s.specialty);
  const [bio, setBio] = useState(s.bio);
  const [result, setResult] = useState<PageResult | null>(null);
  const [saving, start] = useTransition();
  useUnsavedChanges(specialty !== s.specialty || bio !== s.bio);
  return (
    <li className="flex flex-col gap-4 border-b border-line py-5 last:border-b-0" data-testid="stylist-profile">
      <h3 className="text-base font-semibold text-ink">{s.name}</h3>
      <div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className={labelClass}>
          <span>Portrait</span>
          <PhotoField
            label={`${s.firstName}'s portrait`}
            url={s.photoUrl}
            shape="h-28 w-22"
            empty={<Avatar name={s.name} color={s.color} level={s.level} size="lg" />}
            upload={(form) => uploadPortrait(s.id, form)}
            remove={() => removePortrait(s.id)}
          />
        </div>
        <form
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => setResult(await reach(saveProfile(s.id, { specialty, bio })).catch(() => ({ ok: false, message: "Couldn't save. Try again." }))));
          }}
        >
          <label className={labelClass}>
            Specialty
            <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} maxLength={SPECIALTY_MAX} placeholder="Lived-in color and balayage" className={fieldClass} />
          </label>
          <label className={labelClass}>
            Bio (optional)
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={BIO_MAX} rows={3} className={fieldClass} />
          </label>
          <Result result={result} />
          <div>
            <Button type="submit" variant="secondary" disabled={saving}>
              {saving ? "Saving…" : `Save ${s.firstName}'s profile`}
            </Button>
          </div>
        </form>
      </div>
      <div className={labelClass}>
        <span>Their work (up to {PORTFOLIO_MAX} photos)</span>
        <ul className="flex flex-wrap gap-3">
          {s.portfolio.map((p, i) => (
            <PortfolioPhoto key={p.path} label={`${s.firstName}'s work, photo ${i + 1}`} url={p.url} remove={() => removePortfolioPhoto(s.id, p.path)} />
          ))}
          {s.portfolio.length < PORTFOLIO_MAX && (
            <li>
              <PhotoField label={`a photo of ${s.firstName}'s work`} url={null} shape="size-24" empty="None yet" upload={(form) => addPortfolioPhoto(s.id, form)} remove={() => Promise.resolve({ ok: true, message: "" })} />
            </li>
          )}
        </ul>
      </div>
    </li>
  );
}

// One of their portfolio photos, with Remove.
function PortfolioPhoto({ label, url, remove }: { label: string; url: string; remove: () => Promise<PageResult> }) {
  const [result, setResult] = useState<PageResult | null>(null);
  const [busy, start] = useTransition();
  return (
    <li className="flex flex-col items-start gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="size-24 rounded-md border border-line bg-sunken object-cover" />
      <Button variant="quiet" size="sm" disabled={busy} onClick={() => start(async () => setResult(await reach(remove()).catch(() => ({ ok: false, message: "Couldn't remove it. Try again." }))))}>
        Remove<span className="sr-only"> {label}</span>
      </Button>
      {result && !result.ok && <Result result={result} />}
    </li>
  );
}

export function CategoryPhoto({ category, url }: { category: string; url: string | null }) {
  return (
    <PhotoField
      label={`Photo for ${category}`}
      url={url}
      shape="aspect-[5/2] w-56"
      empty="No photo"
      upload={(form) => uploadCategoryPhoto(category, form)}
      remove={() => removeCategoryPhoto(category)}
      testId="category-photo-field"
    />
  );
}

export function ServiceDescriptionsForm({ services }: { services: { id: string; name: string; category: string; description: string }[] }) {
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(services.map((s) => [s.id, s.description])));
  const [result, setResult] = useState<PageResult | null>(null);
  const [saving, start] = useTransition();
  const changed = services.filter((s) => texts[s.id] !== s.description);
  useUnsavedChanges(changed.length > 0);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () =>
          setResult(
            changed.length
              ? await reach(saveServiceDescriptions(changed.map((s) => ({ id: s.id, description: texts[s.id] })))).catch(() => ({ ok: false, message: "Couldn't save. Try again." }))
              : { ok: true, message: "Nothing has changed." },
          ),
        );
      }}
    >
      <ul className="flex flex-col gap-3">
        {services.map((s) => (
          <li key={s.id}>
            <label className={labelClass}>
              {s.name}
              <input
                value={texts[s.id]}
                onChange={(e) => setTexts((t) => ({ ...t, [s.id]: e.target.value }))}
                maxLength={SERVICE_DESCRIPTION_MAX}
                placeholder="What's included, in a short sentence"
                className={fieldClass}
              />
            </label>
          </li>
        ))}
      </ul>
      <Result result={result} />
      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save descriptions"}
        </Button>
      </div>
    </form>
  );
}
