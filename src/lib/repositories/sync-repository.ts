import { 
  getOfflineQueue, 
  removeFromOfflineQueue, 
  updateQueueItemInIDB,
  getAgendasFromIDB, 
  saveAgendasToIDB,
  deleteAgendaFromIDB,
  getRemindersFromIDB, 
  saveRemindersToIDB,
  deleteReminderFromIDB, 
  getOccurrencesFromIDB, 
  saveOccurrencesToIDB,
  repairOrphanDataAndQueueInIDB,
  IDBOfflineQueueItem,
  IDBAgenda,
  IDBReminder,
  IDBOccurrence
} from "@/lib/idb";
import { createClient } from "@/lib/supabase/client";
import { isNativePlatform, getScheduledNativeAlarms, scheduleNativeLocalAlarm, cancelNativeLocalAlarm } from "@/lib/native-alarm";
import { 
  sanitizeAgendaForSupabase, 
  sanitizeReminderForSupabase, 
  sanitizeOccurrenceForSupabase 
} from "@/lib/repositories/sanitizer";
import { getUTCISOFromLocal, getTodayLocalYYYYMMDD } from "@/lib/timezone";

export function serializeSupabaseError(error: unknown) {
  if (!error) return null;
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    const rawMsg = String(e.message || e.details || e.hint || '');
    const code = String(e.code || 'UNKNOWN');
    const displayMsg = rawMsg && rawMsg !== '1' && rawMsg !== '{}' && rawMsg !== '[object Object]'
      ? rawMsg 
      : `Gagal komunikasi Supabase (Code: ${code})`;
    return {
      message: displayMsg,
      code,
      details: e.details || null,
      hint: e.hint || null,
      name: e.name || 'SupabaseError',
      stringified: JSON.stringify(error),
    };
  }
  const str = String(error);
  return { message: str && str !== '1' ? str : 'Gagal sinkronisasi database' };
}

let activeSyncPromise: Promise<{ success: boolean; syncedCount: number; errors: string[] }> | null = null;

/**
 * Migration helper to convert legacy offline queue items (v1/v2) into standardized v3 queue items.
 */
function migrateLegacyQueueItem(item: any): IDBOfflineQueueItem {
  if (item.entity_type && item.operation) {
    return item as IDBOfflineQueueItem;
  }

  const type: string = item.type || '';
  const now = Date.now();

  if (type === 'CREATE_REMINDER') {
    return {
      id: item.id || `q_${now}`,
      entity_type: 'reminder',
      entity_id: item.payload?.id || 'unknown',
      operation: 'CREATE',
      payload: {
        reminder: sanitizeReminderForSupabase(item.payload),
        occurrence: item.payload?.occurrenceId ? sanitizeOccurrenceForSupabase({
          id: item.payload.occurrenceId,
          reminder_id: item.payload.id,
          scheduled_at: item.payload.scheduledAt
        }) : undefined
      },
      created_at: item.createdAt || now,
      retry_count: 0,
      status: 'PENDING'
    };
  } else if (type === 'UPDATE_REMINDER') {
    return {
      id: item.id || `q_${now}`,
      entity_type: 'reminder',
      entity_id: item.payload?.id || 'unknown',
      operation: 'UPDATE',
      payload: sanitizeReminderForSupabase(item.payload),
      created_at: item.createdAt || now,
      retry_count: 0,
      status: 'PENDING'
    };
  } else if (type === 'DELETE_REMINDER') {
    return {
      id: item.id || `q_${now}`,
      entity_type: 'reminder',
      entity_id: item.payload?.id || 'unknown',
      operation: 'DELETE',
      payload: { id: item.payload?.id },
      created_at: item.createdAt || now,
      retry_count: 0,
      status: 'PENDING'
    };
  } else if (type === 'SNOOZE_OCCURRENCE') {
    return {
      id: item.id || `q_${now}`,
      entity_type: 'occurrence',
      entity_id: item.payload?.occurrenceId || item.payload?.reminderId || 'unknown',
      operation: 'SNOOZE',
      payload: sanitizeOccurrenceForSupabase({
        id: item.payload?.occurrenceId,
        reminder_id: item.payload?.reminderId,
        status: 'snoozed',
        snoozed_until: item.payload?.snoozedUntil
      }),
      created_at: item.createdAt || now,
      retry_count: 0,
      status: 'PENDING'
    };
  } else if (type === 'COMPLETE_OCCURRENCE') {
    return {
      id: item.id || `q_${now}`,
      entity_type: 'occurrence',
      entity_id: item.payload?.occurrenceId || item.payload?.reminderId || 'unknown',
      operation: 'COMPLETE',
      payload: sanitizeOccurrenceForSupabase({
        id: item.payload?.occurrenceId,
        reminder_id: item.payload?.reminderId,
        status: 'completed',
        completed_at: new Date().toISOString()
      }),
      created_at: item.createdAt || now,
      retry_count: 0,
      status: 'PENDING'
    };
  }

  return {
    id: item.id || `q_${now}`,
    entity_type: 'agenda',
    entity_id: item.entity_id || 'unknown',
    operation: item.operation || 'UPDATE',
    payload: item.payload,
    created_at: item.createdAt || now,
    retry_count: 0,
    status: 'PENDING'
  };
}

function getQueueItemPriority(item: IDBOfflineQueueItem): number {
  if (item.entity_type === 'reminder') {
    if (item.operation === 'CREATE') return 1;
    if (item.operation === 'UPDATE') return 2;
    if (item.operation === 'DELETE') return 8;
  }
  if (item.entity_type === 'occurrence') {
    if (item.operation === 'CREATE') return 3;
    if (item.operation === 'UPDATE') return 4;
    if (item.operation === 'SNOOZE' || item.operation === 'COMPLETE' || item.operation === 'DISMISS') return 5;
    if (item.operation === 'DELETE') return 7;
  }
  if (item.entity_type === 'agenda') {
    if (item.operation === 'CREATE' || item.operation === 'UPDATE') return 6;
    if (item.operation === 'DELETE') return 8;
  }
  return 9;
}

function getOccurrenceParentReminderId(item: IDBOfflineQueueItem): string | null {
  if (item.entity_type === 'occurrence') {
    if (item.payload && typeof item.payload === 'object') {
      return item.payload.reminder_id || item.payload.reminderId || null;
    }
  }
  return null;
}

