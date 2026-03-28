"use server";

import { createClient } from "@/lib/supabase/server";

export interface AppSettings {
  id?: string;
  user_id?: string;
  app_name: string;
  app_logo: string | null;
  share_order: string[];
  is_watermark_enabled: boolean;
  watermark_text: string;
}

export async function getAppSettings() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error("Error fetching app settings:", error);
    return null;
  }

  return data as AppSettings | null;
}

export async function saveAppSettings(settings: Partial<AppSettings>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  // Check if settings exist
  const existing = await getAppSettings();

  if (existing) {
    const { error } = await supabase
      .from("app_settings")
      .update({ ...settings })
      .eq("user_id", user.id);

    if (error) {
      console.error("Error updating settings:", error);
      return { success: false, error: error.message };
    }
  } else {
    // Insert with defaults, overlapping with provided settings
    const defaultSettings = {
      user_id: user.id,
      app_name: 'AgendaRecap',
      share_order: ['title', 'time', 'location'],
      is_watermark_enabled: true,
      watermark_text: 'Dibuat oleh AgendaRecap Pro',
    };

    const { error } = await supabase
      .from("app_settings")
      .insert({ ...defaultSettings, ...settings });

    if (error) {
      console.error("Error inserting settings:", error);
      return { success: false, error: error.message };
    }
  }

  return { success: true };
}
