"use client";

import { cloneElement, startTransition, useId, type ReactElement } from "react";

export const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500";

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
    <div className={`flex flex-col gap-1 text-sm font-medium ${className}`}>
      <label htmlFor={id}>
        {label}
        {hint && <span className="ml-1 font-normal text-neutral-500">· {hint}</span>}
      </label>
      {cloneElement(children, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })}
      {error && (
        <span id={errorId} className="font-normal text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
