"use client";

import { useStore, Agenda } from "@/store/useStore";
import { format, isSameDay } from "date-fns";
import { id } from "date-fns/locale";
import { Copy, Plus, Share2, CheckCircle2, Circle, Trash2, CalendarHeart, LogOut, MapPin, AlignLeft, Shield, Edit2, Settings, CalendarDays, CalendarRange, ChevronDown, FileDown, X, Video, Link2, Archive, BellRing, Menu, Download } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import Swal from "sweetalert2";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { AddAgendaModal } from "@/components/AddAgendaModal";
import { ExportAgendaModal } from "@/components/ExportAgendaModal";
import { Calendar } from "@/components/Calendar";
import { MonthlyCalendarView } from "@/components/MonthlyCalendarView";
import { logout } from "./login/actions";
import { getAppSettings, AppSettings } from "@/app/actions/settings";
import { useEffect } from "react";
import ConnectivityBanner from "@/components/ConnectivityBanner";
import { isNativePlatform, navigateNative } from "@/lib/native-alarm";

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCopyDropdownOpen, setIsCopyDropdownOpen] = useState(false);
  const [isShareDropdownOpen, setIsShareDropdownOpen] = useState(false);
  const [editingAgenda, setEditingAgenda] = useState<Agenda | null>(null);
  const [viewingNotes, setViewingNotes] = useState<{title: string, notes: string} | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [isUnscheduledDrawerOpen, setIsUnscheduledDrawerOpen] = useState(false);
  const [isSystemMenuOpen, setIsSystemMenuOpen] = useState(false);

  const { agendas, sharedDates, toggleComplete, deleteAgenda, markAsShared, isLoading, error, fetchAgendas } = useStore();

  useEffect(() => {
    getAppSettings().then(setAppSettings);
    fetchAgendas();
  }, [fetchAgendas]);

  // Native-aware navigation helper
  const handleNativeNav = (webPath: string, htmlFile: string) => (e: React.MouseEvent) => {
    if (isNativePlatform()) {
      e.preventDefault();
      setIsSystemMenuOpen(false);

      if (webPath === '/admin') {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'info',
          title: 'Menu Kelola User (Admin) hanya dapat diakses via server Web.',
          showConfirmButton: false,
          timer: 3500
        });
        return;
      }

      navigateNative(htmlFile);
    }
  };

  const selectedAgendas = agendas
    .filter((a) => isSameDay(new Date(a.scheduled_at), selectedDate) && a.status !== 'unscheduled')
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  const unscheduledAgendas = agendas.filter(a => a.status === 'unscheduled');

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
      Swal.fire({
        icon: 'success',
        title: 'Tersalin!',
        text: 'Rekap harian berhasil disalin ke clipboard.',
        timer: 1500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: 'Gagal menyalin teks ke clipboard.',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000
      });
    }
  };

  const handleCopyWeekly = async (criteria: "next_7_days" | "monday_to_sunday") => {
    const { getAppSettings } = await import("@/app/actions/settings");
    const { formatWeeklyAgendasToWhatsApp } = await import("@/lib/whatsapp-formatter");
    const settings = await getAppSettings();
    const fullMessage = formatWeeklyAgendasToWhatsApp(criteria, agendas, settings, new Date());

    try {
      await navigator.clipboard.writeText(fullMessage);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      Swal.fire({
        icon: 'success',
        title: 'Tersalin!',
        text: `Rekap agenda 1 minggu (${criteria === 'next_7_days' ? '7 Hari Ke Depan' : 'Senin - Minggu'}) berhasil disalin.`,
        timer: 1500,
        showConfirmButton: false,
        toast: true,
        position: 'top-end'
      });
    } catch (e) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: 'Gagal menyalin teks ke clipboard.',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2000
      });
    }
  };

  const handleShareWeekly = async (criteria: "next_7_days" | "monday_to_sunday") => {
    const { getAppSettings } = await import("@/app/actions/settings");
    const { formatWeeklyAgendasToWhatsApp } = await import("@/lib/whatsapp-formatter");
    const settings = await getAppSettings();
    const fullMessage = formatWeeklyAgendasToWhatsApp(criteria, agendas, settings, new Date());

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const waLink = isMobile
      ? `whatsapp://send?text=${encodeURIComponent(fullMessage)}`
      : `https://web.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`;
    
    window.open(waLink, "_blank");
  };

  const handleDeleteAgenda = async (id: string, title: string) => {
    const confirm = await Swal.fire({
      title: 'Hapus Agenda?',
      text: `Agenda "${title}" akan dihapus permanen.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Ya, Hapus!'
    });

    if (confirm.isConfirmed) {
      deleteAgenda(id);
      Swal.fire({ icon: 'success', title: 'Terhapus!', text: 'Agenda berhasil dihapus.', timer: 1500, showConfirmButton: false });
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
  const agendaDates = agendas.filter(a => a.status !== 'unscheduled').map(a => new Date(a.scheduled_at));

  return (
    <main className="min-h-screen relative overflow-hidden bg-background">
      <ConnectivityBanner />
      {/* Background Ornaments */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/20 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto p-4 sm:p-8 flex flex-col lg:flex-row gap-8">
        
        {/* Left Column: Navigation & Calendar (Control Center) */}
        <aside className="w-full lg:w-[400px] shrink-0 flex flex-col gap-6">
          <header className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {appSettings?.app_logo ? (
                  <img src={appSettings.app_logo} alt="Logo" className="w-11 h-11 rounded-2xl shadow-lg object-cover bg-white/5" />
                ) : (
                  <div className="p-2.5 bg-gradient-to-tr from-purple-500 to-indigo-500 rounded-2xl shadow-lg shadow-purple-500/20">
                    <CalendarHeart className="w-6 h-6 text-white" />
                  </div>
                )}
                <div>
                  <h1 className="text-lg font-bold text-white leading-tight">
                    {appSettings?.app_name || "AgendaRecap Pro"}
                  </h1>
                  <p className="text-[10px] text-zinc-400 font-medium tracking-wide">PRIVATE DASHBOARD</p>
                </div>
              </div>

              {/* System Menu Button (Hamburger on Mobile / Dropdown on PC) */}
              <div className="relative">
                <button
                  onClick={() => setIsSystemMenuOpen(!isSystemMenuOpen)}
                  className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-zinc-300 hover:text-white flex items-center gap-2 active:scale-95 shadow-md"
                  title="Menu Sistem & Pengaturan"
                >
                  {isSystemMenuOpen ? <X className="w-5 h-5 text-purple-400" /> : <Menu className="w-5 h-5 text-zinc-300" />}
                </button>

                <AnimatePresence>
                  {isSystemMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsSystemMenuOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-56 bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden py-2 backdrop-blur-xl"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-white/5 mb-1">
                          Menu Sistem
                        </div>

                        <Link
                          href="/admin"
                          onClick={handleNativeNav('/admin', 'admin.html')}
                          className="flex items-center gap-3 px-3 py-2.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors font-medium"
                        >
                          <Shield className="w-4 h-4 text-blue-400" />
                          <span>Kelola User (Admin)</span>
                        </Link>

                        <Link
                          href="/settings"
                          onClick={handleNativeNav('/settings', 'settings.html')}
                          className="flex items-center gap-3 px-3 py-2.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors font-medium"
                        >
                          <Settings className="w-4 h-4 text-purple-400" />
                          <span>Pengaturan Aplikasi</span>
                        </Link>

                        <a
                          href="/downloads/AgendaRecap_Pro.apk"
                          download="AgendaRecap_Pro.apk"
                          onClick={(e) => {
                            setIsSystemMenuOpen(false);
                            if (isNativePlatform()) {
                              e.preventDefault();
                              Swal.fire({
                                toast: true,
                                position: 'top-end',
                                icon: 'info',
                                title: 'Aplikasi AgendaRecap Pro sudah berjalan di perangkat Android Native.',
                                showConfirmButton: false,
                                timer: 3000
                              });
                            }
                          }}
                          className="flex items-center gap-3 px-3 py-2.5 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors font-medium"
                          title="Download File APK Android"
                        >
                          <Download className="w-4 h-4 text-emerald-400" />
                          <span>Download APK Android</span>
                        </a>

                        <div className="border-t border-white/5 my-1" />

                        <button
                          onClick={() => {
                            setIsSystemMenuOpen(false);
                            logout();
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors font-medium text-left"
                        >
                          <LogOut className="w-4 h-4 text-red-400" />
                          <span>Keluar dari Akun</span>
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
            
            {/* Primary Quick Actions Bar (Frequently Used) */}
            <div className="grid grid-cols-2 gap-2">
              <Link 
                href="/consultation"
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 rounded-xl transition-all text-orange-200 hover:text-white group text-xs font-semibold"
              >
                <Shield className="w-4 h-4 text-orange-400 shrink-0" />
                <span className="truncate">Konsultasi</span>
              </Link>
              <Link 
                href="/reminders"
                className="flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl transition-all text-blue-200 hover:text-white group text-xs font-semibold"
              >
                <BellRing className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="truncate">Pengingat</span>
              </Link>
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

          {/* Unscheduled Drawer */}
          <div className="glass rounded-[2rem] p-4 shadow-xl border border-white/5 flex flex-col overflow-hidden">
            <button 
              onClick={() => setIsUnscheduledDrawerOpen(!isUnscheduledDrawerOpen)}
              className="flex items-center justify-between w-full p-2 text-zinc-300 hover:text-white transition-colors"
            >
              <div className="flex items-center gap-2 font-semibold">
                <Archive className="w-5 h-5 text-zinc-400" />
                <span>Belum Ada Tanggal</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 text-xs font-bold border border-orange-500/20">{unscheduledAgendas.length}</span>
                <ChevronDown className={cn("w-4 h-4 transition-transform", isUnscheduledDrawerOpen && "rotate-180")} />
              </div>
            </button>
            
            <AnimatePresence>
              {isUnscheduledDrawerOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 flex flex-col gap-3 mt-2 border-t border-white/10 max-h-[300px] overflow-y-auto hide-scrollbar">
                    {unscheduledAgendas.length > 0 ? (
                      unscheduledAgendas.map(agenda => (
                        <div key={agenda.id} className="p-3 bg-white/5 border border-purple-500/10 rounded-xl hover:bg-white/10 transition-colors flex justify-between items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-white text-sm truncate">{agenda.title}</p>
                            <p className="text-xs text-zinc-400 truncate">{agenda.location}</p>
                            <span className="mt-1 inline-flex px-1.5 py-0.5 rounded-full text-[9px] bg-purple-500/10 text-purple-400 font-bold uppercase tracking-wider border border-purple-500/20">Belum Terjadwal</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleEdit(agenda)}
                              className="p-1.5 text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                              title="Edit / Jadwalkan"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteAgenda(agenda.id, agenda.title)}
                              className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                              title="Hapus Agenda"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-500 text-center py-4 italic">Semua agenda sudah memiliki tanggal yang pasti.</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </aside>

        {/* Right Column: Time-Slot Visualizer & Details */}
        <section className="flex-1 min-w-0 pb-32 md:pb-0">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6 glass p-6 rounded-[2rem] border border-white/5 shadow-xl">
            <div className="min-w-0 flex-1">
              <h2 className="text-xl sm:text-2xl font-bold text-white mb-1 truncate">
                {format(selectedDate, "EEEE, d MMMM yyyy", { locale: id })}
              </h2>
              <p className="text-zinc-400 text-sm">
                {selectedAgendas.length > 0 
                  ? `Terdapat ${selectedAgendas.length} agenda di tanggal ini.` 
                  : "Tidak ada jadwal untuk tanggal ini."}
              </p>
            </div>
            
            <div className="flex gap-2.5 w-full xl:w-auto flex-wrap xl:flex-nowrap items-center xl:justify-end shrink-0">
              {/* Copy Split Button */}
              <div className="relative flex-1 sm:flex-none">
                <div className="inline-flex items-center rounded-xl shadow-lg shadow-blue-500/20 bg-blue-500 hover:bg-blue-600 transition-all w-full">
                  <button
                    onClick={handleCopy}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-white font-semibold text-sm active:scale-95 transition-transform"
                    title="Copy Agenda Harian"
                  >
                    {isCopied ? <CheckCircle2 className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4 text-white" />}
                    <span>{isCopied ? "Tersalin!" : "Copy"}</span>
                  </button>
                  <div className="w-[1px] h-5 bg-white/20" />
                  <button
                    onClick={() => {
                      setIsCopyDropdownOpen(!isCopyDropdownOpen);
                      setIsShareDropdownOpen(false);
                    }}
                    className="px-2.5 py-2.5 text-white/80 hover:text-white flex items-center justify-center transition-colors rounded-r-xl"
                    title="Pilihan Copy Agenda"
                  >
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isCopyDropdownOpen && "rotate-180")} />
                  </button>
                </div>

                <AnimatePresence>
                  {isCopyDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setIsCopyDropdownOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-64 bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl z-30 overflow-hidden py-1.5 backdrop-blur-xl"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-white/5 mb-1">
                          Pilihan Rentang Copy
                        </div>

                        <button
                          onClick={() => {
                            handleCopy();
                            setIsCopyDropdownOpen(false);
                          }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors text-left font-medium"
                        >
                          <Copy className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold text-white">Copy Agenda Harian</div>
                            <div className="text-[10px] text-zinc-400">Tanggal terpilih di kalender</div>
                          </div>
                        </button>

                        <button
                          onClick={() => {
                            handleCopyWeekly("next_7_days");
                            setIsCopyDropdownOpen(false);
                          }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors text-left font-medium"
                        >
                          <CalendarDays className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold text-white">1 Minggu (7 Hari Ke Depan)</div>
                            <div className="text-[10px] text-zinc-400">Hari ini s/d 7 hari kedepan</div>
                          </div>
                        </button>

                        <button
                          onClick={() => {
                            handleCopyWeekly("monday_to_sunday");
                            setIsCopyDropdownOpen(false);
                          }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors text-left font-medium"
                        >
                          <CalendarRange className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold text-white">1 Minggu (Senin - Minggu)</div>
                            <div className="text-[10px] text-zinc-400">Senin s/d Minggu minggu ini</div>
                          </div>
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Share WA Split Button */}
              <div className="relative flex-1 sm:flex-none">
                <div className="inline-flex items-center rounded-xl shadow-lg shadow-emerald-500/20 bg-emerald-500 hover:bg-emerald-600 transition-all w-full">
                  <button
                    onClick={handleShare}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-white font-semibold text-sm active:scale-95 transition-transform"
                    title="Share WA Agenda Harian"
                  >
                    <Share2 className="w-4 h-4 text-white" />
                    <span>Share WA</span>
                  </button>
                  <div className="w-[1px] h-5 bg-white/20" />
                  <button
                    onClick={() => {
                      setIsShareDropdownOpen(!isShareDropdownOpen);
                      setIsCopyDropdownOpen(false);
                    }}
                    className="px-2.5 py-2.5 text-white/80 hover:text-white flex items-center justify-center transition-colors rounded-r-xl"
                    title="Pilihan Share WA"
                  >
                    <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isShareDropdownOpen && "rotate-180")} />
                  </button>
                </div>

                <AnimatePresence>
                  {isShareDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setIsShareDropdownOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 sm:left-auto sm:right-0 mt-2 w-64 bg-[#18181b] border border-white/10 rounded-2xl shadow-2xl z-30 overflow-hidden py-1.5 backdrop-blur-xl"
                      >
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-white/5 mb-1">
                          Pilihan Rentang Share WA
                        </div>

                        <button
                          onClick={() => {
                            handleShare();
                            setIsShareDropdownOpen(false);
                          }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors text-left font-medium"
                        >
                          <Share2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold text-white">Share WA Harian</div>
                            <div className="text-[10px] text-zinc-400">Tanggal terpilih di kalender</div>
                          </div>
                        </button>

                        <button
                          onClick={() => {
                            handleShareWeekly("next_7_days");
                            setIsShareDropdownOpen(false);
                          }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors text-left font-medium"
                        >
                          <CalendarDays className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold text-white">1 Minggu (7 Hari Ke Depan)</div>
                            <div className="text-[10px] text-zinc-400">Hari ini s/d 7 hari kedepan</div>
                          </div>
                        </button>

                        <button
                          onClick={() => {
                            handleShareWeekly("monday_to_sunday");
                            setIsShareDropdownOpen(false);
                          }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-colors text-left font-medium"
                        >
                          <CalendarRange className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-semibold text-white">1 Minggu (Senin - Minggu)</div>
                            <div className="text-[10px] text-zinc-400">Senin s/d Minggu minggu ini</div>
                          </div>
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Toggle View Mode Button */}
              <div className="flex bg-white/5 rounded-xl border border-white/5 p-1 shadow-lg w-full sm:w-auto overflow-hidden">
                <button
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    viewMode === "list" ? "bg-purple-500 text-white shadow-md" : "text-zinc-400 hover:text-white"
                  )}
                  title="Tampilan Daftar"
                >
                  <AlignLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode("calendar")}
                  className={cn(
                    "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    viewMode === "calendar" ? "bg-purple-500 text-white shadow-md" : "text-zinc-400 hover:text-white"
                  )}
                  title="Tampilan Kalender"
                >
                  <CalendarRange className="w-4 h-4" />
                </button>
              </div>

              {/* Tambah Baru Button */}
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg shadow-purple-500/20 px-4 py-2.5 rounded-xl font-semibold transition-all hover:opacity-90 active:scale-95 border-0 text-sm shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Baru</span>
              </button>
            </div>
          </div>

          {viewMode === "list" ? (
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
                      {isLoading ? (
                        <tr>
                          <td colSpan={5} className="py-24 text-center">
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center max-w-sm mx-auto">
                              <div className="w-8 h-8 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4" />
                              <h3 className="text-lg text-zinc-400 font-semibold mb-1">Memuat Data</h3>
                              <p className="text-zinc-500 text-sm">Menyinkronkan dengan database...</p>
                            </motion.div>
                          </td>
                        </tr>
                      ) : error ? (
                        <tr>
                          <td colSpan={5} className="py-24 text-center">
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center max-w-sm mx-auto p-6 bg-red-500/10 border border-red-500/20 rounded-2xl">
                              <Shield className="w-10 h-10 text-red-400 mb-3" />
                              <h3 className="text-lg text-red-400 font-semibold mb-1">Terjadi Kesalahan</h3>
                              <p className="text-red-400/80 text-sm">{error}</p>
                              <button onClick={() => fetchAgendas()} className="mt-4 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-medium transition-colors">Coba Lagi</button>
                            </motion.div>
                          </td>
                        </tr>
                      ) : selectedAgendas.length > 0 ? (
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
                                  "font-semibold text-base transition-colors flex items-center gap-2",
                                  agenda.is_completed ? "text-zinc-400 line-through" : "text-white"
                                )}>
                                  {agenda.title}
                                  {!agenda.isShareable && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-500/20 text-red-400 font-bold tracking-wider inline-flex items-center gap-1">
                                      <Shield className="w-2.5 h-2.5"/> INTERNAL
                                    </span>
                                  )}
                                </p>
                                
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  {agenda.status === 'confirmed' && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 font-bold uppercase tracking-wider border border-emerald-500/20">Confirmed</span>
                                  )}
                                  {agenda.status === 'pending_consultation' && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-400 font-bold uppercase tracking-wider border border-orange-500/20">Pending Consultation</span>
                                  )}
                                  {agenda.status === 'rescheduled' && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/10 text-blue-400 font-bold uppercase tracking-wider border border-blue-500/20">Rescheduled</span>
                                  )}
                                  {agenda.status === 'cancelled' && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-red-500/10 text-red-400 font-bold uppercase tracking-wider border border-red-500/20">Cancelled</span>
                                  )}
                                </div>

                                <div className="flex flex-col gap-1 mt-1.5">
                                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                                    {agenda.isOnline ? <Video className="w-3.5 h-3.5 text-blue-400" /> : <MapPin className="w-3.5 h-3.5 text-purple-400" />}
                                    <span>{agenda.location}</span>
                                  </div>
                                  {agenda.isOnline && agenda.onlineLink && (
                                    <div className="flex items-center gap-1.5 text-xs text-blue-400/80">
                                      <Link2 className="w-3.5 h-3.5" />
                                      <a href={agenda.onlineLink} target="_blank" rel="noopener noreferrer" className="hover:underline hover:text-blue-400 max-w-[200px] truncate block" onClick={(e) => e.stopPropagation()}>
                                        {agenda.onlineLink}
                                      </a>
                                    </div>
                                  )}
                                  {agenda.isOnline && agenda.meetingId && (
                                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 pl-5">
                                      <span className="font-medium text-zinc-400">ID:</span> {agenda.meetingId}
                                      {agenda.meetingPasscode && <><span className="font-medium text-zinc-400 ml-2">Pass:</span> {agenda.meetingPasscode}</>}
                                    </div>
                                  )}
                                </div>
                                {agenda.notes && !agenda.is_completed && (
                                  <div className="mt-2 text-sm text-zinc-400 border-l-[3px] border-white/10 pl-3">
                                    {agenda.notes}
                                  </div>
                                )}
                                
                                {agenda.privateNotes && !agenda.is_completed && (
                                  <div className="mt-2 text-sm">
                                    <button
                                      onClick={() => setViewingNotes({title: agenda.title, notes: agenda.privateNotes!})}
                                      className="px-3 py-1 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors inline-block"
                                    >
                                      🔒 Lihat Bahan Konsultasi
                                    </button>
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
                                  onClick={() => handleDeleteAgenda(agenda.id, agenda.title)}
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
          ) : (
            <MonthlyCalendarView 
              currentDate={selectedDate} 
              onDateClick={(date) => {
                setSelectedDate(date);
                setViewMode("list");
              }}
              onEditAgenda={handleEdit}
            />
          )}
          
          <div className="mt-8 flex justify-center">
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-zinc-400 hover:text-white rounded-xl transition-all shadow-lg text-sm font-medium"
            >
              <FileDown className="w-4 h-4" />
              Eksport Agenda ke Excel
            </button>
          </div>
        </section>
      </div>

      <AddAgendaModal
        isOpen={isAddModalOpen}
        onClose={handleCloseModal}
        defaultDate={selectedDate || new Date()}
        editAgenda={editingAgenda}
      />

      <ExportAgendaModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        appSettings={appSettings}
      />

      <AnimatePresence>
        {viewingNotes && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewingNotes(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md bg-[#121214] border border-orange-500/20 rounded-3xl p-6 shadow-2xl shadow-orange-500/10 z-50 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 to-red-500" />
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Shield className="w-5 h-5 text-orange-400" />
                    Bahan Konsultasi Pimpinan
                  </h2>
                  <p className="text-xs text-orange-400/80 mt-1 uppercase font-bold tracking-wider">Bersifat Internal & Privat</p>
                </div>
                <button
                  onClick={() => setViewingNotes(null)}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors text-zinc-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mb-4 text-sm font-semibold text-white/50 bg-black/20 p-3 rounded-xl border border-white/5">
                Agenda: {viewingNotes.title}
              </div>

              <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-4 min-h-[120px] text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">
                {viewingNotes.notes}
              </div>

              <div className="pt-6">
                <button
                  onClick={() => setViewingNotes(null)}
                  className="w-full flex items-center justify-center py-3 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl transition-all"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </main>
  );
}
