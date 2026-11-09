import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin } from "lucide-react";
import { useStore, Agenda } from "@/store/useStore";
import { format } from "date-fns";
import { generateUUID } from "@/lib/utils";

import { AgendaTimeMode, getAgendaTimeMode } from "@/lib/agenda-time";

interface AddAgendaModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDate: Date;
  editAgenda?: Agenda | null;
  initialTimeMode?: AgendaTimeMode;
  initialStatus?: 'confirmed' | 'pending_consultation' | 'rescheduled' | 'cancelled' | 'unscheduled';
}

export function AddAgendaModal({ isOpen, onClose, defaultDate, editAgenda, initialTimeMode, initialStatus }: AddAgendaModalProps) {
  const { addAgenda, updateAgenda } = useStore();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [includeNotes, setIncludeNotes] = useState(false);
  const [time, setTime] = useState("09:00");
  const [timeMode, setTimeMode] = useState<AgendaTimeMode>("exact");

  // New fields
  const [status, setStatus] = useState<'confirmed' | 'pending_consultation' | 'rescheduled' | 'cancelled' | 'unscheduled'>('confirmed');
  const [isShareable, setIsShareable] = useState(true);
  const [privateNotes, setPrivateNotes] = useState("");
  
  // Multi-day fields
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [endDate, setEndDate] = useState<Date>(defaultDate);
  const [multiDateTimes, setMultiDateTimes] = useState<Record<string, string>>({});

  // Recurring Weekly fields (Sections 5 & 6)
  const [isRecurringWeekly, setIsRecurringWeekly] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([1]);
  const [recurrenceStartDate, setRecurrenceStartDate] = useState(format(defaultDate, "yyyy-MM-dd"));
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(format(new Date(defaultDate.getTime() + 90 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"));

  // Online Meeting fields
  const [isOnline, setIsOnline] = useState(false);
  const [onlineLink, setOnlineLink] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [meetingPasscode, setMeetingPasscode] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Selected Target Date for creation or reschedule
  const [selectedDateStr, setSelectedDateStr] = useState<string>(format(defaultDate, "yyyy-MM-dd"));

  useEffect(() => {
    if (isOpen) {
      if (editAgenda) {
        setTitle(editAgenda.title);
        setLocation(editAgenda.location || "");
        setNotes(editAgenda.notes || "");
        setPrivateNotes(editAgenda.privateNotes || "");
        setIncludeNotes(editAgenda.include_notes_in_share);
        
        if (editAgenda.scheduled_at) {
          try {
            setSelectedDateStr(format(new Date(editAgenda.scheduled_at), "yyyy-MM-dd"));
          } catch {
            setSelectedDateStr(format(defaultDate, "yyyy-MM-dd"));
          }
        } else {
          setSelectedDateStr(format(defaultDate, "yyyy-MM-dd"));
        }

        const mode = getAgendaTimeMode(editAgenda);
        setTimeMode(mode);
        if (mode === 'exact' && editAgenda.scheduled_at) {
          try {
            setTime(format(new Date(editAgenda.scheduled_at), "HH:mm"));
          } catch {
            setTime("09:00");
          }
        } else {
          setTime("09:00");
        }

        setStatus(editAgenda.status || (mode === 'unscheduled' ? 'unscheduled' : 'confirmed'));
        setIsShareable(editAgenda.isShareable ?? true);
        setIsMultiDay(false);
        setIsRecurringWeekly(false);
        setIsOnline(editAgenda.isOnline || false);
        setOnlineLink(editAgenda.onlineLink || "");
        setMeetingId(editAgenda.meetingId || "");
        setMeetingPasscode(editAgenda.meetingPasscode || "");
      } else {
        setTitle("");
        setLocation("");
        setNotes("");
        setPrivateNotes("");
        setIncludeNotes(false);
        setSelectedDateStr(format(defaultDate, "yyyy-MM-dd"));
        setTime("09:00");
        const defaultMode = initialTimeMode || "exact";
        setTimeMode(defaultMode);
        setStatus(initialStatus || (defaultMode === 'unscheduled' ? 'unscheduled' : 'confirmed'));
        setIsShareable(true);
        setIsMultiDay(false);
        setIsRecurringWeekly(false);
        setSelectedDays([1]);
        setRecurrenceStartDate(format(defaultDate, "yyyy-MM-dd"));
        setRecurrenceEndDate(format(new Date(defaultDate.getTime() + 90 * 24 * 60 * 60 * 1000), "yyyy-MM-dd"));
        setEndDate(defaultDate);
        setMultiDateTimes({});
        setIsOnline(false);
        setOnlineLink("");
        setMeetingId("");
        setMeetingPasscode("");
      }
    }
  }, [isOpen, editAgenda, defaultDate, initialTimeMode, initialStatus]);

  useEffect(() => {
    if (isMultiDay && endDate >= defaultDate) {
      const times: Record<string, string> = {};
      let curr = new Date(defaultDate);
      curr.setHours(0,0,0,0);
      const end = new Date(endDate);
      end.setHours(0,0,0,0);

      while (curr <= end) {
        const key = format(curr, 'yyyy-MM-dd');
        times[key] = multiDateTimes[key] || time;
        curr.setDate(curr.getDate() + 1);
      }
      setMultiDateTimes(times);
    }
  }, [isMultiDay, defaultDate, endDate]);

  const handleTimeModeChange = (mode: AgendaTimeMode) => {
    setTimeMode(mode);
    if (mode === 'unscheduled') {
      setStatus('unscheduled');
    } else if (status === 'unscheduled') {
      setStatus('confirmed');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title?.trim()) return;

    // Fallback location for online or general agenda
    const trimmedLocation = location.trim() || (isOnline ? 'Online Meeting' : '-');

    setIsSubmitting(true);
    let success = true;

    try {
      const isUnscheduled = timeMode === 'unscheduled' || status === 'unscheduled';
      const effectiveStatus = isUnscheduled ? 'unscheduled' : status;
      const effectiveTimeMode = isUnscheduled ? 'unscheduled' : timeMode;

      // Safe date parser to avoid RangeError: Invalid time value
      const getScheduledIso = (targetDateStr: string, targetTime: string, mode: AgendaTimeMode) => {
        let baseDate: Date;
        if (!targetDateStr) {
          baseDate = defaultDate ? new Date(defaultDate) : new Date();
        } else {
          baseDate = new Date(targetDateStr + 'T00:00:00');
        }
        if (isNaN(baseDate.getTime())) {
          baseDate = new Date();
        }
        if (mode === 'exact') {
          const [hours, minutes] = (targetTime || "09:00").split(":").map(Number);
          baseDate.setHours(isNaN(hours) ? 9 : hours, isNaN(minutes) ? 0 : minutes, 0, 0);
        } else {
          baseDate.setHours(0, 0, 0, 0);
        }
        return baseDate.toISOString();
      };

      if (editAgenda) {
        const scheduledIso = getScheduledIso(selectedDateStr, time, effectiveTimeMode);

        success = await updateAgenda(editAgenda.id, {
          title: title.trim(),
          location: trimmedLocation,
          notes,
          privateNotes,
          include_notes_in_share: includeNotes,
          scheduled_at: scheduledIso,
          time_mode: effectiveTimeMode,
          status: effectiveStatus,
          isShareable,
          isOnline,
          onlineLink,
          meetingId,
          meetingPasscode
        });
      } else if (isRecurringWeekly) {
        // Section 5 & 6: Recurring Weekly Agenda Generation over Active Semester Range
        const groupId = generateUUID();
        let curr = new Date(recurrenceStartDate + 'T00:00:00');
        const end = new Date(recurrenceEndDate + 'T23:59:59');

        while (curr <= end) {
          const dayOfWeek = curr.getDay(); // 0 = Sun, 1 = Mon...
          if (selectedDays.includes(dayOfWeek)) {
            const scheduledDate = new Date(curr);
            if (effectiveTimeMode === 'exact') {
              const [hours, minutes] = time.split(":").map(Number);
              scheduledDate.setHours(hours, minutes, 0, 0);
            } else {
              scheduledDate.setHours(0, 0, 0, 0);
            }

            const res = await addAgenda({
              title: title.trim(),
              location: trimmedLocation,
              notes,
              privateNotes,
              include_notes_in_share: includeNotes,
              scheduled_at: scheduledDate.toISOString(),
              time_mode: effectiveTimeMode,
              status: effectiveStatus,
              isShareable,
              groupId,
              isOnline,
              onlineLink,
              meetingId,
              meetingPasscode
            });
            if (!res) success = false;
          }
          curr.setDate(curr.getDate() + 1);
        }
      } else if (isMultiDay) {
        const groupId = generateUUID();
        
        let curr = new Date(selectedDateStr + 'T00:00:00');
        curr.setHours(0,0,0,0);
        const end = new Date(endDate);
        end.setHours(0,0,0,0);

        while (curr <= end) {
          const key = format(curr, 'yyyy-MM-dd');
          const dayTime = multiDateTimes[key] || "09:00";
          const scheduledDate = new Date(curr);
          if (effectiveTimeMode === 'exact') {
            const [hours, minutes] = dayTime.split(":").map(Number);
            scheduledDate.setHours(hours, minutes, 0, 0);
          } else {
            scheduledDate.setHours(0, 0, 0, 0);
          }

          const res = await addAgenda({
            title: title.trim(),
            location: trimmedLocation,
            notes,
            privateNotes,
            include_notes_in_share: includeNotes,
            scheduled_at: scheduledDate.toISOString(),
            time_mode: effectiveTimeMode,
            status: effectiveStatus,
            isShareable,
            groupId,
            isOnline,
            onlineLink,
            meetingId,
            meetingPasscode
          });
          if (!res) success = false;
          curr.setDate(curr.getDate() + 1);
        }
      } else {
        const scheduledIso = getScheduledIso(selectedDateStr, time, effectiveTimeMode);

        success = await addAgenda({
          title: title.trim(),
          location: trimmedLocation,
          notes,
          privateNotes,
          include_notes_in_share: includeNotes,
          scheduled_at: scheduledIso,
          time_mode: effectiveTimeMode,
          status: effectiveStatus,
          isShareable,
          isOnline,
          onlineLink,
          meetingId,
          meetingPasscode
        });
      }

      if (success) {
        onClose();
      }
    } catch (err) {
      console.error("Gagal menyimpan agenda:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-md max-h-[90vh] overflow-y-auto bg-[#121214] border border-white/10 rounded-3xl p-6 shadow-2xl z-50 hide-scrollbar"
          >
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-white">
                {editAgenda ? "Edit Agenda" : "Agenda Baru"}
              </h2>
              <button
                onClick={onClose}
                className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Judul Agenda <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Makan siang bersama klien..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                />
              </div>

              <div className="flex flex-col gap-4">
                {!editAgenda && (
                  <>
                    <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setIsMultiDay(!isMultiDay);
                          if (!isMultiDay) setIsRecurringWeekly(false);
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          isMultiDay ? "bg-purple-500" : "bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            isMultiDay ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                      <span className="text-sm font-medium text-zinc-300">
                        Agenda Multi-Hari
                      </span>
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setIsRecurringWeekly(!isRecurringWeekly);
                          if (!isRecurringWeekly) setIsMultiDay(false);
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          isRecurringWeekly ? "bg-indigo-500" : "bg-zinc-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            isRecurringWeekly ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                      <span className="text-sm font-medium text-zinc-300">
                        Ulangi Setiap Minggu (Periode Semester)
                      </span>
                    </div>
                  </>
                )}

                {/* Recurring Weekly Controls (Section 5 & 6) */}
                {isRecurringWeekly && !editAgenda && (
                  <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-indigo-300 mb-2 uppercase tracking-wider">
                        Pilih Hari Berulang
                      </label>
                      <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                        {[
                          { id: 1, label: "Sen" },
                          { id: 2, label: "Sel" },
                          { id: 3, label: "Rab" },
                          { id: 4, label: "Kam" },
                          { id: 5, label: "Jum" },
                          { id: 6, label: "Sab" },
                          { id: 0, label: "Min" }
                        ].map(day => (
                          <button
                            key={day.id}
                            type="button"
                            onClick={() => {
                              setSelectedDays(prev => 
                                prev.includes(day.id) ? prev.filter(d => d !== day.id) : [...prev, day.id]
                              );
                            }}
                            className={`py-1.5 rounded-lg text-xs font-bold transition-all border ${
                              selectedDays.includes(day.id)
                                ? "bg-indigo-500 text-white border-indigo-400 shadow-md"
                                : "bg-black/30 text-zinc-400 border-white/10 hover:text-white"
                            }`}
                          >
                            {day.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">Periode Mulai</label>
                        <input
                          type="date"
                          value={recurrenceStartDate}
                          onChange={(e) => setRecurrenceStartDate(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 [color-scheme:dark]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-300 mb-1">Periode Selesai</label>
                        <input
                          type="date"
                          value={recurrenceEndDate}
                          onChange={(e) => setRecurrenceEndDate(e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 [color-scheme:dark]"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {isMultiDay && !editAgenda && (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
                    <div className="flex gap-4 items-center">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-zinc-400 mb-1.5">Sampai Tanggal</label>
                        <input
                          type="date"
                          required
                          min={format(defaultDate, 'yyyy-MM-dd')}
                          value={format(endDate, 'yyyy-MM-dd')}
                          onChange={(e) => setEndDate(new Date(e.target.value))}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all [color-scheme:dark]"
                        />
                      </div>
                    </div>
                    {Object.entries(multiDateTimes).map(([dateKey, t]) => (
                      <div key={dateKey} className="flex justify-between items-center gap-4 p-2 bg-black/20 rounded-lg">
                        <span className="text-sm text-zinc-300 font-medium">
                          {format(new Date(dateKey), 'dd MMM yyyy')}
                        </span>
                        <input
                          type="time"
                          required
                          value={t}
                          onChange={(e) => setMultiDateTimes(prev => ({...prev, [dateKey]: e.target.value}))}
                          className="w-32 bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all [color-scheme:dark]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Time Semantics Selector */}
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Semantik Waktu</label>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => handleTimeModeChange('exact')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                        timeMode === 'exact'
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-sm'
                          : 'bg-white/5 text-zinc-400 border-white/10 hover:text-white'
                      }`}
                    >
                      Jam Tertentu
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTimeModeChange('flex')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                        timeMode === 'flex'
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/50 shadow-sm'
                          : 'bg-white/5 text-zinc-400 border-white/10 hover:text-white'
                      }`}
                    >
                      Fleksibel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTimeModeChange('all_day')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                        timeMode === 'all_day'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                          : 'bg-white/5 text-zinc-400 border-white/10 hover:text-white'
                      }`}
                    >
                      Seharian
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTimeModeChange('unscheduled')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border ${
                        timeMode === 'unscheduled'
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                          : 'bg-white/5 text-zinc-400 border-white/10 hover:text-white'
                      }`}
                    >
                      Belum Ditentukan
                    </button>
                  </div>
                </div>

                {!isMultiDay && (
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5 flex items-center gap-1">
                      Tanggal Agenda {timeMode === 'unscheduled' && <span className="text-xs text-amber-400 font-normal">(Atur Tanggal untuk Menjadwalkan)</span>}
                    </label>
                    <input
                      type="date"
                      required={timeMode !== 'unscheduled'}
                      value={selectedDateStr}
                      onChange={(e) => {
                        setSelectedDateStr(e.target.value);
                        if (timeMode === 'unscheduled') {
                          setTimeMode('exact');
                          setStatus('confirmed');
                        }
                      }}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all [color-scheme:dark]"
                    />
                  </div>
                )}

                <div className="flex gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5 flex items-center gap-1">
                      <MapPin className="w-4 h-4" /> Tempat {isOnline ? "(Opsional)" : <span className="text-zinc-500 font-normal text-xs">(Opsional)</span>}
                    </label>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder={isOnline ? "Zoom / GMeet / Dsb..." : "Ruang Rapat / -"}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                    />
                  </div>
                  {timeMode === 'exact' && !isMultiDay && (
                    <div className="w-1/3">
                      <label className="block text-sm font-medium text-zinc-400 mb-1.5">Jam</label>
                      <input
                        type="time"
                        required
                        lang="id-ID"
                        step="60"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all [color-scheme:dark]"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* ONLINE MEETING TOGGLE */}
              <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl mt-4 max-w-full">
                <button
                  type="button"
                  onClick={() => setIsOnline(!isOnline)}
                  className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isOnline ? "bg-blue-500" : "bg-zinc-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isOnline ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-zinc-300 truncate">
                    Agenda Daring (Online Meeting)
                  </span>
                  <span className="text-[10px] text-zinc-500 truncate">Aktifkan untuk menambahkan Link, Meeting ID, dsb.</span>
                </div>
              </div>

              {/* ONLINE MEETING FIELDS */}
              {isOnline && (
                <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-4 mt-2">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Link Meeting (Opsional)</label>
                    <input
                      type="url"
                      value={onlineLink}
                      onChange={(e) => setOnlineLink(e.target.value)}
                      placeholder="https://zoom.us/j/..."
                      className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                    />
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1 min-w-0">
                      <label className="block text-sm font-medium text-zinc-400 mb-1.5">Meeting ID (Opsional)</label>
                      <input
                        type="text"
                        value={meetingId}
                        onChange={(e) => setMeetingId(e.target.value)}
                        placeholder="123 456 7890"
                        className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="block text-sm font-medium text-zinc-400 mb-1.5">Passcode (Opsional)</label>
                      <input
                        type="text"
                        value={meetingPasscode}
                        onChange={(e) => setMeetingPasscode(e.target.value)}
                        placeholder="123456"
                        className="w-full bg-black/20 border border-white/5 rounded-xl px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5 mt-4">Catatan untuk Dibagikan (Opsional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Siapkan bahan presentasi..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Bahan Konsultasi / Private Notes</label>
                <textarea
                  value={privateNotes}
                  onChange={(e) => setPrivateNotes(e.target.value)}
                  placeholder="Catatan rahasia/internal untuk pimpinan..."
                  rows={2}
                  className="w-full bg-orange-500/5 border border-orange-500/20 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all resize-none"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Status Agenda</label>
                  <select
                    value={status}
                    onChange={(e) => {
                      const nextStatus = e.target.value as any;
                      setStatus(nextStatus);
                      if (nextStatus === 'unscheduled') {
                        setTimeMode('unscheduled');
                      } else if (timeMode === 'unscheduled') {
                        setTimeMode('exact');
                      }
                    }}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all [&>option]:bg-[#121214] [&>option]:text-white"
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="pending_consultation">Pending Consultation</option>
                    <option value="rescheduled">Rescheduled</option>
                    <option value="unscheduled">Unscheduled / Belum Ada Tanggal</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {notes && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setIncludeNotes(!includeNotes)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        includeNotes ? "bg-purple-500" : "bg-zinc-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          includeNotes ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <span className="text-sm font-medium text-zinc-300">
                      Cantumkan catatan di WhatsApp Share
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                <button
                  type="button"
                  onClick={() => setIsShareable(!isShareable)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isShareable ? "bg-emerald-500" : "bg-zinc-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isShareable ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
                <span className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  Aktifkan di Share/Rekap WA
                  {!isShareable && <span className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 font-bold tracking-wide">PENGINGAT INTERNAL</span>}
                </span>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 transition-all outline-none focus:ring-2 focus:ring-purple-500/50 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : editAgenda ? "Simpan Perubahan" : "Simpan Agenda"}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
