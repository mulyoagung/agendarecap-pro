"use client";

import { useState, useTransition } from "react";
import { AppSettings, saveAppSettings } from "@/app/actions/settings";
import { Reorder, motion } from "framer-motion";
import { GripVertical, Save, CheckCircle2, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";

interface SettingsFormProps {
  initialSettings?: Partial<AppSettings>;
}

const defaultShareOrder = [
  { id: "title", label: "Judul Agenda" },
  { id: "time", label: "Waktu" },
  { id: "location", label: "Lokasi" },
];

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [successMsg, setSuccessMsg] = useState("");

  const [appName, setAppName] = useState(initialSettings?.app_name || "AgendaRecap");
  const [appLogo, setAppLogo] = useState(initialSettings?.app_logo || "");
  const [isWatermark, setIsWatermark] = useState(initialSettings?.is_watermark_enabled ?? true);
  const [watermarkText, setWatermarkText] = useState(initialSettings?.watermark_text || "Dibuat oleh AgendaRecap Pro");
  
  // Reorder state
  const orderIds = initialSettings?.share_order || ["title", "time", "location"];
  const [shareOrder, setShareOrder] = useState(() => 
    orderIds.map((id) => defaultShareOrder.find((s) => s.id === id) || { id, label: id })
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg("");
    
    startTransition(async () => {
      const res = await saveAppSettings({
        app_name: appName,
        app_logo: appLogo || null,
        is_watermark_enabled: isWatermark,
        watermark_text: watermarkText,
        share_order: shareOrder.map((s) => s.id),
      });

      if (res.success) {
        setSuccessMsg("Pengaturan berhasil disimpan.");
        Swal.fire({
          icon: 'success',
          title: 'Tersimpan!',
          text: 'Pengaturan berhasil disimpan.',
          timer: 1500,
          showConfirmButton: false,
          toast: true,
          position: 'top-end'
        });
        router.refresh();
      } else {
        Swal.fire({ icon: 'error', title: 'Gagal', text: res.error });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {successMsg && (
        <div className="flex items-center gap-2 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-medium">{successMsg}</span>
        </div>
      )}

      {/* Basic Settings */}
      <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 space-y-6 shadow-xl">
        <h2 className="text-lg font-semibold border-b border-white/10 pb-4">Branding</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Nama Aplikasi</label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500/50 transition-all"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">URL Logo Aplikasi (Opsional)</label>
            <input
              type="url"
              value={appLogo}
              onChange={(e) => setAppLogo(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500/50 transition-all"
              placeholder="https://example.com/logo.png"
            />
            {appLogo && (
              <div className="mt-3">
                <img src={appLogo} alt="Logo Preview" className="h-10 object-contain rounded-md" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* WA Settings */}
      <div className="bg-[#121214] border border-white/5 rounded-2xl p-6 space-y-6 shadow-xl">
        <h2 className="text-lg font-semibold border-b border-white/10 pb-4">Format Berbagi WhatsApp</h2>
        
        {/* Reorder List */}
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-3">
            Urutan Informasi (Drag untuk memindahkan)
          </label>
          <Reorder.Group 
            axis="y" 
            values={shareOrder} 
            onReorder={setShareOrder}
            className="space-y-2"
          >
            {shareOrder.map((item) => (
              <Reorder.Item
                key={item.id}
                value={item}
                className="flex items-center gap-3 p-4 bg-white/5 border border-white/10 rounded-xl cursor-grab active:cursor-grabbing hover:bg-white/10 transition-colors"
              >
                <GripVertical className="text-zinc-500 w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>

        {/* Watermark Toggle */}
        <div className="pt-4 space-y-4">
          <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl">
            <div>
               <h3 className="font-medium text-white">Watermark Footer</h3>
               <p className="text-sm text-zinc-400 mt-1">Sertakan teks di akhir pesan WhatsApp</p>
            </div>
            <button
              type="button"
              onClick={() => setIsWatermark(!isWatermark)}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                isWatermark ? "bg-purple-500" : "bg-zinc-600"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  isWatermark ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          <motion.div
            initial={{ opacity: isWatermark ? 1 : 0, height: isWatermark ? "auto" : 0 }}
            animate={{ opacity: isWatermark ? 1 : 0, height: isWatermark ? "auto" : 0 }}
            className="space-y-2 overflow-hidden"
          >
            <label className="block text-sm font-medium text-zinc-400">Teks Watermark</label>
            <input
              type="text"
              value={watermarkText}
              onChange={(e) => setWatermarkText(e.target.value)}
              required={isWatermark}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500/50 transition-all"
            />
          </motion.div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-4 sticky bottom-6 z-10 p-4 bg-[#121214]/80 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl">
        <Link 
          href="/" 
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg hover:bg-white/10 transition-colors text-zinc-300 hover:text-white font-medium"
        >
          <ChevronLeft className="w-4 h-4" /> Kembali ke Beranda
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white rounded-lg font-medium shadow-lg shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {isPending ? "Menyimpan..." : "Simpan Pengaturan"}
        </button>
      </div>
    </form>
  );
}
