import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { agendaRepository } from "@/lib/repositories/agenda-repository";
import { syncRepository } from "@/lib/repositories/sync-repository";
import Swal from "sweetalert2";

export type Agenda = {
  id: string;
  user_id?: string;
  title: string;
  location: string;
  notes?: string;
  scheduled_at: string;
  privateNotes?: string;
  is_completed: boolean;
  include_notes_in_share: boolean;
  status: 'confirmed' | 'pending_consultation' | 'rescheduled' | 'cancelled' | 'unscheduled';
  isShareable: boolean;
  groupId?: string;
  isOnline?: boolean;
  onlineLink?: string;
  meetingId?: string;
  meetingPasscode?: string;
  isUrgent?: boolean;
  created_at?: string;
  updated_at: string;
};

type StoreState = {
  agendas: Agenda[];
  sharedDates: Record<string, string>;
  isLoading: boolean;
  error: string | null;
  subscriptionActive: boolean;
  fetchAgendas: () => Promise<void>;
  addAgenda: (agenda: Omit<Agenda, "id" | "is_completed" | "updated_at">) => Promise<boolean>;
  toggleComplete: (id: string) => Promise<void>;
  deleteAgenda: (id: string) => Promise<boolean>;
  updateAgenda: (id: string, updates: Partial<Agenda>) => Promise<boolean>;
  markAsShared: (dateKey: string, timestamp: string) => void;
  subscribeRealtime: () => () => void;
};

export const useStore = create<StoreState>((set, get) => {
  // B-1: Deduplication helper — canonical ID wins, last-write wins on duplicates
  function deduplicateAgendas(agendas: Agenda[]): Agenda[] {
    const map = new Map<string, Agenda>();
    for (const a of agendas) {
      if (!a?.id) continue;
      const existing = map.get(a.id);
      if (!existing || (a.updated_at && a.updated_at > (existing.updated_at || ''))) {
        map.set(a.id, a);
      }
    }
    return Array.from(map.values());
  }

  return {
  agendas: [],
  sharedDates: {},
  isLoading: true,
  error: null,
  subscriptionActive: false,

  fetchAgendas: async () => {
    set({ isLoading: true, error: null });

    try {
      // 1. Instant local IndexedDB load (Local First)
      const localAgendas = await agendaRepository.getLocal();
      set({ agendas: deduplicateAgendas(localAgendas as Agenda[]), isLoading: false });

      // 2. Background Sync if online
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await syncRepository.runSync();
        const updatedLocal = await agendaRepository.getLocal();
        set({ agendas: deduplicateAgendas(updatedLocal as Agenda[]) });
      }
    } catch (e: any) {
      console.error("Fetch agendas error:", e);
      set({ error: e.message || "Terjadi kesalahan membaca data lokal", isLoading: false });
    }
  },

  addAgenda: async (agenda) => {
    try {
      // 1. Local-first Repository Create
      const newAgenda = await agendaRepository.create(agenda as any);

      // 2. Update UI State immediately (deduplicated)
      set((state) => ({
        agendas: deduplicateAgendas(
          [...state.agendas.filter(a => a.id !== newAgenda.id), newAgenda as Agenda]
        ).sort(
          (a, b) => new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime()
        ),
      }));

      // 3. Trigger background sync if online
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncRepository.runSync().catch(err => console.warn("Background sync error:", err));
      }

      return true;
    } catch (e: any) {
      console.error("Gagal menambahkan agenda:", e?.message || e);
      Swal.fire({
        icon: 'error',
        title: 'Gagal Tambah Data',
        text: e?.message || 'Agenda gagal disimpan ke penyimpanan lokal. Coba lagi.'
      });
      return false;
    }
  },

  toggleComplete: async (id) => {
    const currentAgenda = get().agendas.find(a => a.id === id);
    if (!currentAgenda) return;

    const newStatus = !currentAgenda.is_completed;

    // 1. Local-first Repository Update
    const updated = await agendaRepository.update(id, { is_completed: newStatus });

    if (updated) {
      // 2. Update UI State
      set((state) => ({
        agendas: state.agendas.map((a) =>
          a.id === id ? (updated as Agenda) : a
        ),
      }));

      // 3. Trigger background sync if online
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncRepository.runSync().catch(err => console.warn("Background sync error:", err));
      }
    }
  },

  deleteAgenda: async (id) => {
    try {
      // 1. Local-first Repository Delete
      await agendaRepository.delete(id);

      // 2. Update UI State
      set((state) => ({
        agendas: state.agendas.filter((a) => a.id !== id),
      }));

      // 3. Trigger background sync if online
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncRepository.runSync().catch(err => console.warn("Background sync error:", err));
      }

      return true;
    } catch (error: any) {
      console.error("Gagal menghapus agenda:", error);
      Swal.fire({
        icon: 'error',
        title: 'Gagal Menghapus',
        text: error.message || 'Gagal menghapus data dari penyimpanan lokal.'
      });
      return false;
    }
  },

  updateAgenda: async (id, updates) => {
    try {
      // 1. Local-first Repository Update
      const updated = await agendaRepository.update(id, updates);

      if (updated) {
        // 2. Update UI State
        set((state) => ({
          agendas: state.agendas.map((a) => (a.id === id ? (updated as Agenda) : a)),
        }));

        // 3. Trigger background sync if online
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          syncRepository.runSync().catch(err => console.warn("Background sync error:", err));
        }

        return true;
      }

      return false;
    } catch (error: any) {
      console.error("Gagal mengupdate agenda:", error);
      Swal.fire({
        icon: 'error',
        title: 'Gagal Update',
        text: error?.message || 'Gagal update agenda.'
      });
      return false;
    }
  },

  markAsShared: (dateKey, timestamp) =>
    set((state) => ({
      sharedDates: {
        ...state.sharedDates,
        [dateKey]: state.sharedDates[dateKey] || timestamp,
      }
    })),

  subscribeRealtime: () => {
    const supabase = createClient();

    const channel = supabase
      .channel('public:agendas')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agendas' },
        (payload) => {
          console.log('[STORE] Realtime agenda change detected:', payload);
          get().fetchAgendas();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          set({ subscriptionActive: true });
        }
      });

    return () => {
      supabase.removeChannel(channel);
      set({ subscriptionActive: false });
    };
  }
  };
});
