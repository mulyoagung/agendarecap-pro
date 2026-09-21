"use client";

import { useEffect, useState } from "react";
import { AppSettings, getAppSettings } from "@/app/actions/settings";
import { SettingsForm } from "./SettingsForm";
import { createClient } from "@/lib/supabase/client";
import { isNativePlatform } from "@/lib/native-alarm";

export default function SettingsPage() {
  const [initialSettings, setInitialSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (isNativePlatform()) {
            window.location.replace("/login.html");
          } else {
            window.location.href = "/login";
          }
          return;
        }

        const { data: profile } = await supabase.from('profiles').select('status').eq('id', user.id).single();
        if (profile?.status === 'pending') {
          if (isNativePlatform()) {
            window.location.replace("/waiting-approval.html");
          } else {
            window.location.href = "/waiting-approval";
          }
          return;
        }

        const settings = await getAppSettings();
        setInitialSettings(settings);
      } catch (err) {
        console.error("Error loading settings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#09090b] text-white p-6 md:p-12 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#09090b] text-white p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            Pengaturan Aplikasi
          </h1>
          <p className="text-zinc-400 mt-2 text-sm">
            Sesuaikan tampilan dan format berbagi (WhatsApp) untuk AgendaRecap Anda.
          </p>
        </div>
        <SettingsForm initialSettings={initialSettings || undefined} />
      </div>
    </main>
  );
}
