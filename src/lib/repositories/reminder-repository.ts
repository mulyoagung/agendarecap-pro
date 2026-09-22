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
import { isNativePlatform, cancelNativeLocalAlarm, getScheduledNativeAlarms } from "@/lib/native-alarm";

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
    time: string; // HH:mm
    scheduledDate?: string; // YYYY-MM-DD
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

    // B-4: Validate — reject past times for one-time reminders if explicit scheduledDate/scheduledAt provided
    if (frequency === 'once') {
      if (scheduledMs <= nowMs) {
        if (input.scheduledDate || input.scheduledAt) {
          throw new Error('Waktu reminder sudah lewat. Pilih waktu yang masih akan datang.');
        } else {
          // Default to tomorrow same local time if reactivating an expired one-time reminder without date override
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const tomorrowStr = tomorrow.toISOString().split("T")[0];
          scheduledAtISO = getUTCISOFromLocal(tomorrowStr, input.time || "08:00", userTimezone);
        }
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
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const tomorrowStr = tomorrow.toISOString().split("T")[0];
          scheduledAtISO = getUTCISOFromLocal(tomorrowStr, input.time!, userTimezone);
        }
      }
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || 'offline_user';

    const nowISO = now.toISOString();

    const reminder: IDBReminder = {
      id: reminderId,
      user_id: userId,
      title: input.title,
      body: input.body || '',
      time: input.time,
      timezone: userTimezone,
      frequency: frequency,
      daysOfWeek: input.daysOfWeek,
      isActive: true,
      sound: input.sound || 'default',
      deliveryMode: 'hybrid',
      createdAt: nowISO,
      updatedAt: nowISO
    };

    const occurrence: IDBOccurrence = {
      id: occurrenceId,
      reminderId: reminderId,
      user_id: userId,
      scheduledAt: scheduledAtISO,
      status: 'scheduled',
      notificationTag: `reminder-${reminderId}-occurrence-${occurrenceId}`,
      createdAt: nowISO,
      updatedAt: nowISO
    };

    // Store in IDB synchronously
    await updateSingleReminderInIDB(reminder);
    await updateOccurrenceInIDB(occurrence);

    // Enqueue Mutation for Supabase Sync Engine
    const sanitizedRemPayload = sanitizeReminderForSupabase(reminder);
    const sanitizedOccPayload = sanitizeOccurrenceForSupabase(occurrence);

    await addToOfflineQueue({
      entity_type: 'reminder',
      entity_id: reminderId,
      operation: 'CREATE',
      payload: {
        reminder: sanitizedRemPayload,
        occurrence: sanitizedOccPayload
      },
      retry_count: 0,
      status: 'PENDING'
    });

    return { reminder, occurrence };
  }

  async update(id: string, updates: Partial<IDBReminder> & { scheduledDate?: string }): Promise<{ reminder: IDBReminder; occurrence?: IDBOccurrence } | null> {
    const reminders = await getRemindersFromIDB();
    const existing = reminders.find(r => r.id === id);
    if (!existing) return null;

    const now = new Date();
    const nowISO = now.toISOString();
    const userTimezone = updates.timezone || existing.timezone || "Asia/Jakarta";
    const targetFrequency = updates.frequency || existing.frequency || "once";
    const targetTime = updates.time || existing.time;

    const occurrences = await getOccurrencesFromIDB();
    const targetOccurrences = occurrences.filter(o => o.reminderId === id);
    const activeOcc = targetOccurrences.find(o => o.status === 'scheduled' || o.status === 'snoozed' || o.status === 'processing') || targetOccurrences[targetOccurrences.length - 1];

    let updatedOccurrence: IDBOccurrence | undefined;

    if (updates.scheduledDate || updates.time || updates.timezone || updates.frequency || updates.isActive !== undefined) {
      let targetDateStr = updates.scheduledDate;
      if (!targetDateStr && activeOcc?.scheduledAt) {
        try {
          targetDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone }).format(new Date(activeOcc.scheduledAt));
        } catch (_) {}
      }
      if (!targetDateStr) {
        targetDateStr = now.toISOString().split("T")[0];
      }

      let scheduledAtISO = getUTCISOFromLocal(targetDateStr, targetTime, userTimezone);
      const scheduledMs = new Date(scheduledAtISO).getTime();
      const nowMs = now.getTime();

      if (targetFrequency === 'once') {
        if (scheduledMs <= nowMs) {
          throw new Error('Waktu reminder sudah lewat. Pilih tanggal dan waktu yang masih akan datang.');
        }
      } else {
        if (scheduledMs <= nowMs) {
          const daysOfWeek = updates.daysOfWeek || existing.daysOfWeek;
          if (targetFrequency === 'daily') {
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            scheduledAtISO = getUTCISOFromLocal(tomorrow.toISOString().split("T")[0], targetTime, userTimezone);
          } else if (targetFrequency === 'weekdays') {
            let next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            while (next.getDay() === 0 || next.getDay() === 6) {
              next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
            }
            scheduledAtISO = getUTCISOFromLocal(next.toISOString().split("T")[0], targetTime, userTimezone);
          } else if (targetFrequency === 'weekly' && daysOfWeek && daysOfWeek.length > 0) {
            const targetDay = daysOfWeek[0];
            let next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            let attempts = 0;
            while (next.getDay() !== targetDay && attempts < 7) {
              next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
              attempts++;
            }
            scheduledAtISO = getUTCISOFromLocal(next.toISOString().split("T")[0], targetTime, userTimezone);
          } else {
            const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            scheduledAtISO = getUTCISOFromLocal(tomorrow.toISOString().split("T")[0], targetTime, userTimezone);
          }
        }
      }

      const occurrenceId = activeOcc ? activeOcc.id : crypto.randomUUID();

      if (activeOcc && activeOcc.id) {
        try {
          await cancelNativeLocalAlarm(activeOcc.id);
        } catch (_) {}
      }

      updatedOccurrence = {
        id: occurrenceId,
        reminderId: id,
        user_id: existing.user_id || 'offline_user',
        scheduledAt: scheduledAtISO,
        status: 'scheduled',
        snoozedUntil: undefined,
        notificationTag: `reminder-${id}-occurrence-${occurrenceId}`,
        createdAt: activeOcc?.createdAt || nowISO,
        updatedAt: nowISO
      };
    }

    // Only commit writes after validation succeeds!
    const updatedReminderObj: IDBReminder = {
      ...existing,
      ...updates,
      title: updates.title ? updates.title.trim() : existing.title,
      updatedAt: nowISO
    };

    await updateSingleReminderInIDB(updatedReminderObj);

    const sanitizedPayload = sanitizeReminderForSupabase(updates);
    sanitizedPayload.updated_at = nowISO;

    await addToOfflineQueue({
      entity_type: 'reminder',
      entity_id: id,
      operation: 'UPDATE',
      payload: sanitizedPayload,
      retry_count: 0,
      status: 'PENDING'
    });

    if (updatedOccurrence) {
      await updateOccurrenceInIDB(updatedOccurrence);

      const sanitizedOccPayload = sanitizeOccurrenceForSupabase(updatedOccurrence);

      await addToOfflineQueue({
        entity_type: 'occurrence',
        entity_id: updatedOccurrence.id,
        operation: 'UPDATE',
        payload: sanitizedOccPayload,
        retry_count: 0,
        status: 'PENDING'
      });
    }

    return { reminder: updatedReminderObj, occurrence: updatedOccurrence };
  }

  async toggleActive(id: string, isActive: boolean): Promise<IDBReminder | null> {
    const reminders = await getRemindersFromIDB();
    const target = reminders.find(r => r.id === id);
    if (!target) return null;

    const nowISO = new Date().toISOString();
    const updated: IDBReminder = {
      ...target,
      isActive,
      updatedAt: nowISO
    };

    await updateSingleReminderInIDB(updated);

    const sanitizedPayload = sanitizeReminderForSupabase(updated);

    await addToOfflineQueue({
      entity_type: 'reminder',
      entity_id: id,
      operation: 'UPDATE',
      payload: sanitizedPayload,
      retry_count: 0,
      status: 'PENDING'
    });

    return updated;
  }

  async snoozeOccurrence(reminderId: string, occurrenceId: string, minutes: number): Promise<IDBOccurrence | null> {
    const occurrences = await getOccurrencesFromIDB();
    const target = occurrences.find(o => o.id === occurrenceId);

    if (target) {
      const nowISO = new Date().toISOString();
      const snoozeTargetDate = new Date(Date.now() + minutes * 60 * 1000);
      const snoozedUntilISO = snoozeTargetDate.toISOString();

      const updated: IDBOccurrence = {
        ...target,
        status: 'snoozed',
        snoozedUntil: snoozedUntilISO,
        updatedAt: nowISO
      };

      await updateOccurrenceInIDB(updated);

      const sanitizedOccPayload = sanitizeOccurrenceForSupabase(updated);

      await addToOfflineQueue({
        entity_type: 'occurrence',
        entity_id: occurrenceId,
        operation: 'UPDATE',
        payload: sanitizedOccPayload,
        retry_count: 0,
        status: 'PENDING'
      });

      return updated;
    }

    return null;
  }

  async completeOccurrence(reminderId: string, occurrenceId: string): Promise<IDBOccurrence | null> {
    const occurrences = await getOccurrencesFromIDB();
    const target = occurrences.find(o => o.id === occurrenceId);

    if (target) {
      const nowISO = new Date().toISOString();
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
        entity_id: occurrenceId,
        operation: 'UPDATE',
        payload: sanitizedOccPayload,
        retry_count: 0,
        status: 'PENDING'
      });

      return updated;
    }

    return null;
  }

  async delete(id: string): Promise<boolean> {
    // 1. Cancel all native local alarms associated with this reminder before deleting
    try {
      const localOccurrences = await getOccurrencesFromIDB();
      const targetOccurrences = localOccurrences.filter(o => o.reminderId === id);
      for (const occ of targetOccurrences) {
        await cancelNativeLocalAlarm(occ.id);
      }

      if (isNativePlatform()) {
        const scheduledAlarms = await getScheduledNativeAlarms();
        for (const alarm of scheduledAlarms) {
          if (alarm.reminderId === id || alarm.occurrenceId && targetOccurrences.some(o => o.id === alarm.occurrenceId)) {
            await cancelNativeLocalAlarm(alarm.occurrenceId);
          }
        }
      }
    } catch (e) {
      console.warn('[REMINDER REPOSITORY] Native alarm cancellation warning on delete:', e);
    }

    // 2. Remove reminder and associated occurrences from IDB
    await deleteReminderFromIDB(id);

    // 3. Queue DELETE operation for remote Supabase sync
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
