import { 
  getRemindersFromIDB, 
  getOccurrencesFromIDB, 
  updateSingleReminderInIDB, 
  updateOccurrenceInIDB, 
  deleteReminderFromIDB, 
  addToOfflineQueue, 
  IDBReminder, 
  IDBOccurrence 
} from "@/lib/idb";
import { getUTCISOFromLocal } from "@/lib/timezone";
import { createClient } from "@/lib/supabase/client";
import { sanitizeReminderForSupabase, sanitizeOccurrenceForSupabase } from "@/lib/repositories/sanitizer";

export class ReminderRepository {
  async getLocalReminders(): Promise<IDBReminder[]> {
    return await getRemindersFromIDB();
  }

  async getLocalOccurrences(): Promise<IDBOccurrence[]> {
    return await getOccurrencesFromIDB();
  }

  async create(input: {
    id?: string;
    title: string;
    body?: string;
    time: string;
    scheduledDate?: string;
    scheduledAt?: string;
    timezone?: string;
    frequency?: 'once' | 'daily' | 'weekdays' | 'weekly';
    sound?: string;
    daysOfWeek?: number[];
  }): Promise<{ reminder: IDBReminder; occurrence: IDBOccurrence }> {
    const reminderId = input.id || crypto.randomUUID();
    const occurrenceId = crypto.randomUUID();
    const now = new Date();
    const userTimezone = input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";

    let scheduledAtISO = input.scheduledAt;
    if (!scheduledAtISO && input.time) {
      const targetDateStr = input.scheduledDate || now.toISOString().split("T")[0];
      scheduledAtISO = getUTCISOFromLocal(targetDateStr, input.time, userTimezone);
    }

    if (!scheduledAtISO) scheduledAtISO = now.toISOString();

    const frequency = input.frequency || 'once';
    const scheduledMs = new Date(scheduledAtISO).getTime();
    const nowMs = now.getTime();

    // B-4: Validate — reject past times for one-time reminders
    if (frequency === 'once') {
      if (scheduledMs <= nowMs) {
        throw new Error('Waktu reminder sudah lewat. Pilih waktu yang masih akan datang.');
      }
    } else {
      // For recurring reminders: if current slot already passed today, advance to next valid occurrence
      if (scheduledMs <= nowMs) {
        const daysOfWeek = input.daysOfWeek;

        if (frequency === 'daily') {
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const tomorrowStr = tomorrow.toISOString().split("T")[0];
          scheduledAtISO = getUTCISOFromLocal(tomorrowStr, input.time!, userTimezone);
        } else if (frequency === 'weekdays') {
          let next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          while (next.getDay() === 0 || next.getDay() === 6) {
            next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
          }
          scheduledAtISO = getUTCISOFromLocal(next.toISOString().split("T")[0], input.time!, userTimezone);
        } else if (frequency === 'weekly' && daysOfWeek && daysOfWeek.length > 0) {
          const targetDay = daysOfWeek[0];
          let next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          let attempts = 0;
          while (next.getDay() !== targetDay && attempts < 7) {
            next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
            attempts++;
          }
          scheduledAtISO = getUTCISOFromLocal(next.toISOString().split("T")[0], input.time!, userTimezone);
        } else {
          // fallback daily
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          scheduledAtISO = getUTCISOFromLocal(tomorrow.toISOString().split("T")[0], input.time!, userTimezone);
        }
      }
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const newReminder: IDBReminder = {
      id: reminderId,
      user_id: user?.id,
      title: input.title.trim(),
      body: input.body || '',
      time: input.time || "08:00",
      timezone: userTimezone,
      frequency: input.frequency || "once",
      daysOfWeek: input.daysOfWeek,
      sound: input.sound || "default",
      isActive: true,
      deliveryMode: 'hybrid',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    const newOccurrence: IDBOccurrence = {
      id: occurrenceId,
      reminderId,
      user_id: user?.id,
      scheduledAt: scheduledAtISO,
      status: "scheduled",
      notificationTag: `reminder-${reminderId}-occurrence-${occurrenceId}`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };

    // 1. Write local IndexedDB (Preserves full local structure for UI)
    await updateSingleReminderInIDB(newReminder);
    await updateOccurrenceInIDB(newOccurrence);

    // 2. Enqueue sanitized mutation payload for Supabase sync
    await addToOfflineQueue({
      entity_type: 'reminder',
      entity_id: reminderId,
      operation: 'CREATE',
      payload: {
        reminder: sanitizeReminderForSupabase(newReminder),
        occurrence: sanitizeOccurrenceForSupabase(newOccurrence)
      },
      retry_count: 0,
      status: 'PENDING'
    });

    return { reminder: newReminder, occurrence: newOccurrence };
  }

  async update(id: string, updates: Partial<IDBReminder> & { scheduledDate?: string }): Promise<IDBReminder | null> {
    const reminders = await this.getLocalReminders();
    const existing = reminders.find(r => r.id === id);
    if (!existing) return null;

    const now = new Date();
    const userTimezone = updates.timezone || existing.timezone || "Asia/Jakarta";

    const updatedReminderObj: IDBReminder = {
      ...existing,
      ...updates,
      title: updates.title ? updates.title.trim() : existing.title,
      updatedAt: now.toISOString()
    };

    // 1. Write local IndexedDB
    await updateSingleReminderInIDB(updatedReminderObj);

    // 2. Enqueue sanitized mutation payload for Supabase sync
    const sanitizedPayload = sanitizeReminderForSupabase(updates);
    sanitizedPayload.updated_at = now.toISOString();

    await addToOfflineQueue({
      entity_type: 'reminder',
      entity_id: id,
      operation: 'UPDATE',
      payload: sanitizedPayload,
      retry_count: 0,
      status: 'PENDING'
    });

    return updatedReminderObj;
  }

  async snoozeOccurrence(reminderId: string, occurrenceId: string, minutes: number): Promise<IDBOccurrence | null> {
    const occurrences = await this.getLocalOccurrences();
    const target = occurrences.find(o => o.reminderId === reminderId && (o.id === occurrenceId || occurrenceId === 'unknown'));

    const now = new Date();
    const snoozeDate = new Date(now.getTime() + minutes * 60 * 1000);
    const snoozeISO = snoozeDate.toISOString();

    if (target) {
      const updated: IDBOccurrence = {
        ...target,
        status: 'snoozed',
        snoozedUntil: snoozeISO,
        updatedAt: now.toISOString()
      };
      await updateOccurrenceInIDB(updated);

      const sanitizedOccPayload = sanitizeOccurrenceForSupabase({
        id: target.id,
        reminder_id: reminderId,
        status: 'snoozed',
        snoozed_until: snoozeISO,
        updated_at: now.toISOString()
      });

      await addToOfflineQueue({
        entity_type: 'occurrence',
        entity_id: target.id,
        operation: 'SNOOZE',
        payload: sanitizedOccPayload,
        retry_count: 0,
        status: 'PENDING'
      });

      return updated;
    }

    return null;
  }

  async completeOccurrence(reminderId: string, occurrenceId: string): Promise<IDBOccurrence | null> {
    const occurrences = await this.getLocalOccurrences();
    const target = occurrences.find(o => o.reminderId === reminderId && (o.id === occurrenceId || occurrenceId === 'unknown'));

    const nowISO = new Date().toISOString();

    if (target) {
      const updated: IDBOccurrence = {
        ...target,
        status: 'completed',
        completedAt: nowISO,
        updatedAt: nowISO
      };
      await updateOccurrenceInIDB(updated);

      const sanitizedOccPayload = sanitizeOccurrenceForSupabase({
        id: target.id,
        reminder_id: reminderId,
        status: 'completed',
        completed_at: nowISO,
        updated_at: nowISO
      });

      await addToOfflineQueue({
        entity_type: 'occurrence',
        entity_id: target.id,
        operation: 'COMPLETE',
        payload: sanitizedOccPayload,
        retry_count: 0,
        status: 'PENDING'
      });

      return updated;
    }

    return null;
  }

  async delete(id: string): Promise<boolean> {
    await deleteReminderFromIDB(id);

    await addToOfflineQueue({
      entity_type: 'reminder',
      entity_id: id,
      operation: 'DELETE',
      payload: { id },
      retry_count: 0,
      status: 'PENDING'
    });

    return true;
  }
}

export const reminderRepository = new ReminderRepository();
