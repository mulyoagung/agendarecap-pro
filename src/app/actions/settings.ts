

import { createClient } from "@/lib/supabase/client";

export interface AppSettings {
  id?: string;
  user_id?: string;
  app_name: string;
  app_logo: string | null;
  share_order: string[];
  is_watermark_enabled: boolean;
  watermark_text: string;
}

export async function getAppSettings(): Promise<AppSettings | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const { data, error } = await supabase
      .from("app_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Error fetching app settings:", error);
      return null;
    }

    if (!data) return null;

    // Sanitize share_order to guarantee it is string[]
    let validShareOrder: string[] = ["title", "time", "location"];
    if (Array.isArray(data.share_order)) {
      const filtered = data.share_order.filter((item: any) => typeof item === "string");
      if (filtered.length > 0) {
        validShareOrder = filtered;
      }
    }

    return {
      ...data,
      share_order: validShareOrder
    } as AppSettings;
  } catch (e) {
    console.error("Failed to getAppSettings:", e);
    return null;
  }
}

export async function saveAppSettings(settings: Partial<AppSettings>) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Unauthorized" };
    }

    // Check if settings exist
    const existing = await getAppSettings();

    // Sanitize share_order if provided
    let shareOrderToSave = settings.share_order;
    if (shareOrderToSave && Array.isArray(shareOrderToSave)) {
      shareOrderToSave = shareOrderToSave.filter((item: any) => typeof item === "string");
    }

    const payload = {
      ...settings,
      ...(shareOrderToSave ? { share_order: shareOrderToSave } : {})
    };

    if (existing) {
      const { error } = await supabase
        .from("app_settings")
        .update(payload)
        .eq("user_id", user.id);

      if (error) {
        console.error("Error updating settings:", error);
        return { success: false, error: error.message };
      }
    } else {
      const defaultSettings = {
        user_id: user.id,
        app_name: 'AgendaRecap',
        share_order: ['title', 'time', 'location'],
        is_watermark_enabled: true,
        watermark_text: 'Dibuat oleh AgendaRecap Pro',
      };

      const { error } = await supabase
        .from("app_settings")
        .insert({ ...defaultSettings, ...payload });

      if (error) {
        console.error("Error inserting settings:", error);
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Failed to save settings" };
  }
}
