"use client";

import { useState } from "react";
import { FillForm } from "@/app/clients/[id]/forms/fill-form";
import type { LinkForm } from "@/lib/form-links";
import { pageLead, pageTitle } from "@/app/book/[slug]/styles";
import { signFormFromLink } from "./actions";

// The forms on a link, one after another; then a thank-you.
export function LinkForms({ token, firstName, salon, forms }: { token: string; firstName: string; salon: string; forms: LinkForm[] }) {
  const [signed, setSigned] = useState(() => new Set(forms.filter((f) => f.signed).map((f) => f.id)));
  const next = forms.find((f) => !signed.has(f.id));
  if (!next)
    return (
      <div data-testid="forms-done">
        <h1 className={pageTitle}>Thank you, {firstName}</h1>
        <p className={pageLead}>{salon} has your {forms.length === 1 ? "form" : "forms"}. See you soon.</p>
      </div>
    );
  const at = forms.indexOf(next) + 1;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-ink">{next.name}</h2>
        {forms.length > 1 && (
          <p className="text-sm text-ink-muted">
            Form {at} of {forms.length}
          </p>
        )}
      </div>
      <FillForm
        key={next.id}
        clientId=""
        clientName={firstName}
        template={next}
        back=""
        submit={(answers, signature) => signFormFromLink(token, next.id, answers, signature)}
        onSigned={() => setSigned((s) => new Set(s).add(next.id))}
      />
    </div>
  );
}
