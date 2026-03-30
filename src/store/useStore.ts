import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import Swal from "sweetalert2";

export type Agenda = {
  id: string;
  user_id?: string;
  title: string;
  location: string;
  notes?: string;
  scheduled_at: string;
  is_completed: boolean;
  include_notes_in_share: boolean;
  updated_at: string;
};

type StoreState = {
  agendas: Agenda[];
  sharedDates: Record<string, string>; // Maps "YYYY-MM-DD" to ISO "last_shared_at"
  isLoading: boolean;
  error: string | null;
  fetchAgendas: () => Promise<void>;
  addAgenda: (agenda: Omit<Agenda, "id" | "is_completed" | "updated_at">) => Promise<boolean>;
  toggleComplete: (id: string) => Promise<void>;
  deleteAgenda: (id: string) => Promise<boolean>;
  updateAgenda: (id: string, updates: Partial<Agenda>) => Promise<boolean>;
  markAsShared: (dateKey: string, timestamp: string) => void;
};

export const useStore = create<StoreState>((set, get) => ({
  agendas: [],
  sharedDates: {},
  isLoading: true,
  error: null,

  fetchAgendas: async () => {
    set({ isLoading: true, error: null });
    const supabase = createClient();
    
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      const dummyAuth = typeof document !== 'undefined' && document.cookie.includes("dummy_auth=true");

      if (authError || (!user && !dummyAuth)) {
        set({ error: "Gagal memverifikasi sesi login Anda.", isLoading: false });
        // Jika dummy_auth true, biarkan data kosong saja (karena dummy auth tidak ada data real)
        return;
      }

      // Ambil data hanya punya user bersangkutan (karena RLS aktif, ini otomatis aman)
      const { data, error } = await supabase
        .from("agendas")
        .select("*")
        .order("scheduled_at", { ascending: true });

      if (error) {
        console.error("Gagal mengambil data dari Supabase:", error);
        set({ error: error.message, isLoading: false });
      } else {
        set({ agendas: data || [], isLoading: false, error: null });
      }
    } catch (e: any) {
      console.error(e);
      set({ error: e.message || "Terjadi kesalahan sistem", isLoading: false });
    }
  },

  addAgenda: async (agenda) => {
    const supabase = createClient();
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const newAgenda = {
        ...agenda,
        user_id: user?.id, // Jika tidak ada user ID, RLS supabase akan menolak secara otomatis
        is_completed: false,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from("agendas")
        .insert(newAgenda)
        .select()
        .single();

      if (error) {
        throw error;
      }

      if (data) {
        set((state) => ({
          agendas: [...state.agendas, data].sort(
            (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
          ),
        }));
        return true;
      }
      return false;
    } catch (e: any) {
      console.error("Gagal menambahkan agenda:", e);
      Swal.fire({
        icon: 'error',
        title: 'Gagal Tambah Data',
        text: e.message || 'Agenda gagal disimpan ke database. Coba lagi.'
      });
      return false;
    }
  },

  toggleComplete: async (id) => {
    const currentAgenda = get().agendas.find(a => a.id === id);
    if (!currentAgenda) return;

    const newStatus = !currentAgenda.is_completed;

    // Optimistic Update
    set((state) => ({
      agendas: state.agendas.map((a) =>
        a.id === id 
          ? { ...a, is_completed: newStatus, updated_at: new Date().toISOString() } 
          : a
      ),
    }));

    const supabase = createClient();
    const { error } = await supabase
      .from("agendas")
      .update({ is_completed: newStatus, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Gagal update status:", error);
      Swal.fire({ toast: true, position: 'top-end', icon: 'error', text: 'Gagal mengubah status', showConfirmButton: false, timer: 3000 });
      // Revert Optimistic Update
      set((state) => ({
        agendas: state.agendas.map((a) =>
          a.id === id ? { ...a, is_completed: !newStatus } : a
        ),
      }));
    }
  },

  deleteAgenda: async (id) => {
    const previousAgendas = get().agendas;
    
    // Optimistic Delete
    set((state) => ({
      agendas: state.agendas.filter((a) => a.id !== id),
    }));

    const supabase = createClient();
    const { error } = await supabase.from("agendas").delete().eq("id", id);
    
    if (error) {
      console.error("Gagal menghapus:", error);
      Swal.fire({
        icon: 'error',
        title: 'Gagal Menghapus',
        text: error.message
      });
      // Revert Optimistic Delete
      set({ agendas: previousAgendas });
      return false;
    }
    
    return true;
  },

  updateAgenda: async (id, updates) => {
    const previousAgendas = get().agendas;

    // Optimistic Update
    set((state) => ({
      agendas: state.agendas.map((a) => 
        (a.id === id ? { ...a, ...updates, updated_at: new Date().toISOString() } : a)
      ),
    }));

    const supabase = createClient();
    const { error } = await supabase
      .from("agendas")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Gagal mengupdate agenda:", error);
      Swal.fire({
        icon: 'error',
        title: 'Gagal Update',
        text: error.message
      });
      // Revert Optimistic Update
      set({ agendas: previousAgendas });
      return false;
    }
    return true;
  },

  markAsShared: (dateKey, timestamp) =>
    set((state) => ({
      sharedDates: {
        ...state.sharedDates,
        // Only set it if it's not already set, so it acts as 'firstSharedAt'
        [dateKey]: state.sharedDates[dateKey] || timestamp,
      }
    })),
}));
