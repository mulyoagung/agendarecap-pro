"use client";

import { useStore, Agenda } from "@/store/useStore";
import { format, isSameDay } from "date-fns";
import { id } from "date-fns/locale";
import { Copy, Plus, Share2, CheckCircle2, Circle, Trash2, CalendarHeart, LogOut, MapPin, AlignLeft, Shield, Edit2, Settings } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { AddAgendaModal } from "@/components/AddAgendaModal";
import { Calendar } from "@/components/Calendar";
import { logout } from "./login/actions";
import { getAppSettings, AppSettings } from "@/app/actions/settings";
import { useEffect } from "react";

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingAgenda, setEditingAgenda] = useState<Agenda | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const { agendas, sharedDates, toggleComplete, deleteAgenda, markAsShared } = useStore();

  useEffect(() => {
    getAppSettings().then(setAppSettings);
  }, []);

  const selectedAgendas = agendas
    .filter((a) => isSameDay(new Date(a.scheduled_at), selectedDate))
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  const [isCopied, setIsCopied] = useState(false);

  const generateMessage = async () => {
    const dateKey = format(selectedDate, "yyyy-MM-dd");
    const firstSharedAtStr = sharedDates[dateKey];
    
    // Cari waktu update terakhir dari semua agenda di tanggal ini
    const latestUpdateStr = selectedAgendas.reduce((latest, current) => {
      return current.updated_at > latest ? current.updated_at : latest;
    }, "");

    const formatTanggal = (date: Date) => {
      const formatted = new Intl.DateTimeFormat('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(new Date(date));
      return formatted.toLowerCase().replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());
    };

    const dateTitle = formatTanggal(selectedDate);
    
    // Jika pernah dibagikan sebelumnya, dan ada agenda yang diupdate SETELAH dibagikan pertama kali
    const isUpdate = Boolean(firstSharedAtStr && latestUpdateStr > firstSharedAtStr);
    
    // Gunakan waktu update terbaru sebagai patokan jam "Pembaruan pada..." jika ada,
    // Jika belum pernah diupdate, pakai waktu sekarang.
    const updateTimeObj = latestUpdateStr ? new Date(latestUpdateStr) : new Date();
    const updateTimeStr = format(updateTimeObj, "HH:mm");
    
    const { getAppSettings } = await import("@/app/actions/settings");
    const { formatAgendasToWhatsApp } = await import("@/lib/whatsapp-formatter");
    
    const settings = await getAppSettings();

    return formatAgendasToWhatsApp(
      dateTitle,
      isUpdate,
      updateTimeStr,
      selectedAgendas,
      settings
    );
  };

  const handleShare = async () => {
    const fullMessage = await generateMessage();
    
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const waLink = isMobile
      ? `whatsapp://send?text=${encodeURIComponent(fullMessage)}`
      : `https://web.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`;
    
    const dateKey = format(selectedDate, "yyyy-MM-dd");
    markAsShared(dateKey, new Date().toISOString());
    window.open(waLink, "_blank");
  };

  const handleCopy = async () => {
    const fullMessage = await generateMessage();
    try {
      await navigator.clipboard.writeText(fullMessage);
      setIsCopied(true);
      
      const dateKey = format(selectedDate, "yyyy-MM-dd");
      markAsShared(dateKey, new Date().toISOString());
      
      setTimeout(() => setIsCopied(false), 2000);
      alert("Rekap berhasil disalin!");
    } catch (e) {
      alert("Gagal menyalin teks.");
    }
  };

  const handleEdit = (agenda: Agenda) => {
    setEditingAgenda(agenda);
    setIsAddModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    // Give time for animation before clearing edit state
    setTimeout(() => setEditingAgenda(null), 300);
  };

  // Convert map to specific Date objects 
  const agendaDates = agendas.map(a => new Date(a.scheduled_at));

  return (
    <main className="min-h-screen relative overflow-hidden bg-background">
      {/* Background Ornaments */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/20 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto p-4 sm:p-8 flex flex-col lg:flex-row gap-8">
        
        {/* Left Column: Navigation & Calendar (Control Center) */}
        <aside className="w-full lg:w-[400px] shrink-0 flex flex-col gap-6">
          <header className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {appSettings?.app_logo ? (
                  <img src={appSettings.app_logo} alt="Logo" className="w-12 h-12 rounded-2xl shadow-lg object-cover bg-white/5" />
                ) : (
                  <div className="p-2.5 bg-gradient-to-tr from-purple-500 to-indigo-500 rounded-2xl shadow-lg shadow-purple-500/20">
                    <CalendarHeart className="w-6 h-6 text-white" />
                  </div>
                )}
                <div>
                  <h1 className="text-xl font-bold text-white">
                    {appSettings?.app_name || "AgendaRecap Pro"}
                  </h1>
                  <p className="text-xs text-zinc-400 font-medium tracking-wide">PRIVATE DASHBOARD</p>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col gap-2">
              <Link 
                href="/admin"
                className="flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-colors text-zinc-300 hover:text-white"
              >
                <Shield className="w-5 h-5 text-blue-400" />
                <span className="font-medium text-sm">Kelola User (Admin)</span>
              </Link>
              <Link 
                href="/settings"
                className="flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl transition-colors text-zinc-300 hover:text-white"
              >
                <Settings className="w-5 h-5 text-purple-400" />
                <span className="font-medium text-sm">Pengaturan Aplikasi</span>
              </Link>
              <button 
                onClick={() => logout()}
                className="flex items-center gap-3 px-4 py-3 bg-white/5 hover:bg-red-400/10 border border-white/5 rounded-xl transition-colors text-zinc-400 hover:text-red-400"
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium text-sm">Keluar dari Akun</span>
              </button>
            </div>
          </header>

          <div className="glass rounded-[2rem] p-4 flex justify-center shadow-xl shadow-black/20 border border-white/5 overflow-hidden">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => d && setSelectedDate(d)}
              className="bg-transparent border-0 w-full flex justify-center p-0"
              modifiers={{
                hasAgenda: agendaDates
              }}
              modifiersClassNames={{
                hasAgenda: "hasAgenda"
              }}
            />
          </div>
        </aside>

        {/* Right Column: Time-Slot Visualizer & Details */}
        <section className="flex-1 min-w-0 pb-32 md:pb-0">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 glass p-6 rounded-[2rem] border border-white/5 shadow-xl">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">
                {format(selectedDate, "EEEE, d MMMM yyyy", { locale: id })}
              </h2>
              <p className="text-zinc-400 text-sm">
                {selectedAgendas.length > 0 
                  ? `Terdapat ${selectedAgendas.length} agenda di tanggal ini.` 
                  : "Tidak ada jadwal untuk tanggal ini."}
              </p>
            </div>
            
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={handleCopy}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20 px-4 py-2.5 rounded-xl font-semibold transition-all active:scale-95"
              >
                {isCopied ? <CheckCircle2 className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4 text-white" />}
                <span className="text-sm">{isCopied ? "Tersalin!" : "Copy"}</span>
              </button>
              <button
                onClick={handleShare}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 px-4 py-2.5 rounded-xl font-semibold transition-all active:scale-95"
              >
                <Share2 className="w-4 h-4 text-white" />
                <span className="text-sm">Share WA</span>
              </button>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg shadow-purple-500/20 px-4 py-2.5 rounded-xl font-semibold transition-all hover:opacity-90 active:scale-95 border-0"
              >
                <Plus className="w-4 h-4 text-white" />
                <span className="text-sm shrink-0">Tambah Baru</span>
              </button>
            </div>
          </div>

          <div className="glass rounded-[2rem] border border-white/5 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-6 py-4 font-semibold text-zinc-400 text-sm w-16 text-center">No</th>
                    <th className="px-6 py-4 font-semibold text-zinc-400 text-sm w-24">Waktu</th>
                    <th className="px-6 py-4 font-semibold text-zinc-400 text-sm w-16 text-center">Status</th>
                    <th className="px-6 py-4 font-semibold text-zinc-400 text-sm">Detail Agenda</th>
                    <th className="px-6 py-4 font-semibold text-zinc-400 text-sm text-right w-32">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {selectedAgendas.length > 0 ? (
                      selectedAgendas.map((agenda, index) => (
                        <motion.tr
                          layout
                          key={agenda.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={cn(
                            "border-b border-white/5 transition-colors hover:bg-white/[0.02]",
                            agenda.is_completed ? "opacity-70" : ""
                          )}
                        >
                          <td className="px-6 py-5 text-center text-zinc-500 font-medium">
                            {index + 1}
                          </td>
                          <td className="px-6 py-5 text-white font-semibold">
                            {format(new Date(agenda.scheduled_at), "HH:mm")}
                          </td>
                          <td className="px-6 py-5">
                            <button
                              onClick={() => toggleComplete(agenda.id)}
                              className="mx-auto block shrink-0 transition-transform active:scale-75"
                            >
                              {agenda.is_completed ? (
                                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                              ) : (
                                <Circle className="w-6 h-6 text-zinc-500 hover:text-purple-400 transition-colors" />
                              )}
                            </button>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex flex-col gap-1 min-w-[200px]">
                              <p className={cn(
                                "font-semibold text-base transition-colors",
                                agenda.is_completed ? "text-zinc-400 line-through" : "text-white"
                              )}>
                                {agenda.title}
                              </p>
                              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                                <MapPin className="w-3 h-3 text-purple-400" />
                                <span>{agenda.location}</span>
                              </div>
                              {agenda.notes && !agenda.is_completed && (
                                <div className="mt-2 text-sm text-zinc-400 border-l-[3px] border-white/10 pl-3">
                                  {agenda.notes}
                                </div>
                              )}
                              {agenda.include_notes_in_share && agenda.notes && !agenda.is_completed && (
                                <span className="text-[10px] text-emerald-400/80 uppercase font-bold tracking-wider mt-1 flex items-center gap-1">
                                  <Share2 className="w-3 h-3" /> Included in Share
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex items-center justify-end gap-2 text-right">
                              <button
                                onClick={() => handleEdit(agenda)}
                                className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors border border-transparent hover:border-blue-400/20"
                                title="Edit Agenda"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => deleteAgenda(agenda.id)}
                                className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors border border-transparent hover:border-red-400/20"
                                title="Hapus Agenda"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="py-24 text-center">
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center max-w-sm mx-auto"
                          >
                            <CalendarHeart className="w-12 h-12 text-zinc-600 mb-4" />
                            <h3 className="text-lg text-zinc-400 font-semibold mb-1">Meja Kerja Kosong</h3>
                            <p className="text-zinc-500 text-sm">
                              Gunakan tombol "Tambah Item" di ujung kanan atas untuk membuat jadwal baru di tabel ini.
                            </p>
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <AddAgendaModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        defaultDate={selectedDate || new Date()}
        editAgenda={editingAgenda}
      />

    </main>
  );
}
