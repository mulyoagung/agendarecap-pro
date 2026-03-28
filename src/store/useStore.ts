import { create } from "zustand";
import { addDays } from "date-fns";

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
  addAgenda: (agenda: Omit<Agenda, "id" | "is_completed" | "updated_at">) => void;
  toggleComplete: (id: string) => void;
  deleteAgenda: (id: string) => void;
  updateAgenda: (id: string, updates: Partial<Agenda>) => void;
  markAsShared: (dateKey: string, timestamp: string) => void;
};

// Generate dummy data
const today = new Date();
const tomorrow = addDays(today, 1);

const generateDummyData = (): Agenda[] => [
  {
    id: "1",
    title: "Meeting Koordinasi",
    location: "Google Meet",
    notes: "Membahas progres proyek kuartal 1 bersama tim dev.",
    scheduled_at: new Date(today.setHours(9, 0, 0, 0)).toISOString(),
    is_completed: true,
    include_notes_in_share: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: "2",
    title: "Review Dokumentasi API",
    location: "Ruang Rapat 2",
    notes: "Mengecek kelengkapan endpoint login dan register.",
    scheduled_at: new Date(today.setHours(13, 0, 0, 0)).toISOString(),
    is_completed: false,
    include_notes_in_share: false,
    updated_at: new Date().toISOString(),
  },
  {
    id: "3",
    title: "Kirim Laporan Mingguan",
    location: "Kantor",
    scheduled_at: new Date(today.setHours(16, 0, 0, 0)).toISOString(),
    is_completed: false,
    include_notes_in_share: false,
    updated_at: new Date().toISOString(),
  },
  {
    id: "4",
    title: "Client Pitching",
    location: "SCBD Tower",
    notes: "Presentasi desain aplikasi AgendaRecap.",
    scheduled_at: new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString(),
    is_completed: false,
    include_notes_in_share: true,
    updated_at: new Date().toISOString(),
  },
];

export const useStore = create<StoreState>((set) => ({
  agendas: generateDummyData(),
  sharedDates: {},
  
  addAgenda: (agenda) =>
    set((state) => ({
      agendas: [
        ...state.agendas,
        {
          ...agenda,
          id: Math.random().toString(36).substring(7),
          is_completed: false,
          updated_at: new Date().toISOString(),
        },
      ].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()),
    })),
    
  toggleComplete: (id) =>
    set((state) => ({
      agendas: state.agendas.map((a) =>
        a.id === id 
          ? { ...a, is_completed: !a.is_completed, updated_at: new Date().toISOString() } 
          : a
      ),
    })),
    
  deleteAgenda: (id) =>
    set((state) => ({
      agendas: state.agendas.filter((a) => a.id !== id),
    })),
    
  updateAgenda: (id, updates) =>
    set((state) => ({
      agendas: state.agendas.map((a) => 
        (a.id === id ? { ...a, ...updates, updated_at: new Date().toISOString() } : a)
      ),
    })),
    
  markAsShared: (dateKey, timestamp) =>
    set((state) => ({
      sharedDates: {
        ...state.sharedDates,
        // Only set it if it's not already set, so it acts as 'firstSharedAt'
        [dateKey]: state.sharedDates[dateKey] || timestamp,
      }
    })),
}));
