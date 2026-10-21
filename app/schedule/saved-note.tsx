import { CheckCircleIcon } from "@/components/ui/icons";

// The "Saved." confirmation next to a form's save button.
export function SavedNote({ children }: { children: React.ReactNode }) {
  return (
    <span role="status" className="inline-flex animate-fade-in items-center gap-1.5 text-sm font-medium text-status-confirmed-ink">
      <CheckCircleIcon className="size-4" />
      {children}
    </span>
  );
}
