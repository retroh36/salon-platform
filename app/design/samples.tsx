"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { Tabs } from "@/components/ui/tabs";

// The style guide's interactive pieces: tabs (both kinds) and a segmented
// control, working, with nothing saved.
export function TabSamples() {
  const [tab, setTab] = useState<"notes" | "formula" | "history">("notes");
  const [panel, setPanel] = useState<"details" | "denise">("details");
  const [view, setView] = useState<"day" | "week">("day");
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="flex flex-col gap-2">
        <span className="text-13 font-medium text-ink-muted">Panel tabs</span>
        <div className="flex h-36 flex-col">
          <Tabs
            label="Panel"
            value={panel}
            onChange={setPanel}
            tabs={[
              { value: "details", label: "Details" },
              { value: "denise", label: "Denise" },
            ]}
          >
            <p className="p-3 text-ink-muted">{panel === "details" ? "Booking details." : "Denise's panel."}</p>
          </Tabs>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-13 font-medium text-ink-muted">Quiet tabs</span>
        <Tabs
          label="Section"
          quiet
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "notes", label: "Notes" },
            { value: "formula", label: "Formula" },
            { value: "history", label: "History" },
          ]}
        >
          <p className="text-ink-muted">The {tab} tab.</p>
        </Tabs>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-13 font-medium text-ink-muted">Segmented</span>
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
          ]}
        />
      </div>
    </div>
  );
}
