"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, textLinkClass } from "@/components/ui/page";
import { markNoticesRead } from "@/app/my-day/actions";

export function ForYouList({ notices, audit }: { notices: { id: string; body: string; when: string }[]; audit: boolean }) {
  const [shown, setShown] = useState(notices);
  const [pending, start] = useTransition();
  if (!shown.length) return null;
  return (
    <Card title="For you" titleId="for-you-heading" data-testid="for-you">
      <ul className="flex flex-col gap-2 text-sm text-ink" aria-label="Notices for you">
        {shown.map((n) => (
          <li key={n.id}>
            {n.body} <span className="text-13 whitespace-nowrap text-ink-muted">{n.when}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await markNoticesRead(shown.map((n) => n.id));
              setShown([]);
            })
          }
        >
          Got it
        </Button>
        {audit && (
          <Link href="/audit" className={textLinkClass}>
            Audit trail
          </Link>
        )}
      </div>
    </Card>
  );
}
