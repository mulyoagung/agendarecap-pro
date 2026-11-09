"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useStore, Agenda } from "@/store/useStore";
import { Shield, Clock, CalendarHeart, X, Check, ArrowLeft, Edit2, AlertCircle, Star, Trash2, CalendarDays, Layers, ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import Swal from "sweetalert2";
import { generateUUID, isValidUUID } from "@/lib/utils";

function useDebounceCallback<Args extends any[]>(callback: (...args: Args) => void, delay: number) {
  const timeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);

  return useCallback((...args: Args) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
}

export interface ConsultationGroup {
  groupId: string;
  title: string;
  isUrgent: boolean;
  notes?: string;
  agendas: Agenda[];
}

export default function ConsultationPage() {
  const { agendas, updateAgenda, deleteAgenda, fetchAgendas, addAgenda, isLoading } = useStore();
  const [newConsultation, setNewConsultation] = useState("");

  useEffect(() => {
    fetchAgendas();
  }, [fetchAgendas]);

  // Filter agendas that need consultation (pending_consultation, rescheduled, or unscheduled)
  const consultationAgendas = useMemo(() => {
    return agendas.filter(
      (a) => (a.status === 'pending_consultation' || a.status === 'rescheduled' || a.status === 'unscheduled') && !a.is_completed
    );
  }, [agendas]);

  // Group agendas by groupId or id to merge multi-day/batch consultations (Section 8)
  const consultationGroups: ConsultationGroup[] = useMemo(() => {
    const map = new Map<string, ConsultationGroup>();

    for (const a of consultationAgendas) {
      const key = a.groupId || a.id;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          groupId: key,
          title: a.title,
          isUrgent: Boolean(a.isUrgent),
          notes: a.privateNotes || a.notes || "",
          agendas: [a]
        });
      } else {
        existing.agendas.push(a);
        if (a.isUrgent) existing.isUrgent = true;
      }
    }

    // Sort agendas inside each group by scheduled_at
    for (const group of map.values()) {
      group.agendas.sort((a, b) => {
        const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return timeA - timeB;
      });
    }

    // Sort groups: urgent first, then earliest agenda date
    return Array.from(map.values()).sort((a, b) => {
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      const tA = a.agendas[0]?.scheduled_at ? new Date(a.agendas[0].scheduled_at).getTime() : 0;
      const tB = b.agendas[0]?.scheduled_at ? new Date(b.agendas[0].scheduled_at).getTime() : 0;
      return tA - tB;
    });
  }, [consultationAgendas]);

  // Debounced save for private notes
  const debouncedSaveNotes = useDebounceCallback(async (id: string, notes: string) => {
    await updateAgenda(id, { privateNotes: notes });
  }, 1000);

  const handleNotesChange = (id: string, value: string) => {
    debouncedSaveNotes(id, value);
  };

  const handleConfirmSingle = async (agenda: Agenda) => {
    const success = await updateAgenda(agenda.id, { status: 'confirmed' });
    if (success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Jadwal Dikonfirmasi', showConfirmButton: false, timer: 1500 });
    }
  };

  const handleConfirmGroup = async (group: ConsultationGroup) => {
    let allOk = true;
    for (const a of group.agendas) {
      const ok = await updateAgenda(a.id, { status: 'confirmed' });
      if (!ok) allOk = false;
    }
    if (allOk) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `Seluruh Jadwal (${group.agendas.length} Agenda) Dikonfirmasi`,
        showConfirmButton: false,
        timer: 1500
      });
    }
  };

  const handleCancelConsultation = async (agenda: Agenda) => {
    const success = await updateAgenda(agenda.id, { 
      status: 'unscheduled',
      time_mode: 'unscheduled'
    });
    if (success) {
      Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Dikembalikan ke Belum Terjadwal', showConfirmButton: false, timer: 1500 });
    }
  };

  const handleAddSessionToGroup = async (group: ConsultationGroup) => {
    const primary = group.agendas[0];
    const newDate = primary?.scheduled_at ? new Date(primary.scheduled_at) : new Date();

    const targetGroupId = isValidUUID(group.groupId) ? group.groupId : generateUUID();
    if (primary && (!primary.groupId || !isValidUUID(primary.groupId))) {
      await updateAgenda(primary.id, { groupId: targetGroupId });
    }

    const success = await addAgenda({
      title: group.title,
      location: primary?.location || '-',
      notes: primary?.notes || '',
      privateNotes: primary?.privateNotes || '',
      include_notes_in_share: false,
      scheduled_at: newDate.toISOString(),
      status: 'pending_consultation',
      isShareable: false,
      groupId: targetGroupId
    });

    if (success) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Item Sesi Ditambahkan',
        text: 'Silakan sesuaikan tanggal dan waktu sesi baru.',
        showConfirmButton: false,
        timer: 1500
      });
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
    const groupId = generateUUID();
    const success = await addAgenda({
      title: newConsultation,
      location: '-',
      notes: '',
      privateNotes: '',
      include_notes_in_share: false,
      scheduled_at: new Date().toISOString(),
      status: 'pending_consultation',
      isShareable: false,
      groupId
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
            <div className="text-3xl font-bold text-orange-400">{consultationGroups.length}</div>
            <div className="text-xs text-orange-400/80 uppercase tracking-widest">
              {consultationAgendas.length} Total Agenda
            </div>
          </div>
        </header>

        {/* Quick Add Form */}
        <form onSubmit={handleAddConsultation} className="glass p-4 rounded-[1.5rem] border border-white/5 flex gap-3 shadow-xl">
          <input 
            type="text" 
            value={newConsultation}
            onChange={(e) => setNewConsultation(e.target.value)}
            placeholder="Ketik topik konsultasi baru..."
            className="flex-1 bg-[#1A1A1D] border border-white/10 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-orange-500/50 shadow-inner"
          />
          <button type="submit" disabled={!newConsultation.trim()} className="px-6 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors shrink-0">
            Tambah Topik
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
            ) : consultationGroups.length > 0 ? (
              consultationGroups.map((group) => (
                <ConsultationGroupCard 
                  key={group.groupId} 
                  group={group} 
                  onConfirmSingle={handleConfirmSingle}
                  onConfirmGroup={handleConfirmGroup}
                  onCancelConsultation={handleCancelConsultation}
                  onAddSession={handleAddSessionToGroup}
                  onDelete={handleDeleteAgenda}
                  onDateChange={handleDateChange}
                  onNotesChange={handleNotesChange}
                  onToggleUrgent={(agendaId) => {
                    const target = group.agendas.find(a => a.id === agendaId);
                    if (target) updateAgenda(target.id, { isUrgent: !target.isUrgent });
                  }}
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

// Group Component: Renders 1 Consultation process that may have multiple related agendas (Section 8)
function ConsultationGroupCard({ 
  group, 
  onConfirmSingle, 
  onConfirmGroup, 
  onCancelConsultation, 
  onAddSession,
  onDelete, 
  onDateChange, 
  onNotesChange, 
  onToggleUrgent 
}: {
  group: ConsultationGroup;
  onConfirmSingle: (a: Agenda) => void;
  onConfirmGroup: (g: ConsultationGroup) => void;
  onCancelConsultation: (a: Agenda) => void;
  onAddSession: (g: ConsultationGroup) => void;
  onDelete: (a: Agenda) => void;
  onDateChange: (id: string, date: string) => void;
  onNotesChange: (id: string, val: string) => void;
  onToggleUrgent: (agendaId: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(group.isUrgent);
  const primaryAgenda = group.agendas[0];
  const isMultiAgenda = group.agendas.length > 1;

  const [localNotes, setLocalNotes] = useState(primaryAgenda?.privateNotes || "");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="glass p-5 rounded-[1.8rem] border border-orange-500/20 shadow-lg shadow-orange-500/5 flex flex-col gap-4 relative overflow-hidden"
    >
      {/* Decorative side accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${group.isUrgent ? 'bg-yellow-400' : 'bg-orange-500'}`} />

      {/* Group Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pl-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <button 
            onClick={() => onToggleUrgent(primaryAgenda.id)}
            className={`p-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${group.isUrgent ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-zinc-500 hover:text-yellow-400'}`}
            title={group.isUrgent ? "Hapus Marka Mendesak" : "Tandai Mendesak"}
          >
            <Star className={`w-4 h-4 ${group.isUrgent ? 'fill-yellow-400' : ''}`} />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              {group.isUrgent ? 'Mendesak' : 'Biasa'}
            </span>
          </button>

          {isMultiAgenda && (
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
              <Layers className="w-3 h-3 text-indigo-400" />
              Sesi Terpadu ({group.agendas.length} Agenda)
            </span>
          )}

          <span className="px-2 py-0.5 rounded-full text-[10px] bg-orange-500/10 text-orange-400 font-bold uppercase tracking-wider border border-orange-500/20">
            Pending Konsultasi
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isMultiAgenda && (
            <button
              onClick={() => onConfirmGroup(group)}
              className="px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 active:scale-95"
            >
              <Check className="w-3.5 h-3.5" /> Konfirmasi Semua ({group.agendas.length})
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white rounded-xl transition-colors"
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Title & Notes preview */}
      <div className="pl-2">
        <h3 className="text-xl font-black text-white">{group.title}</h3>
        {primaryAgenda.location && primaryAgenda.location !== '-' && (
          <p className="text-xs text-zinc-400 mt-0.5">{primaryAgenda.location}</p>
        )}
      </div>

      {/* Expanded Details: List of all agendas under this single consultation */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="pl-2 flex flex-col gap-4 border-t border-white/5 pt-3"
        >
          {/* Notes field */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-orange-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
              <Edit2 className="w-3 h-3" /> Catatan Arahan Pimpinan
            </label>
            <textarea
              value={localNotes}
              onChange={(e) => {
                setLocalNotes(e.target.value);
                group.agendas.forEach(a => onNotesChange(a.id, e.target.value));
              }}
              placeholder="Ketik arahan atau keputusan di sini... (Otomatis tersimpan)"
              className="w-full bg-[#1A1A1D] border border-white/10 rounded-xl p-3 text-xs text-white resize-none focus:outline-none focus:border-orange-500/50 shadow-inner h-20"
            />
          </div>

          {/* Agenda Sessions List */}
          <div className="space-y-2">
            <label className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">
              {isMultiAgenda ? "Daftar Jadwal Sesi Terkait:" : "Jadwal Agenda:"}
            </label>

            {group.agendas.map((agenda, idx) => {
              const dtValue = agenda.scheduled_at
                ? format(new Date(agenda.scheduled_at), "yyyy-MM-dd'T'HH:mm")
                : "";

              return (
                <div 
                  key={agenda.id} 
                  className="p-3 bg-black/40 rounded-xl border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-white/10 text-zinc-400 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-white">
                        {agenda.scheduled_at
                          ? format(new Date(agenda.scheduled_at), "EEEE, d MMMM yyyy (HH:mm)", { locale: id })
                          : "Belum Ada Tanggal"}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {agenda.location || "-"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={dtValue}
                      onChange={(e) => onDateChange(agenda.id, e.target.value)}
                      className="bg-[#121214] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-orange-500/50 [color-scheme:dark]"
                    />

                    <button
                      onClick={() => onCancelConsultation(agenda)}
                      className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-xs"
                      title="Kembalikan ke belum terjadwal"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onDelete(agenda)}
                      className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs"
                      title="Hapus permanen"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onConfirmSingle(agenda)}
                      className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Konfirmasi
                    </button>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => onAddSession(group)}
              className="w-full py-2.5 px-3 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-95 mt-2 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Sesi / Item Jadwal ke Topik Ini</span>
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
