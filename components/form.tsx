"use client";

import { cloneElement, startTransition, useId, type ReactElement } from "react";
import { fieldClass } from "@/components/ui/field";

// The shared field look (components/ui/field.tsx), for existing forms.
export const inputClass = fieldClass;

// React resets a form after its action runs, and a reset doesn't reliably
// restore every control (selects and checkboxes can lose the submitted
// choice). Submitting from onSubmit skips the reset, so after an error the
// form stays exactly as the user left it. `action` stays on the form so it
// still works without JavaScript.
export function submitWithoutReset(action: (formData: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
}

type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean };

// A labelled control. The label points at the control (rather than wrapping
// it) so its accessible name is just the label, and errors are announced
// with the control.
export function Field({
  label,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactElement<ControlProps>;
}) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className={`flex flex-col gap-1.5 text-sm font-medium text-ink ${className}`}>
      <label htmlFor={id}>
        {label}
        {hint && <span className="ml-1 font-normal text-ink-muted">· {hint}</span>}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })}
      {error && (
        <span id={errorId} className="animate-fade-in font-normal text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
