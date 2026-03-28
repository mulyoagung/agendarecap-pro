import { getAppSettings } from "@/app/actions/settings";
import { SettingsForm } from "./SettingsForm";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const { cookies } = await import("next/headers");
  const dummyAuth = (await cookies()).get("dummy_auth")?.value === "true";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !dummyAuth) {
    redirect("/login");
  }

  if (user) {
    const { data: profile } = await supabase.from('profiles').select('status').eq('id', user.id).single();
    if (profile?.status === 'pending') {
      redirect("/waiting-approval");
    }
  }

  const initialSettings = await getAppSettings();

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
