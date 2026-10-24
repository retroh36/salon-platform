"use client";

import { useState, useTransition } from "react";
import { setCalendarOrder } from "@/app/calendar/view-actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";
import { ReorderList } from "@/components/ui/reorder-list";
import type { StaffLevel } from "@/lib/schedule-forms";

type Member = {
  id: string;
  name: string;
  detail?: string;
  color: string | null;
  level: StaffLevel | null;
};

export function OrderForm({ team }: { team: Member[] }) {
  const [order, setOrder] = useState(team.map((m) => m.id));
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [pending, run] = useTransition();
  const byId = new Map(team.map((m) => [m.id, m]));
  const changed = order.some((id, i) => id !== team[i]?.id);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <ReorderList
        label="Calendar order"
        onChange={(ids) => {
          setOrder(ids);
          setResult(null);
        }}
        items={order.map((id) => {
          const m = byId.get(id)!;
          return {
            id,
            label: m.name,
            detail: m.detail,
            leading: (
              <Avatar name={m.name} color={m.color} level={m.level} size="sm" />
            ),
          };
        })}
      />
      {/* Kept in reach below a long list. */}
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-3 bg-canvas px-1 py-3">
        {result && (
          <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>
        )}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={pending || !changed}
            onClick={() =>
              run(async () => {
                const r = await setCalendarOrder(order);
                setResult(
                  r.ok
                    ? {
                        ok: true,
                        message:
                          "Saved. The calendar shows stylists in this order.",
                      }
                    : { ok: false, message: r.message ?? "That didn't save." },
                );
              })
            }
          >
            {pending ? "Saving…" : "Save order"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending || !changed}
            onClick={() => setOrder(team.map((m) => m.id))}
          >
            Undo changes
          </Button>
        </div>
      </div>
    </div>
  );
}
