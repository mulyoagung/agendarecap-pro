"use server";

import { createClient } from "@/lib/supabase/server";

export async function getAgendasByMonth(year: number, month: number) {
  const supabase = await createClient();
  
  // month is 1-indexed (1 = Jan, 12 = Dec)
  const startDate = new Date(year, month - 1, 1).toISOString();
  // End date is 1st of next month
  const endDate = new Date(year, month, 1).toISOString();

  const { data, error } = await supabase
    .from("agendas")
    .select("*")
    .gte("scheduled_at", startDate)
    .lt("scheduled_at", endDate)
    .order("scheduled_at", { ascending: true });

  if (error) {
    console.error("Error fetching agendas by month:", error);
    return [];
  }

  return data;
}

export async function getAgendasByDate(dateString: string) {
  const supabase = await createClient();
  
  // dateString is expected to be YYYY-MM-DD
  const startDate = new Date(dateString);
  startDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(dateString);
  endDate.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("agendas")
    .select("*")
    .gte("scheduled_at", startDate.toISOString())
    .lte("scheduled_at", endDate.toISOString())
    .order("scheduled_at", { ascending: true });

  if (error) {
    console.error("Error fetching agendas by date:", error);
    return [];
  }

  return data;
}

export async function updateAgenda(agendaId: string, updates: any) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  // Mencegah overwrite 'created_at' dan pastikan data aman
  const { created_at, id, user_id, ...safeUpdates } = updates;

  // Jika scheduled_at ikut diupdate, pastikan formatnya valid ISO
  if (safeUpdates.scheduled_at && !Date.parse(safeUpdates.scheduled_at)) {
     return { success: false, error: "Invalid scheduled_at format" };
  }

  const { data, error } = await supabase
    .from("agendas")
    .update({
      ...safeUpdates,
      updated_at: new Date().toISOString()
    })
    .eq("id", agendaId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    console.error("Error updating agenda:", error);
    return { success: false, error: error.message };
  }

  return { success: true, data };
}