export class SyncRepository {
  async isOnline(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    return navigator.onLine;
  }

  async runSync(): Promise<{ success: boolean; syncedCount: number; errors: string[] }> {
    const online = await this.isOnline();
    if (!online) {
      return { success: false, syncedCount: 0, errors: ['Device is offline'] };
    }

    if (activeSyncPromise) {
      console.log('[SYNC ENGINE] Synchronization already in progress, attaching to active promise.');
      return activeSyncPromise;
    }

    activeSyncPromise = this.performSync();
    try {
      return await activeSyncPromise;
    } finally {
      activeSyncPromise = null;
    }
  }

  private async performSync(): Promise<{ success: boolean; syncedCount: number; errors: string[] }> {
    console.log('[SYNC ENGINE] Starting synchronization...');

    const errors: string[] = [];
    let syncedCount = 0;
    const supabase = createClient();

    try {
      // 0. Check Auth & Repair Orphan Local Data / Queue
      const { data: { session } } = await supabase.auth.getSession();
      let user = session?.user || null;

      // Fallback: check localStorage for cached Supabase auth token
      if (!user && typeof window !== 'undefined') {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
              const item = localStorage.getItem(key);
              if (item) {
                const parsed = JSON.parse(item);
                const cachedUser = parsed?.user || parsed?.currentSession?.user;
                if (cachedUser && cachedUser.id) {
                  user = cachedUser;
                  if (parsed.access_token && parsed.refresh_token && parsed.access_token !== 'offline-token') {
                    try {
                      const { data: setRes } = await supabase.auth.setSession({
                        access_token: parsed.access_token,
                        refresh_token: parsed.refresh_token
                      });
                      if (setRes?.user) {
                        user = setRes.user;
                      }
                    } catch (e) {
                      console.warn('[SYNC ENGINE] setSession fallback warning:', e);
                    }
                  }
                  break;
                }
              }
            }
          }
        } catch (_) {}
      }

      if (user) {
        console.log(`[SYNC ENGINE] Authenticated user active: ${user.id}`);
        await repairOrphanDataAndQueueInIDB(user.id);
      } else {
        console.warn('[SYNC ENGINE] No active authenticated user session. Pausing mutation queue processing until authenticated.');
        return {
          success: false,
          syncedCount: 0,
          errors: ['No authenticated user session']
        };
      }

      // 1. Process Offline Queue Mutations via Direct Supabase SDK
      const rawQueue = await getOfflineQueue();
      console.log(`[SYNC ENGINE] Processing ${rawQueue.length} pending mutations...`);

      const sortedQueue = rawQueue.map(raw => ({
        rawItem: raw,
        item: migrateLegacyQueueItem(raw)
      }));

      sortedQueue.sort((a, b) => {
        const pA = getQueueItemPriority(a.item);
        const pB = getQueueItemPriority(b.item);
        if (pA !== pB) return pA - pB;
        return (a.item.created_at || 0) - (b.item.created_at || 0);
      });

      const syncedReminderIdsInBatch = new Set<string>();

      for (const { rawItem, item } of sortedQueue) {
        if (item.status === 'FAILED_FATAL') continue;

        // Parent Existence Guard for Occurrence CREATE Mutations
        if (item.entity_type === 'occurrence' && item.operation === 'CREATE') {
          const parentRemId = getOccurrenceParentReminderId(item);
          if (parentRemId) {
            let parentExistsOnServer = syncedReminderIdsInBatch.has(parentRemId);
            if (!parentExistsOnServer) {
              const { data: parentRow, error: parentCheckErr } = await supabase
                .from('reminders')
                .select('id')
                .eq('id', parentRemId)
                .maybeSingle();

              if (!parentCheckErr && parentRow) {
                parentExistsOnServer = true;
                syncedReminderIdsInBatch.add(parentRemId);
              } else {
                // Check if parent reminder exists in local IndexedDB to sync parent first
                const localParent = (await getRemindersFromIDB()).find(r => r.id === parentRemId);
                if (localParent) {
                  const reminderPayload = sanitizeReminderForSupabase(localParent);
                  if (user) reminderPayload.user_id = user.id;
                  const { error: pErr } = await supabase.from('reminders').upsert(reminderPayload);
                  if (!pErr) {
                    parentExistsOnServer = true;
                    syncedReminderIdsInBatch.add(parentRemId);
                    console.log(`[SYNC ENGINE] Auto-synced local parent reminder before occurrence CREATE | Reminder ID: ${parentRemId}`);
                  }
                }
              }
            }

            if (!parentExistsOnServer) {
              const localParentExists = (await getRemindersFromIDB()).some(r => r.id === parentRemId);
              if (!localParentExists && (item.retry_count || 0) >= 2) {
                console.warn(`[SYNC ENGINE] Occurrence CREATE parent permanently missing (Reminder ID: ${parentRemId}). Purging orphaned occurrence ${item.entity_id}.`);
                await removeFromOfflineQueue(rawItem.id);
                continue;
              }

              console.warn(`[SYNC ENGINE] Occurrence CREATE deferred — parent reminder not yet synced | Reminder ID: ${parentRemId} | Occurrence ID: ${item.entity_id}`);
              await updateQueueItemInIDB({
                ...item,
                id: rawItem.id,
                retry_count: (item.retry_count || 0) + 1,
                status: 'PENDING',
                error_message: `Menunggu sinkronisasi pengingat induk (Reminder ID: ${parentRemId})`
              });
              continue; // DEFER: Skip processing for now, leave in queue as PENDING with descriptive message
            } else {
              console.log(`[SYNC ENGINE] Dependent occurrence parent verified | Occurrence ID: ${item.entity_id}`);
            }
          }
        }

        try {
          let success = false;
          let queryError: any = null;

          if (item.entity_type === 'agenda') {
            if (item.operation === 'CREATE') {
              const sanitizedPayload = sanitizeAgendaForSupabase(item.payload);
              if (!sanitizedPayload.id) {
                sanitizedPayload.id = item.entity_id;
              }
              if (user) {
                sanitizedPayload.user_id = user.id;
              }

              let { error } = await supabase
                .from('agendas')
                .upsert(sanitizedPayload);

              if (error && error.code === 'PGRST204' && (sanitizedPayload as any).time_mode !== undefined) {
                console.warn('[SYNC ENGINE] Column time_mode not found in schema cache, retrying upsert without time_mode...');
                delete (sanitizedPayload as any).time_mode;
                const retry = await supabase.from('agendas').upsert(sanitizedPayload);
                error = retry.error;
              }

              queryError = error;
              success = !error;
            } else if (item.operation === 'UPDATE') {
              const sanitizedPayload = sanitizeAgendaForSupabase(item.payload);
              delete sanitizedPayload.id; // Primary key column remains unchanged
              if (user) {
                sanitizedPayload.user_id = user.id;
              }

              let { data, error } = await supabase
                .from('agendas')
                .update(sanitizedPayload)
                .eq('id', item.entity_id)
                .select();

              if (error && error.code === 'PGRST204' && (sanitizedPayload as any).time_mode !== undefined) {
                console.warn('[SYNC ENGINE] Column time_mode not found in schema cache, retrying update without time_mode...');
                delete (sanitizedPayload as any).time_mode;
                const retry = await supabase
                  .from('agendas')
                  .update(sanitizedPayload)
                  .eq('id', item.entity_id)
                  .select();
                error = retry.error;
                data = retry.data;
              }

              // Fallback to upsert if update affected 0 rows (e.g. entity was created offline)
              if (!error && (!data || data.length === 0)) {
                console.log(`[SYNC ENGINE] Agenda UPDATE affected 0 rows for ID ${item.entity_id}, falling back to upsert...`);
                const fullPayload: any = {
                  ...sanitizedPayload,
                  id: item.entity_id,
                  user_id: user ? user.id : sanitizedPayload.user_id
                };
                const upsertRes = await supabase.from('agendas').upsert(fullPayload);
                error = upsertRes.error;
              }

              queryError = error;
              success = !error;
            } else if (item.operation === 'DELETE') {
              const { data, error } = await supabase
                .from('agendas')
                .delete()
                .eq('id', item.entity_id)
                .select();
              queryError = error;
              const deletedCount = data ? data.length : 0;

              if (error) {
                success = false;
              } else if (deletedCount > 0) {
                success = true;
                console.log(`[SYNC] Agenda DELETE completed: ${deletedCount} row(s) deleted in Supabase for ID ${item.entity_id}`);
              } else {
                const { data: existingRow, error: checkErr } = await supabase
                  .from('agendas')
                  .select('id')
                  .eq('id', item.entity_id)
                  .maybeSingle();

                if (!checkErr && !existingRow) {
                  success = true;
                  console.log(`[SYNC] Agenda DELETE verified idempotently complete: row ${item.entity_id} does not exist on Supabase server.`);
                } else {
                  success = false;
                  queryError = checkErr || { code: 'RLS_OR_ZERO_ROWS', message: `0 rows affected during DELETE for agenda ${item.entity_id}` };
                }
              }
            }
          } else if (item.entity_type === 'reminder') {
            if (item.operation === 'CREATE') {
              const reminderPayload = sanitizeReminderForSupabase(item.payload.reminder || item.payload);
              let occurrencePayload = item.payload.occurrence ? sanitizeOccurrenceForSupabase(item.payload.occurrence) : null;

              if (user) {
                reminderPayload.user_id = user.id;
              }

              console.log(`[CMD LOG][SYNC ENGINE] Pushing Reminder to Supabase: ID="${reminderPayload.id}" Title="${reminderPayload.title}" UserID="${reminderPayload.user_id}"`);

              const { error: rErr } = await supabase.from('reminders').upsert(reminderPayload);
              if (rErr) {
                console.warn('[CMD LOG][SYNC ENGINE] Reminders table upsert FAILED:', rErr.message, rErr.code);
              } else {
                console.log('[CMD LOG][SYNC ENGINE] Reminders table upsert SUCCESS');
                if (reminderPayload.id) {
                  syncedReminderIdsInBatch.add(reminderPayload.id);
                  console.log(`[SYNC ENGINE] Parent reminder synced successfully | Reminder ID: ${reminderPayload.id}`);
                }
              }

              let oErr: any = null;

              // Defensive Fallback: If occurrencePayload is missing from queue item, construct it on the fly
              if (!occurrencePayload && (reminderPayload.id || item.entity_id)) {
                const targetRemId = reminderPayload.id || item.entity_id;
                const occId = crypto.randomUUID();
                const remTz = reminderPayload.timezone || 'Asia/Jakarta';
                const remTime = reminderPayload.time || '08:00';
                const todayLocal = getTodayLocalYYYYMMDD(remTz);
                const schedISO = getUTCISOFromLocal(todayLocal, remTime, remTz);

                occurrencePayload = {
                  id: occId,
                  reminder_id: targetRemId,
                  scheduled_at: schedISO,
                  status: 'scheduled',
                  notification_tag: `reminder-${targetRemId}-occurrence-${occId}`
                };
              }

              if (occurrencePayload && (occurrencePayload.id || item.entity_id)) {
                if (!occurrencePayload.reminder_id) {
                  occurrencePayload.reminder_id = reminderPayload.id || item.entity_id;
                }
                if (!occurrencePayload.scheduled_at) {
                  occurrencePayload.scheduled_at = new Date().toISOString();
                }
                if (!occurrencePayload.notification_tag && occurrencePayload.reminder_id && occurrencePayload.id) {
                  occurrencePayload.notification_tag = `reminder-${occurrencePayload.reminder_id}-occurrence-${occurrencePayload.id}`;
                }
                delete (occurrencePayload as any).user_id;

                console.log(`[CMD LOG][SYNC ENGINE] Pushing Occurrence to Supabase: ID="${occurrencePayload.id}" ScheduledAt="${occurrencePayload.scheduled_at}"`);

                const { error: errorOcc } = await supabase.from('reminder_occurrences').upsert(occurrencePayload);
                if (errorOcc) {
                  console.warn('[CMD LOG][SYNC ENGINE] Reminder occurrences table upsert FAILED:', errorOcc.message, errorOcc.code);
                  oErr = errorOcc;
                } else {
                  console.log('[CMD LOG][SYNC ENGINE] Reminder occurrences table upsert SUCCESS');
                }
              }

              queryError = rErr || oErr;
              success = !rErr && !oErr;
            } else if (item.operation === 'UPDATE') {
              const sanitizedPayload = sanitizeReminderForSupabase(item.payload);
              delete sanitizedPayload.id;

              if (user) {
                sanitizedPayload.user_id = user.id;
              }

              const { error } = await supabase
                .from('reminders')
                .update(sanitizedPayload)
                .eq('id', item.entity_id);
              queryError = error;
              success = !error;
              if (success && item.entity_id) {
                syncedReminderIdsInBatch.add(item.entity_id);
                console.log(`[SYNC ENGINE] Parent reminder synced successfully | Reminder ID: ${item.entity_id}`);
              }
            } else if (item.operation === 'DELETE') {
              const { data, error } = await supabase
                .from('reminders')
                .delete()
                .eq('id', item.entity_id)
                .select();
              queryError = error;
              const deletedCount = data ? data.length : 0;

              if (error) {
                success = false;
                console.error('[SYNC] Reminder DELETE failed with Supabase error:', {
                  reminderId: item.entity_id,
                  mutationId: rawItem.id,
                  operation: 'DELETE',
                  errorCode: error.code,
                  errorMessage: error.message,
                  errorDetails: error.details,
                  authenticatedUser: user?.id || 'UNAUTHENTICATED'
                });
              } else if (deletedCount > 0) {
                success = true;
                console.log(`[SYNC] Reminder DELETE succeeded: deleted ${deletedCount} row(s) in Supabase for ID ${item.entity_id}`);
              } else {
                const { data: existingRow, error: checkErr } = await supabase
                  .from('reminders')
                  .select('id')
                  .eq('id', item.entity_id)
                  .maybeSingle();

                if (!checkErr && !existingRow) {
                  success = true;
                  console.log(`[SYNC] Reminder DELETE verified idempotently complete: row ${item.entity_id} does not exist on Supabase server.`);
                } else {
                  success = false;
                  queryError = checkErr || { code: 'RLS_OR_ZERO_ROWS', message: `0 rows affected during DELETE for reminder ${item.entity_id}` };
                  console.warn(`[SYNC] Reminder DELETE returned 0 rows affected, but row still exists or RLS restricted for ID ${item.entity_id}. Retaining queue item for retry.`);
                }
              }
            }
          } else if (item.entity_type === 'occurrence') {
            if (item.operation === 'SNOOZE') {
              const sanitizedPayload = sanitizeOccurrenceForSupabase(item.payload);
              delete (sanitizedPayload as any).user_id;
              const { error } = await supabase
                .from('reminder_occurrences')
                .update({
                  status: 'snoozed',
                  snoozed_until: sanitizedPayload.snoozed_until || item.payload.snoozedUntil,
                  updated_at: new Date().toISOString()
                })
                .eq('id', item.entity_id);
              queryError = error;
              success = !error;
            } else if (item.operation === 'COMPLETE' || item.operation === 'DISMISS') {
              const statusVal = item.operation === 'COMPLETE' ? 'completed' : 'dismissed';
              const nowISO = new Date().toISOString();
              const updatePayload: any = {
                status: statusVal,
                completed_at: item.operation === 'COMPLETE' ? nowISO : null,
                dismissed_at: item.operation === 'DISMISS' ? nowISO : null,
                updated_at: nowISO
              };

              const { data: updateData, error: updateErr } = await supabase
                .from('reminder_occurrences')
                .update(updatePayload)
                .eq('id', item.entity_id)
                .select();

              if (!updateErr && updateData && updateData.length > 0) {
                queryError = null;
                success = true;
                console.log(`[CMD LOG][SYNC ENGINE] Occurrence ${item.operation} success: ID="${item.entity_id}"`);
              } else {
                // 0 rows updated — check if the occurrence already has the target status (idempotent success)
                const { data: occCheck } = await supabase
                  .from('reminder_occurrences')
                  .select('id, status')
                  .eq('id', item.entity_id)
                  .maybeSingle();

                if (occCheck && occCheck.status === statusVal) {
                  // Already in target state — treat as success (idempotent)
                  queryError = null;
                  success = true;
                  console.log(`[SYNC ENGINE] Occurrence ${item.entity_id} already has status "${statusVal}" — idempotent COMPLETE resolved.`);
                } else if (!occCheck) {
                  // Row doesn't exist on server — try upsert with parent resolution
                  const parentRemId = getOccurrenceParentReminderId(item);
                  let parentAvailable = false;

                  if (parentRemId) {
                    if (syncedReminderIdsInBatch.has(parentRemId)) {
                      parentAvailable = true;
                    } else {
                      const { data: parentRow } = await supabase.from('reminders').select('id').eq('id', parentRemId).maybeSingle();
                      if (parentRow) {
                        parentAvailable = true;
                        syncedReminderIdsInBatch.add(parentRemId);
                      } else {
                        // Check local IDB for parent reminder
                        const localParent = (await getRemindersFromIDB()).find(r => r.id === parentRemId);
                        if (localParent) {
                          const reminderPayload = sanitizeReminderForSupabase(localParent);
                          if (user) reminderPayload.user_id = user.id;
                          const { error: pErr } = await supabase.from('reminders').upsert(reminderPayload);
                          if (!pErr) {
                            parentAvailable = true;
                            syncedReminderIdsInBatch.add(parentRemId);
                            console.log(`[SYNC ENGINE] Auto-synced local parent reminder before occurrence ${item.operation} | Reminder ID: ${parentRemId}`);
                          }
                        }
                      }
                    }
                  }

                  if (!parentRemId) {
                    // No reminder_id at all — occurrence is orphaned with no way to upsert it safely.
                    // Treat as resolved to prevent infinite retry.
                    console.warn(`[SYNC ENGINE] Occurrence ${item.entity_id} COMPLETE has no reminder_id and row missing on server. Resolving as orphan.`);
                    queryError = null;
                    success = true;
                  } else if (!parentAvailable) {
                    // Parent reminder missing from both server and local IDB -> Orphan occurrence!
                    console.warn(`[SYNC ENGINE] Occurrence ${item.entity_id} parent ${parentRemId} missing on server and locally. Resolving orphan mutation.`);
                    queryError = null;
                    success = true;
                  } else {
                    const sanitizedPayload = sanitizeOccurrenceForSupabase(item.payload || {});
                    sanitizedPayload.id = item.entity_id;
                    sanitizedPayload.status = statusVal;
                    sanitizedPayload.completed_at = updatePayload.completed_at;
                    sanitizedPayload.updated_at = nowISO;
                    delete (sanitizedPayload as any).user_id;
                    if (!sanitizedPayload.scheduled_at) sanitizedPayload.scheduled_at = nowISO;
                    if (!sanitizedPayload.reminder_id) sanitizedPayload.reminder_id = parentRemId;

                    const { error: upsertErr } = await supabase
                      .from('reminder_occurrences')
                      .upsert(sanitizedPayload);
                    queryError = upsertErr;
                    success = !upsertErr;
                  }
                } else {
                  // Row exists but RLS/update failed for unknown reason
                  queryError = updateErr || { code: 'UPDATE_ZERO_ROWS', message: `0 rows updated for occurrence ${item.entity_id}` };
                  success = false;
                  console.warn(`[SYNC ENGINE] Occurrence ${item.entity_id} update returned 0 rows but row exists with status "${occCheck?.status}". Will retry.`);
                }
              }
            } else if (item.operation === 'UPDATE') {
              const sanitizedPayload = sanitizeOccurrenceForSupabase(item.payload);
              const targetOccId = sanitizedPayload.id || item.entity_id;
              if (targetOccId) sanitizedPayload.id = targetOccId;

              // 1. First attempt update() to modify status/completed_at without requiring scheduled_at
              const { data: updateData, error: updateErr } = await supabase
                .from('reminder_occurrences')
                .update(sanitizedPayload)
                .eq('id', targetOccId)
                .select();

              if (!updateErr && updateData && updateData.length > 0) {
                queryError = null;
                success = true;
                console.log(`[CMD LOG][SYNC ENGINE] Occurrence UPDATE success: ID="${targetOccId}" Status="${sanitizedPayload.status}"`);
              } else {
                // 2. Fallback to upsert: Ensure scheduled_at is populated to prevent 23502 NOT NULL violation
                if (!sanitizedPayload.scheduled_at && targetOccId) {
                  const localOccs = await getOccurrencesFromIDB();
                  const localOcc = localOccs.find(o => o.id === targetOccId);
                  if (localOcc && localOcc.scheduledAt) {
                    sanitizedPayload.scheduled_at = localOcc.scheduledAt;
                  } else {
                    sanitizedPayload.scheduled_at = new Date().toISOString();
                  }
                }

                console.log(`[CMD LOG][SYNC ENGINE] Upserting Occurrence (Fallback): ID="${targetOccId}" Status="${sanitizedPayload.status}"`);
                const { error: upsertErr } = await supabase
                  .from('reminder_occurrences')
                  .upsert(sanitizedPayload);
                queryError = upsertErr;
                success = !upsertErr;

                if (upsertErr) {
                  console.warn('[CMD LOG][SYNC ENGINE] Occurrence upsert FAILED:', upsertErr.message, upsertErr.code);
                } else {
                  console.log('[CMD LOG][SYNC ENGINE] Occurrence upsert SUCCESS');
                }
              }
            } else if (item.operation === 'CREATE') {
              const sanitizedPayload = sanitizeOccurrenceForSupabase(item.payload);
              if (!sanitizedPayload.id && item.entity_id) {
                sanitizedPayload.id = item.entity_id;
              }
              if (!sanitizedPayload.scheduled_at) {
                sanitizedPayload.scheduled_at = new Date().toISOString();
              }
              console.log(`[CMD LOG][SYNC ENGINE] Creating Occurrence: ID="${sanitizedPayload.id}" Status="${sanitizedPayload.status}"`);
              const { error } = await supabase
                .from('reminder_occurrences')
                .upsert(sanitizedPayload);
              queryError = error;
              success = !error;
              if (error) {
                console.warn('[CMD LOG][SYNC ENGINE] Occurrence CREATE FAILED:', error.message, error.code);
              } else {
                console.log('[CMD LOG][SYNC ENGINE] Occurrence CREATE SUCCESS');
              }
            }
          }

          if (success) {
            await removeFromOfflineQueue(rawItem.id);
            syncedCount++;
            console.log(`[SYNC ENGINE] Queue item ${rawItem.id} synced successfully.`);
          } else {
            const nextRetry = (item.retry_count || 0) + 1;
            const errCode = queryError?.code || 'NO_CODE';
            const errMessage = queryError?.message || 'Sync query rejected';
            const errDetails = queryError?.details || 'None';
            const errHint = queryError?.hint || 'None';

            console.warn(`[SYNC ENGINE] ===== SYNC FAILURE =====`);
            console.warn(`Queue ID: ${rawItem.id}`);
            console.warn(`Entity Type: ${item.entity_type || 'UNKNOWN'}`);
            console.warn(`Entity ID: ${item.entity_id || 'UNKNOWN'}`);
            console.warn(`Operation: ${item.operation || 'UNKNOWN'}`);
            console.warn(`Attempt: ${nextRetry}`);
            console.warn(`Supabase Error Code: ${errCode}`);
            console.warn(`Supabase Error Message: ${errMessage}`);
            console.warn(`Supabase Error Details: ${errDetails}`);
            console.warn(`Supabase Error Hint: ${errHint}`);
            console.warn(`Queue Payload:`, JSON.stringify(item.payload, null, 2));
            console.warn(`[SYNC ENGINE] ===== END SYNC FAILURE =====`);

            // Do NOT purge items on network error, timeout, or general retry count!
            // Only purge if duplicate (23505) or idempotent verified.
            const isTimeoutOrNetwork = errCode === 'PGRST000' || errCode === '504' || errMessage.includes('timeout') || errMessage.includes('fetch');
            if (!isTimeoutOrNetwork && errCode === '23505') {
              console.warn(`[SYNC ENGINE] Purging resolved/duplicate queue item ${rawItem.id} from IndexedDB.`);
              await removeFromOfflineQueue(rawItem.id);
            } else {
              await updateQueueItemInIDB({
                ...item,
                id: rawItem.id,
                retry_count: Math.min(nextRetry, 10),
                status: 'FAILED_RETRYABLE',
                error_message: `${errCode}: ${errMessage}`
              });
            }
          }
        } catch (err: any) {
          const nextRetry = (item.retry_count || 0) + 1;

          console.warn(`[SYNC ENGINE] ===== SYNC EXCEPTION FAILURE =====`);
          console.warn(`Queue ID: ${rawItem.id}`);
          console.warn(`Entity Type: ${item?.entity_type || 'UNKNOWN'}`);
          console.warn(`Entity ID: ${item?.entity_id || 'UNKNOWN'}`);
          console.warn(`Operation: ${item?.operation || 'UNKNOWN'}`);
          console.warn(`Attempt: ${nextRetry}`);
          console.warn(`Error Name: ${err?.name || 'Error'}`);
          console.warn(`Error Message: ${err?.message || String(err)}`);
          console.warn(`[SYNC ENGINE] ===== END SYNC EXCEPTION FAILURE =====`);

          errors.push(err.message || String(err));
          
          // Never purge local mutations on network or server timeouts
          await updateQueueItemInIDB({
            ...item,
            id: rawItem.id,
            retry_count: Math.min(nextRetry, 10),
            status: 'FAILED_RETRYABLE',
            error_message: err.message || String(err)
          });
        }
      }
      // Dependency Recovery Pass: retry deferred occurrences whose parent is now synced
      {
        const deferredQueue = await getOfflineQueue();
        const deferredSorted = deferredQueue
          .filter(raw => {
            const it = migrateLegacyQueueItem(raw);
            return it.entity_type === 'occurrence' && it.status !== 'FAILED_FATAL';
          })
          .map(raw => ({ rawItem: raw, item: migrateLegacyQueueItem(raw) }));

        for (const { rawItem, item } of deferredSorted) {
          const parentRemId = getOccurrenceParentReminderId(item);
          if (!parentRemId) continue;

          let parentExistsOnServer = syncedReminderIdsInBatch.has(parentRemId);
          if (!parentExistsOnServer) {
            const { data: parentRow } = await supabase
              .from('reminders').select('id').eq('id', parentRemId).maybeSingle();
            if (parentRow) {
              parentExistsOnServer = true;
              syncedReminderIdsInBatch.add(parentRemId);
            }
          }

          if (!parentExistsOnServer) {
            console.log(`[SYNC ENGINE] Dependency recovery started | Parent Reminder ID: ${parentRemId}`);
            const localParent = (await getRemindersFromIDB()).find(r => r.id === parentRemId);
            if (localParent) {
              console.log(`[SYNC ENGINE] Parent reminder found locally | Reminder ID: ${parentRemId}`);
              console.log(`[SYNC ENGINE] Parent queue ensured | Reminder ID: ${parentRemId}`);
              console.log(`[SYNC ENGINE] Parent reminder sync attempt | Reminder ID: ${parentRemId}`);
              const reminderPayload = sanitizeReminderForSupabase(localParent);
              if (user) reminderPayload.user_id = user.id;
              const { error: pErr } = await supabase.from('reminders').upsert(reminderPayload);
              if (!pErr) {
                parentExistsOnServer = true;
                syncedReminderIdsInBatch.add(parentRemId);
                console.log(`[SYNC ENGINE] Parent reminder verified in Supabase | Reminder ID: ${parentRemId}`);
              } else {
                console.warn(`[SYNC ENGINE] Parent reminder sync attempt failed: ${pErr.message}`);
                continue;
              }
            } else {
              console.warn(`[SYNC ENGINE] Parent reminder not found in local IndexedDB | Reminder ID: ${parentRemId}`);
              continue;
            }
          }

          try {
            const sanitizedPayload = sanitizeOccurrenceForSupabase(item.payload);
            if (!sanitizedPayload.id && item.entity_id) sanitizedPayload.id = item.entity_id;
            if (!sanitizedPayload.scheduled_at) sanitizedPayload.scheduled_at = new Date().toISOString();
            if (!sanitizedPayload.reminder_id) sanitizedPayload.reminder_id = parentRemId;

            console.log(`[SYNC ENGINE] Retrying dependent occurrence | Occurrence ID: ${item.entity_id}`);
            const { error: occErr } = await supabase.from('reminder_occurrences').upsert(sanitizedPayload);
            if (!occErr) {
              await removeFromOfflineQueue(rawItem.id);
              syncedCount++;
              console.log(`[SYNC ENGINE] Dependent occurrence synced successfully | Occurrence ID: ${item.entity_id}`);
            } else {
              console.warn(`[SYNC ENGINE] Deferred occurrence still failed: ${occErr.message}`);
            }
          } catch (e: any) {
            console.warn(`[SYNC ENGINE] Deferred occurrence exception: ${e.message}`);
          }
        }
      }

      // 2. Fetch Remote Data from Supabase & Execute Clock-Skew Protected LWW Merge
      if (user) {
        const nowMs = Date.now();

        // A. Agendas Reconciliation
        let remoteAgendas: any[] | null = null;
        try {
          const { data, error: agendaFetchError } = await supabase
            .from('agendas')
            .select('*')
            .order('scheduled_at', { ascending: true });

          if (agendaFetchError) {
            console.warn('[SYNC ENGINE] Fetch remote agendas error:', agendaFetchError);
          } else {
            remoteAgendas = data;
          }
        } catch (agErr: any) {
          console.warn('[SYNC ENGINE] Fetch remote agendas network notice:', agErr?.message || agErr);
        }

        if (remoteAgendas && Array.isArray(remoteAgendas)) {
          const localAgendas = await getAgendasFromIDB();
          const currentQueue = await getOfflineQueue();
          const pendingMutationAgendaIds = new Set(
            currentQueue
              .filter(i => i.entity_type === 'agenda')
              .map(i => i.entity_id)
          );
          const pendingCreateAgendaIds = new Set(
            currentQueue
              .filter(i => i.entity_type === 'agenda' && i.operation === 'CREATE')
              .map(i => i.entity_id)
          );
          const pendingDeleteAgendaIds = new Set(
            currentQueue
              .filter(i => i.entity_type === 'agenda' && i.operation === 'DELETE')
              .map(i => i.entity_id)
          );
          const remoteAgendaIds = new Set(remoteAgendas.map((r: any) => r.id));

          const agendaMap = new Map<string, IDBAgenda>();

          // Clean up local agendas ONLY if confirmed deleted on remote AND belongs to user
          for (const local of localAgendas) {
            const hasPendingMutation = pendingMutationAgendaIds.has(local.id);
            const existsOnRemote = remoteAgendaIds.has(local.id);
            const isOwnedByCurrentUser = !local.user_id || local.user_id === user.id;

            if (existsOnRemote || hasPendingMutation || !isOwnedByCurrentUser) {
              agendaMap.set(local.id, local);
            } else {
              console.log(`[SYNC ENGINE] Remote deletion detected: removing local agenda ${local.id} ("${local.title}")`);
              await deleteAgendaFromIDB(local.id);
            }
          }

          remoteAgendas.forEach((r: any) => {
            const local = agendaMap.get(r.id);
            const remoteTime = new Date(r.updated_at).getTime();
            const localTime = local?.updated_at ? new Date(local.updated_at).getTime() : 0;
            const isLocalFutureSkewed = localTime > nowMs + 60000;

            if (!local || isLocalFutureSkewed || remoteTime >= localTime) {
              agendaMap.set(r.id, {
                id: r.id,
                user_id: r.user_id,
                title: r.title,
                location: r.location || '',
                notes: r.notes || '',
                scheduled_at: r.scheduled_at,
                time_mode: r.time_mode || undefined,
                privateNotes: r.privateNotes || '',
                is_completed: r.is_completed || false,
                include_notes_in_share: r.include_notes_in_share || false,
                status: r.status || 'confirmed',
                isShareable: r.isShareable !== undefined ? r.isShareable : true,
                groupId: r.groupId || undefined,
                isOnline: r.isOnline || false,
                onlineLink: r.onlineLink || '',
                meetingId: r.meetingId || '',
                meetingPasscode: r.meetingPasscode || '',
                isUrgent: r.isUrgent || false,
                created_at: r.created_at,
                updated_at: r.updated_at
              });
            }
          });

          await saveAgendasToIDB(Array.from(agendaMap.values()));

          // Bi-directional recovery: only push offline-created local agendas that have pending CREATE
          for (const local of localAgendas) {
            const belongsToUser = !local.user_id || local.user_id === user.id || local.user_id === 'offline_user';
            if (belongsToUser && !remoteAgendaIds.has(local.id) && pendingCreateAgendaIds.has(local.id) && !pendingDeleteAgendaIds.has(local.id)) {
              console.log(`[SYNC ENGINE] Bi-directional recovery: Pushing unsynced local agenda ${local.id} ("${local.title}") to Supabase...`);
              const payload = sanitizeAgendaForSupabase(local);
              payload.id = local.id;
              payload.user_id = user.id;

              let { error: pushErr } = await supabase.from('agendas').upsert(payload);
              if (pushErr && pushErr.code === 'PGRST204' && (payload as any).time_mode !== undefined) {
                delete (payload as any).time_mode;
                const retryPush = await supabase.from('agendas').upsert(payload);
                pushErr = retryPush.error;
              }

              if (pushErr) {
                console.warn(`[SYNC ENGINE] Bi-directional recovery push failed for ${local.id}:`, pushErr);
              } else {
                console.log(`[SYNC ENGINE] Successfully pushed unsynced local agenda ${local.id} to Supabase!`);
                syncedCount++;
              }
            }
          }
        }

        // B. Reminders & Occurrences Reconciliation
        let remoteReminders: any[] | null = null;
        try {
          const { data, error: reminderFetchError } = await supabase
            .from('reminders')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

          if (reminderFetchError) {
            const sErr = serializeSupabaseError(reminderFetchError);
            console.warn('[SYNC REMINDERS ERROR]', sErr);
          } else {
            remoteReminders = data;
          }
        } catch (remErr: any) {
          console.warn('[SYNC ENGINE] Fetch remote reminders network notice:', remErr?.message || remErr);
        }

        console.log('[SYNC OCCURRENCES AUTH]', {
          hasUser: !!user,
          userId: user?.id,
        });

        let remoteOccurrences: any[] = [];
        let occFetchError: any = null;

        if (remoteReminders && Array.isArray(remoteReminders) && remoteReminders.length > 0) {
          try {
            const reminderIds = remoteReminders.map((r: any) => r.id);
            const res = await supabase
              .from('reminder_occurrences')
              .select('*')
              .in('reminder_id', reminderIds)
              .order('scheduled_at', { ascending: true });

            remoteOccurrences = res.data || [];
            occFetchError = res.error;
          } catch (occErr: any) {
            console.warn('[SYNC ENGINE] Fetch remote occurrences network notice:', occErr?.message || occErr);
          }
        }

        if (occFetchError) {
          const sErr = serializeSupabaseError(occFetchError);
          console.warn('[SYNC OCCURRENCES ERROR]', {
            message: occFetchError?.message,
            code: occFetchError?.code,
            details: occFetchError?.details,
            hint: occFetchError?.hint,
            raw: String(occFetchError),
            json: JSON.stringify(sErr),
          });
        }

        if (remoteReminders && Array.isArray(remoteReminders)) {
          // Re-query current queue state to ensure accurately reflected pending DELETE items
          const currentQueue = await getOfflineQueue();

          // Collect IDs of reminders that are pending/retryable DELETE locally.
          // These must be skipped during reconciliation or they get re-inserted from server.
          const pendingDeleteReminderIds = new Set(
            currentQueue
              .filter(i =>
                i.entity_type === 'reminder' &&
                i.operation === 'DELETE' &&
                i.status !== 'FAILED_FATAL'
              )
              .map(i => i.entity_id)
          );

          const pendingMutationReminderIds = new Set(
            currentQueue
              .filter(i => i.entity_type === 'reminder')
              .map(i => i.entity_id)
          );

          const remoteReminderIds = new Set(remoteReminders.map((r: any) => r.id));
          const localReminders = await getRemindersFromIDB();
          const reminderMap = new Map<string, IDBReminder>();
          localReminders.forEach(r => reminderMap.set(r.id, r));

          // Purge local reminders deleted on remote (Web)
          for (const local of localReminders) {
            if (local.user_id === user.id && !remoteReminderIds.has(local.id) && !pendingMutationReminderIds.has(local.id)) {
              console.log(`[SYNC] Purging local reminder ${local.id} — deleted on remote server`);
              reminderMap.delete(local.id);
              await deleteReminderFromIDB(local.id);
            }
          }

          remoteReminders.forEach((r: any) => {
            // Skip reminders that are locally queued for deletion
            if (pendingDeleteReminderIds.has(r.id)) {
              console.log(`[SYNC] Skipping re-insert of reminder ${r.id} — pending local DELETE`);
              return;
            }

            const local = reminderMap.get(r.id);
            const remoteTime = new Date(r.updated_at).getTime();
            const localTime = local?.updatedAt ? new Date(local.updatedAt).getTime() : 0;
            const isLocalFutureSkewed = localTime > nowMs + 60000;

            if (!local || isLocalFutureSkewed || remoteTime >= localTime) {
              reminderMap.set(r.id, {
                id: r.id,
                user_id: r.user_id,
                title: r.title,
                body: r.body,
                time: r.time || '08:00',
                timezone: r.timezone || 'Asia/Jakarta',
                frequency: r.frequency || 'once',
                daysOfWeek: r.days_of_week,
                sound: r.sound || 'default',
                isActive: r.is_active !== undefined ? r.is_active : true,
                deliveryMode: r.delivery_mode || 'hybrid',
                createdAt: r.created_at,
                updatedAt: r.updated_at
              });
            }
          });

          await saveRemindersToIDB(Array.from(reminderMap.values()));
        }

        if (remoteOccurrences && Array.isArray(remoteOccurrences)) {
          const localOccurrences = await getOccurrencesFromIDB();
          const activeReminderIds = new Set((await getRemindersFromIDB()).map(r => r.id));

          const occurrenceMap = new Map<string, IDBOccurrence>();
          localOccurrences.forEach(o => {
            // Only retain occurrences for active reminders
            if (activeReminderIds.has(o.reminderId)) {
              occurrenceMap.set(o.id, o);
            }
          });

          remoteOccurrences.forEach((o: any) => {
            if (!activeReminderIds.has(o.reminder_id)) return;

            const local = occurrenceMap.get(o.id);
            const remoteTime = new Date(o.updated_at).getTime();
            const localTime = local?.updatedAt ? new Date(local.updatedAt).getTime() : 0;
            const isLocalFutureSkewed = localTime > nowMs + 60000;

            if (!local || isLocalFutureSkewed || remoteTime >= localTime) {
              occurrenceMap.set(o.id, {
                id: o.id,
                reminderId: o.reminder_id,
                user_id: o.user_id,
                scheduledAt: o.scheduled_at,
                status: o.status,
                snoozedUntil: o.snoozed_until,
                sentAt: o.sent_at,
                completedAt: o.completed_at,
                dismissedAt: o.dismissed_at,
                notificationTag: o.notification_tag || `reminder-${o.reminder_id}-occurrence-${o.id}`,
                createdAt: o.created_at,
                updatedAt: o.updated_at
              });
            }
          });

          await saveOccurrencesToIDB(Array.from(occurrenceMap.values()));
        }
      }

      // 3. Reconcile Android Native Alarms
      if (isNativePlatform()) {
        await this.reconcileNativeAlarms();
      }

    } catch (err: any) {
      console.warn('[SYNC ENGINE] Global sync notice:', err);
      errors.push(err.message);
    }

    return {
      success: errors.length === 0,
      syncedCount,
      errors
    };
  }

  private async reconcileNativeAlarms(): Promise<void> {
    try {
      const localOccurrences = await getOccurrencesFromIDB();
      const localReminders = await getRemindersFromIDB();
      const scheduledNativeAlarms = await getScheduledNativeAlarms();

      const nativeAlarmMap = new Map<string, any>();
      scheduledNativeAlarms.forEach((item: any) => {
        if (item && item.occurrenceId) {
          nativeAlarmMap.set(item.occurrenceId, item);
        }
      });

      const nowMs = Date.now();

      for (const occ of localOccurrences) {
        const targetTimeStr = occ.snoozedUntil || occ.scheduledAt;
        const targetTimeMs = new Date(targetTimeStr).getTime();

        const isFinished = occ.status === 'completed' || occ.status === 'dismissed' || occ.status === 'cancelled';
        const shouldSchedule = (occ.status === 'scheduled' || occ.status === 'snoozed' || occ.status === 'sent' || occ.status === 'processing') && targetTimeMs > nowMs - 60000;

        console.log(`[NATIVE SYNC] Reminder ID: ${occ.reminderId} | Occurrence ID: ${occ.id} | ScheduledAt: ${targetTimeStr} | IsActive: ${!isFinished} | CurrentTime: ${new Date(nowMs).toISOString()} | ShouldSchedule: ${shouldSchedule}`);

        if (isFinished) {
          if (nativeAlarmMap.has(occ.id)) {
            await cancelNativeLocalAlarm(occ.id);
          }
        } else if (shouldSchedule) {
          const nativeItem = nativeAlarmMap.get(occ.id);
          const parentReminder = localReminders.find(r => r.id === occ.reminderId);

          if (!nativeItem || !nativeItem.scheduledAtMs || Math.abs(nativeItem.scheduledAtMs - targetTimeMs) > 2000) {
            const schedRes = await scheduleNativeLocalAlarm({
              reminderId: occ.reminderId,
              occurrenceId: occ.id,
              title: parentReminder?.title || 'Pengingat AgendaRecap',
              body: parentReminder?.body || '',
              sound: parentReminder?.sound || 'default',
              scheduledAt: targetTimeStr
            });
            console.log(`[NATIVE SYNC] NativeAlarmScheduleResult: ${schedRes ? 'SUCCESS' : 'FAILED'} for occurrence ${occ.id}`);
          }
        }
      }
    } catch (err) {
      console.warn('[SYNC ENGINE] Native alarm reconciliation notice:', err);
    }
  }
}

export const syncRepository = new SyncRepository();
