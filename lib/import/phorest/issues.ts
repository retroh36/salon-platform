// Mapping problems, recorded without values: only which entity, which field
// and why. The type has no place for a value, so a report built from it
// can't leak client data.

export type IssueKind =
  | "skipped" // the record wasn't imported
  | "adjusted" // imported, with this field changed
  | "dropped" // imported, without this field
  | "review"; // imported, but someone should check it

export type Issue = { entity: string; field: string; reason: string; kind: IssueKind };

export class IssueLog {
  private counts = new Map<string, { issue: Issue; count: number }>();

  add(entity: string, field: string, kind: IssueKind, reason: string) {
    const key = `${entity}\u0000${field}\u0000${kind}\u0000${reason}`;
    const entry = this.counts.get(key);
    if (entry) entry.count++;
    else this.counts.set(key, { issue: { entity, field, reason, kind }, count: 1 });
  }

  list(): (Issue & { count: number })[] {
    return [...this.counts.values()]
      .map(({ issue, count }) => ({ ...issue, count }))
      .sort((a, b) => a.entity.localeCompare(b.entity) || b.count - a.count || a.field.localeCompare(b.field) || a.reason.localeCompare(b.reason));
  }
}
