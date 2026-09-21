import { 
  getAgendasFromIDB, 
  saveAgendasToIDB, 
  updateSingleAgendaInIDB, 
  deleteAgendaFromIDB, 
  addToOfflineQueue, 
  IDBAgenda 
} from "@/lib/idb";
import { createClient } from "@/lib/supabase/client";

export class AgendaRepository {
  async getLocal(): Promise<IDBAgenda[]> {
    const agendas = await getAgendasFromIDB();
    return agendas.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  }

  async getById(id: string): Promise<IDBAgenda | null> {
    const local = await this.getLocal();
    return local.find(a => a.id === id) || null;
  }

  async create(input: Omit<IDBAgenda, "id" | "is_completed" | "updated_at"> & { id?: string }): Promise<IDBAgenda> {
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const newAgenda: IDBAgenda = {
      ...input,
      id,
      user_id: user?.id || input.user_id,
      is_completed: false,
      status: input.status || 'confirmed',
      isShareable: input.isShareable !== undefined ? input.isShareable : true,
      isOnline: input.isOnline || false,
      include_notes_in_share: input.include_notes_in_share || false,
      created_at: now,
      updated_at: now
    };

    // 1. Write local IndexedDB
    await updateSingleAgendaInIDB(newAgenda);

    // 2. Enqueue mutation
    await addToOfflineQueue({
      entity_type: 'agenda',
      entity_id: id,
      operation: 'CREATE',
      payload: newAgenda,
      retry_count: 0,
      status: 'PENDING'
    });

    return newAgenda;
  }

  async update(id: string, updates: Partial<IDBAgenda>): Promise<IDBAgenda | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updatedAgenda: IDBAgenda = {
      ...existing,
      ...updates,
      id,
      updated_at: now
    };

    // 1. Write local IndexedDB
    await updateSingleAgendaInIDB(updatedAgenda);

    // 2. Enqueue mutation with explicit canonical entity_id and id in payload
    await addToOfflineQueue({
      entity_type: 'agenda',
      entity_id: id,
      operation: 'UPDATE',
      payload: { ...updates, id },
      retry_count: 0,
      status: 'PENDING'
    });

    return updatedAgenda;
  }

  async delete(id: string): Promise<boolean> {
    // 1. Delete from local IndexedDB
    await deleteAgendaFromIDB(id);

    // 2. Enqueue mutation
    await addToOfflineQueue({
      entity_type: 'agenda',
      entity_id: id,
      operation: 'DELETE',
      payload: { id },
      retry_count: 0,
      status: 'PENDING'
    });

    return true;
  }
}

export const agendaRepository = new AgendaRepository();
