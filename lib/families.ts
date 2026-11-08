// Families: clients linked into a household, each still their own client
// (families, clients.family_id; migration …_families.sql). Read with the
// person's own login, so RLS decides which members they see.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

type Supabase = SupabaseClient<Database>;

export type FamilyMember = { id: string; firstName: string; lastName: string };
export type Family = { id: string; name: string; payerId: string | null; members: FamilyMember[] };

export const MAX_FAMILY = 12;

export async function loadFamily(supabase: Supabase, familyId: string | null): Promise<Family | null> {
  if (!familyId) return null;
  const [family, members] = await Promise.all([
    supabase.from("families").select("id, name, payer_client_id").eq("id", familyId).maybeSingle(),
    supabase.from("clients").select("id, first_name, last_name").eq("family_id", familyId).order("first_name"),
  ]);
  if (family.error) throw family.error;
  if (members.error) throw members.error;
  if (!family.data) return null;
  return {
    id: family.data.id,
    name: family.data.name,
    payerId: family.data.payer_client_id,
    members: members.data.map((m) => ({ id: m.id, firstName: m.first_name, lastName: m.last_name })),
  };
}

// "The Parks": a name to start from, from the client's last name.
export function suggestedName(lastName: string): string {
  const last = lastName.trim();
  if (!last) return "";
  return `The ${/(s|x|z|ch|sh)$/i.test(last) ? `${last}es` : `${last}s`}`;
}

// Why save_family refused, in our words.
export function familyProblem(error: { message: string; hint?: string | null; code?: string }): string {
  if (error.hint === "name") return "Give the family a name.";
  if (error.hint === "members") return `A family has 2 to ${MAX_FAMILY} people.`;
  if (error.hint === "payer") return "Who usually pays must be in the family.";
  if (error.hint === "other_family") return `${error.message}. Take them out of it first.`;
  if (error.code === "P0002") return "That client or family no longer exists.";
  return "The family couldn't be saved. Try again.";
}
