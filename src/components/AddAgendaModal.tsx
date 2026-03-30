import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MapPin } from "lucide-react";
import { useStore, Agenda } from "@/store/useStore";
import { format } from "date-fns";

interface AddAgendaModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDate: Date;
  editAgenda?: Agenda | null;
}

export function AddAgendaModal({ isOpen, onClose, defaultDate, editAgenda }: AddAgendaModalProps) {
  const { addAgenda, updateAgenda } = useStore();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [includeNotes, setIncludeNotes] = useState(false);
  const [time, setTime] = useState("09:00");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (editAgenda) {
        setTitle(editAgenda.title);
        setLocation(editAgenda.location);
        setNotes(editAgenda.notes || "");
        setIncludeNotes(editAgenda.include_notes_in_share);
        setTime(format(new Date(editAgenda.scheduled_at), "HH:mm"));
      } else {
        setTitle("");
        setLocation("");
        setNotes("");
        setIncludeNotes(false);
        setTime("09:00");
      }
    }
  }, [isOpen, editAgenda]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !location) return;

    setIsSubmitting(true);
    const scheduledDate = new Date(editAgenda ? new Date(editAgenda.scheduled_at) : defaultDate);
    const [hours, minutes] = time.split(":").map(Number);
    scheduledDate.setHours(hours, minutes, 0, 0);

    let success = false;
    if (editAgenda) {
      success = await updateAgenda(editAgenda.id, {
        title,
        location,
        notes,
        include_notes_in_share: includeNotes,
        scheduled_at: scheduledDate.toISOString(),
      });
    } else {
      success = await addAgenda({
        title,
        location,
        notes,
        include_notes_in_share: includeNotes,
        scheduled_at: scheduledDate.toISOString(),
      });
    }

    setIsSubmitting(false);
    if (success) {
      onClose();
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

              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5 flex items-center gap-1">
                    <MapPin className="w-4 h-4" /> Tempat <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Zoom / Kantor..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                  />
                </div>
                <div className="w-1/3">
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Waktu</label>
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
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Catatan (Opsional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Siapkan bahan presentasi..."
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all resize-none"
                />
              </div>

              {notes && (
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
              )}

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
