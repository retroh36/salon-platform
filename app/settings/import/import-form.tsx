"use client";

// Upload a CSV, check which column is which, see what will happen, import.
// The file is read in the browser and sent in batches.

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelClass, selectClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { TableCard, tableClass, tdClass, thClass, theadClass, trClass } from "@/components/ui/table";
import { FIELD_LABELS, guessColumns, IMPORT_BATCH, IMPORT_FIELDS, MAX_IMPORT_ROWS, parseCsv, planImport, PROBLEM_TEXT, type ColumnMap, type ImportField, type ImportProblem } from "@/lib/client-import";
import { importBatch, undoImport } from "./actions";

const MAX_BYTES = 20 * 1024 * 1024;
const FIRST_ROWS = 5;

type Loaded = { name: string; headers: string[]; data: string[][] };

export function ImportForm() {
  const [file, setFile] = useState<Loaded | null>(null);
  const [columns, setColumns] = useState<ColumnMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const plan = useMemo(() => (file && columns ? planImport(file.data, columns) : null), [file, columns]);

  const choose = async (picked: File | undefined) => {
    setError(null);
    setDone(null);
    setFile(null);
    if (!picked) return;
    if (picked.size > MAX_BYTES) return setError("That file is over 20 MB.");
    const [headers, ...data] = parseCsv(await picked.text());
    if (!headers || !data.length) return setError("That file has no rows to import. Check it's a CSV with a header row.");
    if (data.length > MAX_IMPORT_ROWS) return setError(`That file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows.`);
    setFile({ name: picked.name, headers, data });
    setColumns(guessColumns(headers));
  };

  const run = () =>
    start(async () => {
      if (!plan || !file) return;
      setError(null);
      let importId: string | null = null;
      let added = 0;
      let skipped = 0;
      for (let i = 0; i < plan.rows.length; i += IMPORT_BATCH) {
        setProgress(`Importing ${Math.min(i + IMPORT_BATCH, plan.rows.length).toLocaleString("en-US")} of ${plan.rows.length.toLocaleString("en-US")}…`);
        const r: Awaited<ReturnType<typeof importBatch>> = await importBatch(importId, file.name, plan.rows.slice(i, i + IMPORT_BATCH));
        if (!r.ok) {
          setProgress(null);
          return setError(r.message);
        }
        importId = r.importId;
        added += r.added;
        skipped += r.skipped;
      }
      setProgress(null);
      setFile(null);
      setDone(`Added ${added.toLocaleString("en-US")} clients. ${skipped.toLocaleString("en-US")} were already here and were left as they are.`);
    });

  const named = plan && columns && (columns.first_name !== null || columns.full_name !== null);
  const problems = plan ? (Object.keys(plan.problems) as ImportProblem[]).filter((p) => plan.problems[p].length) : [];
  return (
    <div className="flex flex-col gap-4">
      <label className={`${labelClass} max-w-md`}>
        CSV file
        <input type="file" accept=".csv,text/csv" className={fieldClass} onChange={(e) => void choose(e.target.files?.[0])} />
      </label>
      {done && (
        <p role="status" className="text-sm text-ink-muted">
          {done}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {file && columns && plan && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="import-columns">
            {IMPORT_FIELDS.map((f: ImportField) => (
              <label key={f} className={labelClass}>
                {FIELD_LABELS[f]}
                <select value={columns[f] ?? ""} onChange={(e) => setColumns({ ...columns, [f]: e.target.value === "" ? null : Number(e.target.value) })} className={selectClass}>
                  <option value="">None</option>
                  {file.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {!named && <Alert>Choose the column with their first name or full name.</Alert>}
          {named && (
            <>
              <p className="text-sm text-ink" data-testid="import-summary">
                {plan.rows.length.toLocaleString("en-US")} clients to import, of {file.data.length.toLocaleString("en-US")} rows. Anyone already here with the same phone or email is left as they are.
              </p>
              {problems.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-ink-muted" data-testid="import-problems">
                  {problems.map((p) => (
                    <li key={p}>
                      {plan.problems[p].length} with {PROBLEM_TEXT[p]} (row {plan.problems[p].slice(0, FIRST_ROWS).join(", ")}
                      {plan.problems[p].length > FIRST_ROWS ? ", and more" : ""})
                    </li>
                  ))}
                </ul>
              )}
              <TableCard>
                <table className={tableClass}>
                  <thead className={theadClass}>
                    <tr>
                      {["First name", "Last name", "Phone", "Email"].map((h) => (
                        <th key={h} className={thClass}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.slice(0, FIRST_ROWS).map((r, i) => (
                      <tr key={i} className={trClass}>
                        <td className={tdClass}>{r.first_name}</td>
                        <td className={tdClass}>{r.last_name}</td>
                        <td className={tdClass}>{r.phone}</td>
                        <td className={tdClass}>{r.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
              <div className="flex items-center gap-3">
                <Button variant="primary" disabled={pending || !plan.rows.length} onClick={run}>
                  Import {plan.rows.length.toLocaleString("en-US")} clients
                </Button>
                {progress && <span className="text-sm text-ink-muted">{progress}</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function UndoImport({ id, added }: { id: string; added: number }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (message) return <span className="text-sm text-ink-muted">{message}</span>;
  if (!asking)
    return (
      <Button size="sm" variant="quiet" onClick={() => setAsking(true)}>
        Undo
      </Button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink">Remove these {added.toLocaleString("en-US")} clients?</span>
      <Button size="sm" variant="danger" disabled={pending} onClick={() => start(async () => setMessage((await undoImport(id)).message))}>
        Yes, remove
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setAsking(false)}>
        Keep them
      </Button>
    </span>
  );
}
