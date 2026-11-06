"use server";

import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/auth";
import { decodeReport, readReport } from "@/lib/client-reports";
import { knownOf, loadReportMenu } from "@/lib/client-reports-load";
import { can } from "@/lib/permissions";

export type SaveState = { error: string } | null;

// Saves the report on screen under a name: the person's own, or shared
// with the salon by those with reports. Dates stay as words, so a saved
// report runs against the day it's opened.
export async function saveReport(_: SaveState, form: FormData): Promise<SaveState> {
  const { supabase, staff: me } = await getCurrentStaff();
  if (!me) return { error: "Sign in again to save it." };
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Give the report a name." };
  if (name.length > 80) return { error: "Keep the name to 80 characters." };
  const menu = await loadReportMenu(supabase, me.business_id);
  const { report } = readReport(decodeReport(String(form.get("r") ?? "")), knownOf(menu));
  const shared = form.get("shared") === "on" && can(me, "reports");
  const { data, error } = await supabase.from("saved_reports").insert({ business_id: me.business_id, staff_id: me.id, name, definition: report, shared }).select("id").single();
  if (error?.code === "23505") return { error: `You already have a report called “${name}”.` };
  if (error) throw error;
  redirect(`/clients/reports?saved=${data.id}`);
}

export async function removeReport(id: string): Promise<{ error: string } | null> {
  const { supabase } = await getCurrentStaff();
  const { data, error } = await supabase.from("saved_reports").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data.length) return { error: "That report is someone else's, or already removed." };
  redirect("/clients/reports");
}
