import { STATUS_LABELS, type AppointmentStatus } from "@/lib/appointments";

const STYLES: Record<AppointmentStatus, string> = {
  booked: "bg-status-booked-bg text-status-booked-ink",
  confirmed: "bg-status-confirmed-bg text-status-confirmed-ink",
  checked_in: "bg-status-checked-in-bg text-status-checked-in-ink",
  completed: "bg-status-completed-bg text-status-completed-ink",
  canceled: "bg-status-no-show-bg text-status-no-show-ink",
  no_show: "bg-status-no-show-bg text-status-no-show-ink",
};

// Just the status color, for blocks too narrow for the label (the label
// is still in the block's accessible name).
export function StatusDot({ status, className = "" }: { status: AppointmentStatus; className?: string }) {
  return <span aria-hidden data-status={status} title={STATUS_LABELS[status]} className={`inline-block size-2.5 shrink-0 rounded-full ring-1 ring-surface ${STYLES[status]} ${className}`} style={{ backgroundColor: "currentColor" }} />;
}

const DOTS: Record<AppointmentStatus, string> = {
  booked: "bg-neutral-dot",
  confirmed: "bg-success-dot",
  checked_in: "bg-info-dot",
  completed: "bg-neutral-dot",
  canceled: "bg-danger-dot",
  no_show: "bg-danger-dot",
};

// The status as a small tag: a dot and the label (the Badge look).
export function StatusChip({ status, size = "md", className = "" }: { status: AppointmentStatus; size?: "sm" | "md"; className?: string }) {
  const sizes = { sm: "h-4 gap-1 px-1 text-[11px] leading-4", md: "h-5 gap-1.5 px-1.5 text-xs leading-5" };
  return (
    <span data-status={status} className={`inline-flex shrink-0 items-center rounded-sm font-medium whitespace-nowrap ${sizes[size]} ${STYLES[status]} ${className}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOTS[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}
