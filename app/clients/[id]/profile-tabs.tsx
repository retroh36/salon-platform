"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { PROFILE_TAB_COOKIE, type ProfileTab } from "@/lib/client-profile";

// The client's history in tabs: Visits · Formulas · Photos · Patch tests ·
// Forms. The tab last used is remembered on this device (a cookie the page
// reads, so the next profile opens on it without a flash).
export function ProfileTabs({ initial, tabs, panels }: { initial: ProfileTab; tabs: { value: ProfileTab; label: string; count?: number }[]; panels: Record<ProfileTab, React.ReactNode> }) {
  const [tab, setTab] = useState(initial);
  return (
    <section aria-label="History" className="mb-8">
      <Tabs
        label="Client history"
        quiet
        value={tab}
        onChange={(value) => {
          setTab(value);
          document.cookie = `${PROFILE_TAB_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
        }}
        tabs={tabs.map((t) => ({
          value: t.value,
          label: t.label,
          badge: t.count ? <span className="text-xs font-normal text-ink-subtle tabular-nums">{t.count}</span> : undefined,
        }))}
      >
        {panels[tab]}
      </Tabs>
    </section>
  );
}
