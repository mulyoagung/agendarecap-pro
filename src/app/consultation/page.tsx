"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { useStore, Agenda } from "@/store/useStore";
import { Shield, Clock, CalendarHeart, X, Check, ArrowLeft, Edit2, AlertCircle, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import Swal from "sweetalert2";

function useDebounceCallback<Args extends any[]>(callback: (...args: Args) => void, delay: number) {
  const timeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);

  return useCallback((...args: Args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
}


export default function ConsultationPage() {
  const { agendas, updateAgenda, deleteAgenda, fetchAgendas, addAgenda, isLoading } = useStore();
  const [newConsultation, setNewConsultation] = useState("");

  useEffect(() => {
    fetchAgendas();
  }, [fetchAgendas]);

  // Filter agendas that need consultation (pending_consultation, rescheduled, or unscheduled)
  const consultationAgendas = agendas.filter(
    (a) => (a.status === 'pending_consultation' || a.status === 'rescheduled' || a.status === 'unscheduled') && !a.is_completed
  ).sort((a, b) => {
    if (a.isUrgent && !b.isUrgent) return -1;
    if (!a.isUrgent && b.isUrgent) return 1;
    const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
    const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
    return timeA - timeB;
  });

  // Debounced save for private notes
  const debouncedSaveNotes = useDebounceCallback(async (id: string, notes: string) => {
    await updateAgenda(id, { privateNotes: notes });
  }, 1000);

  const handleNotesChange = (id: string, value: string) => {
    // Optimistic local state update (will be managed by inputs local state while typing, 
    // but here we just debounce to store)
    debouncedSaveNotes(id, value);
  };

  const handleConfirm = async (agenda: Agenda) => {
    const success = await updateAgenda(agenda.id, { status: 'confirmed' });
    if (success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Jadwal Dikonfirmasi', showConfirmButton: false, timer: 1500 });
    }
  };

  const handleCancelConsultation = async (agenda: Agenda) => {
    // Return to unscheduled — do NOT assign a date or mark as cancelled
    const success = await updateAgenda(agenda.id, { status: 'unscheduled', scheduled_at: null as any });
    if (success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Dikembalikan ke Belum Terjadwal', showConfirmButton: false, timer: 1500 });
    }
  };

  const handleDeleteAgenda = async (agenda: Agenda) => {
    const confirm = await Swal.fire({
      title: 'Hapus Agenda?',
      text: `Agenda "${agenda.title}" akan dihapus permanen.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Ya, Hapus!',
      cancelButtonText: 'Batal'
    });
    if (confirm.isConfirmed) {
      await deleteAgenda(agenda.id);
      Swal.fire({ icon: 'success', title: 'Terhapus!', text: 'Agenda berhasil dihapus.', timer: 1500, showConfirmButton: false });
    }
  };

  const handleDateChange = async (agendaId: string, newDate: string) => {
    if (!newDate) return;
    const dateObj = new Date(newDate);
    const success = await updateAgenda(agendaId, { scheduled_at: dateObj.toISOString() });
    if (success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Waktu Diperbarui', showConfirmButton: false, timer: 1000 });
    }
  };

  const handleAddConsultation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConsultation) return;
    const success = await addAgenda({
      title: newConsultation,
      location: '-',
      notes: '',
      privateNotes: '',
      include_notes_in_share: false,
      scheduled_at: new Date().toISOString(),
      status: 'pending_consultation',
      isShareable: false,
    });
    if (success) {
      setNewConsultation("");
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Topik Ditambahkan', showConfirmButton: false, timer: 1500 });
    }
  };

  return (
    <main className="min-h-screen relative overflow-hidden bg-[#0A0A0B]">
      {/* Background Ornaments */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-red-500/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto p-4 sm:p-8 flex flex-col gap-6">
        
        {/* Header */}
        <header className="flex items-center justify-between glass p-4 sm:p-6 rounded-[2rem] border border-orange-500/10 shadow-xl shadow-orange-500/5">
          <div className="flex items-center gap-4">
            <Link 
              href="/"
              className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                <Shield className="w-6 h-6 text-orange-400" />
                Mode Konsultasi Pimpinan
              </h1>
              <p className="text-sm text-zinc-400 mt-1">Kelola dan konfirmasi jadwal dengan cepat (Quick Action Dashboard)</p>
            </div>
          </div>
          
          <div className="text-right hidden sm:block">
            <div className="text-3xl font-bold text-orange-400">{consultationAgendas.length}</div>
            <div className="text-xs text-orange-400/80 uppercase tracking-widest">Menunggu Arahan</div>
          </div>
        </header>

        {/* Quick Add Form */}
        <form onSubmit={handleAddConsultation} className="glass p-4 rounded-[1.5rem] border border-white/5 flex gap-3 shadow-xl">
          <input 
            type="text" 
            value={newConsultation}
            onChange={(e) => setNewConsultation(e.target.value)}
            placeholder="Ketik topik konsultasi baru (non-agenda)..."
            className="flex-1 bg-[#1A1A1D] border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-orange-500/50 shadow-inner"
          />
          <button type="submit" disabled={!newConsultation.trim()} className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors shrink-0">
            Tambah
          </button>
        </form>

        {/* Content */}
        <div className="flex flex-col gap-4">
          <AnimatePresence mode="popLayout">
            {isLoading ? (
              <div className="py-24 text-center">
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center max-w-sm mx-auto">
                  <div className="w-8 h-8 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mb-4" />
                  <h3 className="text-lg text-zinc-400 font-semibold mb-1">Memuat Data Konsultasi</h3>
                </motion.div>
              </div>
            ) : consultationAgendas.length > 0 ? (
              consultationAgendas.map((agenda) => (
                <ConsultationCard 
                  key={agenda.id} 
                  agenda={agenda} 
                  onConfirm={handleConfirm}
                  onCancelConsultation={handleCancelConsultation}
                  onDelete={handleDeleteAgenda}
                  onDateChange={handleDateChange}
                  onNotesChange={handleNotesChange}
                  onToggleUrgent={() => updateAgenda(agenda.id, { isUrgent: !agenda.isUrgent })}
                />
              ))
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass p-12 rounded-[2rem] border border-white/5 flex flex-col items-center justify-center text-center mt-12"
              >
                <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mb-4 border border-emerald-500/20">
                  <Check className="w-10 h-10 text-emerald-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Semua Jadwal Sudah Terkonfirmasi</h3>
                <p className="text-zinc-400">Tidak ada agenda tertunda atau di-reschedule yang membutuhkan konsultasi pimpinan saat ini.</p>
                <Link
                  href="/"
                  className="mt-6 px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-colors text-sm font-semibold border border-white/10"
                >
                  Kembali ke Dashboard
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}

// Subcomponent for isolating local input states and preventing full list re-renders
function ConsultationCard({ agenda, onConfirm, onCancelConsultation, onDelete, onDateChange, onNotesChange, onToggleUrgent }: {
  agenda: Agenda, 
  onConfirm: (a: Agenda) => void,
  onCancelConsultation: (a: Agenda) => void,
  onDelete: (a: Agenda) => void,
  onDateChange: (id: string, date: string) => void,
  onNotesChange: (id: string, val: string) => void,
  onToggleUrgent: () => void
}) {
  const [localNotes, setLocalNotes] = useState(agenda.privateNotes || "");
  const [localDate, setLocalDate] = useState(
    agenda.scheduled_at ? format(new Date(agenda.scheduled_at), "yyyy-MM-dd'T'HH:mm") : ""
  );

  // Auto-collapse future items (anything starting tomorrow), unless user marks it as urgent
  const agendaDate = agenda.scheduled_at ? new Date(agenda.scheduled_at) : new Date(0);
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const isFuture = agenda.scheduled_at ? agendaDate.getTime() > endOfToday.getTime() : false;
  
  const [isExpanded, setIsExpanded] = useState(agenda.isUrgent ? true : !isFuture);

  // If the agenda status changes, ensure urgent remains open
  useEffect(() => {
    if (agenda.isUrgent) setIsExpanded(true);
  }, [agenda.isUrgent]);

  if (!isExpanded) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass px-5 py-3 rounded-2xl border border-white/5 flex justify-between items-center relative overflow-hidden cursor-pointer hover:bg-white/10 hover:border-white/20 transition-all shadow-md group"
        onClick={() => setIsExpanded(true)}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${agenda.status === 'rescheduled' ? 'bg-blue-500' : agenda.status === 'unscheduled' ? 'bg-purple-500' : 'bg-orange-500'}`} />
        <div className="pl-2 flex-1">
          <div className="flex items-center gap-3">
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleUrgent(); }}
              className={`p-1.5 rounded-lg transition-colors ${agenda.isUrgent ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-zinc-500 hover:text-yellow-400 hover:bg-white/10'}`}
              title={agenda.isUrgent ? "Hapus Marka Mendesak" : "Tandai Mendesak"}
            >
              <Star className={`w-4 h-4 ${agenda.isUrgent ? 'fill-yellow-400' : ''}`} />
            </button>
            <h3 className="font-bold text-white text-base truncate max-w-[200px] sm:max-w-xs">{agenda.title}</h3>
            {agenda.status === 'rescheduled' ? (
               <span className="px-2 py-0.5 rounded-full text-[9px] bg-blue-500/10 text-blue-400 font-bold uppercase tracking-wider border border-blue-500/20">
                 Rescheduled
               </span>
            ) : agenda.status === 'unscheduled' ? (
               <span className="px-2 py-0.5 rounded-full text-[9px] bg-purple-500/10 text-purple-400 font-bold uppercase tracking-wider border border-purple-500/20">
                 Belum Terjadwal
               </span>
            ) : (
                agenda.scheduled_at && isFuture && (
                  <span className="px-2 py-0.5 rounded-full text-[9px] bg-white/10 text-zinc-400 uppercase tracking-widest border border-white/5">
                    Akan Datang
                  </span>
                )
            )}
          </div>
          <p className="text-xs text-orange-400 mt-1 flex items-center gap-1.5 font-medium">
            <Clock className="w-3 h-3" />
            {agenda.scheduled_at && agenda.status !== 'unscheduled'
              ? format(new Date(agenda.scheduled_at), 'd MMMM yyyy, HH:mm', { locale: id })
              : 'Belum Terjadwal'}
          </p>
        </div>
        <button className="text-xs font-semibold text-zinc-400 group-hover:text-white px-4 py-2 bg-white/5 rounded-xl transition-colors">
          Buka Detail
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass p-5 rounded-[1.5rem] border border-orange-500/20 shadow-lg shadow-orange-500/5 flex flex-col md:flex-row gap-6 relative overflow-hidden"
    >
      {/* Decorative side border */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${agenda.status === 'rescheduled' ? 'bg-blue-500' : agenda.status === 'unscheduled' ? 'bg-purple-500' : 'bg-orange-500'}`} />

      {/* Close button to collapse manually */}
      <button 
        onClick={() => setIsExpanded(false)}
        className="absolute top-4 right-4 p-1.5 text-zinc-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors md:hidden"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Left Column: Agenda Info */}
      <div className="flex-1 md:border-r border-white/10 md:pr-6 relative">
        <div className="flex items-center gap-2 mb-2">
          <button 
            onClick={onToggleUrgent}
            className={`p-1 rounded-md transition-colors flex items-center gap-1 ${agenda.isUrgent ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-zinc-500 hover:text-yellow-400 hover:bg-white/10'}`}
            title={agenda.isUrgent ? "Hapus Marka Mendesak" : "Tandai Mendesak"}
          >
            <Star className={`w-3.5 h-3.5 ${agenda.isUrgent ? 'fill-yellow-400' : ''}`} />
            <span className="text-[9px] font-bold uppercase tracking-wider pr-1">
              {agenda.isUrgent ? 'Mendesak' : 'Biasa'}
            </span>
          </button>
          {agenda.status === 'rescheduled' ? (
             <span className="px-2 py-0.5 rounded-full text-[10px] bg-blue-500/10 text-blue-400 font-bold uppercase tracking-wider border border-blue-500/20">
               Rescheduled
             </span>
          ) : agenda.status === 'unscheduled' ? (
             <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/10 text-purple-400 font-bold uppercase tracking-wider border border-purple-500/20">
               Belum Terjadwal
             </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-400 font-bold uppercase tracking-wider border border-orange-500/20 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> Pending Konsultasi
            </span>
          )}
        </div>
        <h3 className="text-xl font-bold text-white mb-1 pr-8 md:pr-0">{agenda.title}</h3>
        <p className="text-sm text-zinc-400 mb-4">{agenda.location}</p>

        {agenda.notes && (
          <div className="text-sm text-zinc-400 border-l-[3px] border-white/10 pl-3 mb-4 bg-white/[0.02] p-2 rounded-r-lg">
            {agenda.notes}
          </div>
        )}
        
        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">Perkiraan Waktu Jadwal</label>
          <div className="relative">
            <input
              type="datetime-local"
              value={localDate}
              onChange={(e) => {
                setLocalDate(e.target.value);
                onDateChange(agenda.id, e.target.value);
              }}
              className="w-full bg-[#1A1A1D] border border-white/10 rounded-xl px-4 py-2.5 text-white shadow-inner focus:outline-none focus:border-orange-500/50 transition-colors"
            />
            <Clock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Right Column: Interactive Quick Actions */}
      <div className="flex-1 flex flex-col gap-4 relative">
        <button 
          onClick={() => setIsExpanded(false)}
          className="absolute -top-1 -right-1 p-1.5 text-zinc-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors hidden md:block"
        >
          <X className="w-4 h-4" />
        </button>
        
        <div className="flex-1 flex flex-col gap-2 md:pt-4">
          <label className="text-xs text-orange-400/80 font-bold uppercase tracking-wider flex items-center gap-1.5">
            <Edit2 className="w-3 h-3" /> Catatan Arahan Pimpinan
          </label>
          <textarea
            value={localNotes}
            onChange={(e) => {
              setLocalNotes(e.target.value);
              onNotesChange(agenda.id, e.target.value);
            }}
            placeholder="Ketik arahan atau keputusan di sini... (Otomatis tersimpan)"
            className="w-full flex-1 min-h-[100px] bg-[#1A1A1D] border border-white/10 rounded-xl p-3 text-sm text-white resize-none focus:outline-none focus:border-orange-500/50 transition-colors shadow-inner"
          />
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => onCancelConsultation(agenda)}
            className="flex-1 px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-xl transition-all text-sm font-semibold flex items-center justify-center gap-2"
            title="Kembalikan ke Belum Terjadwal — tidak menghapus agenda"
          >
            <X className="w-4 h-4" /> Batal Konsultasi
          </button>
          <button
            onClick={() => onDelete(agenda)}
            className="px-3 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl transition-all text-sm font-semibold flex items-center justify-center gap-2"
            title="Hapus agenda ini permanen"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onConfirm(agenda)}
            className="flex-1 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-sm font-semibold flex items-center justify-center gap-2"
          >
            <Check className="w-4 h-4" /> Konfirmasi Jadwal
          </button>
        </div>
      </div>
    </motion.div>
  );
}
