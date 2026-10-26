"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageClientForm, type MessageChannels } from "@/app/calendar/message-client";
import { Button, buttonClass } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";

// The profile's actions, under the client's name: Book (a new booking for
// them on the calendar), Message (about their next visit), Check out
// (today's visit, or a sale for them) and Edit details. Each only for
// those who can.
export function QuickActions({
  firstName,
  bookHref,
  checkoutHref,
  editHref,
  message,
}: {
  firstName: string;
  bookHref: string | null;
  checkoutHref: string | null;
  editHref: string | null;
  // Messages are about an upcoming visit (`send_client_message`): the next
  // one, or why there's nothing to message about.
  message: { appointmentId: string; channels: MessageChannels; freeText: boolean } | { reason: string } | null;
}) {
  const [writing, setWriting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Client actions">
        {bookHref && (
          <Link href={bookHref} className={buttonClass("primary", "md")}>
            Book
          </Link>
        )}
        {message &&
          ("reason" in message ? (
            <Button disabled title={message.reason}>
              Message
            </Button>
          ) : (
            <Button
              onClick={() => {
                setSent(null);
                setWriting(true);
              }}
            >
              Message
            </Button>
          ))}
        {/* A route handler, so a plain link. */}
        {checkoutHref && (
          <a href={checkoutHref} className={buttonClass("secondary", "md")}>
            Check out
          </a>
        )}
        {editHref && (
          <Link href={editHref} className={buttonClass("secondary", "md")}>
            Edit details
          </Link>
        )}
      </div>
      {message && "reason" in message && <p className="text-13 text-ink-subtle">{message.reason}</p>}
      {sent && (
        <p role="status" className="animate-fade-in text-13 text-ink-muted">
          {sent}
        </p>
      )}
      {writing && message && !("reason" in message) && (
        <Sheet title={`Message ${firstName}`} onClose={() => setWriting(false)}>
          <div className="overflow-y-auto p-5">
            <MessageClientForm
              appointmentId={message.appointmentId}
              firstName={firstName}
              channels={message.channels}
              freeText={message.freeText}
              onSent={(text) => {
                setSent(text);
                setWriting(false);
              }}
              onCancel={() => setWriting(false)}
            />
          </div>
        </Sheet>
      )}
    </div>
  );
}
