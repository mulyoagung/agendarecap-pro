// IndexedDB Helper v3 for Agendaku PWA, Native Capacitor & Service Worker
// Stores: 'agendas', 'reminders', 'occurrences', 'offline_queue', 'app_state'

const DB_NAME = 'agendaku_pwa_db';
const DB_VERSION = 3;

export interface IDBAgenda {
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
}

export interface IDBReminder {
  id: string;
  user_id?: string;
  title: string;
  body?: string;
  time: string; // HH:mm format
  timezone: string;
  frequency: 'once' | 'daily' | 'weekdays' | 'weekly';
  daysOfWeek?: number[];
  sound?: string;
  isActive: boolean;
  deliveryMode?: 'hybrid' | 'server' | 'local';
  createdAt: string;
  updatedAt?: string;
}

export interface IDBOccurrence {
  id: string;
  reminderId: string;
  user_id?: string;
  scheduledAt: string; // ISO string UTC
  status: 'scheduled' | 'processing' | 'sent' | 'snoozed' | 'completed' | 'dismissed' | 'cancelled' | 'failed';
  snoozedUntil?: string;
  sentAt?: string;
  completedAt?: string;
  dismissedAt?: string;
  notificationTag: string; // reminder-{reminderId}-occurrence-{occurrenceId}
  createdAt: string;
  updatedAt?: string;
}

export interface IDBOfflineQueueItem {
  id: string;
  entity_type: 'agenda' | 'reminder' | 'occurrence';
  entity_id: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE' | 'SNOOZE' | 'COMPLETE' | 'DISMISS';
  payload: any;
  created_at: number;
  retry_count: number;
  status: 'PENDING' | 'SYNCING' | 'FAILED_RETRYABLE' | 'FAILED_FATAL';
  error_message?: string;
  // Legacy compatibility fields
  type?: string;
  createdAt?: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result as IDBDatabase;

      if (!db.objectStoreNames.contains('agendas')) {
        const agendaStore = db.createObjectStore('agendas', { keyPath: 'id' });
        agendaStore.createIndex('scheduled_at', 'scheduled_at', { unique: false });
        agendaStore.createIndex('user_id', 'user_id', { unique: false });
      }

      if (!db.objectStoreNames.contains('reminders')) {
        db.createObjectStore('reminders', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('occurrences')) {
        const occStore = db.createObjectStore('occurrences', { keyPath: 'id' });
        occStore.createIndex('reminderId', 'reminderId', { unique: false });
        occStore.createIndex('status', 'status', { unique: false });
        occStore.createIndex('scheduledAt', 'scheduledAt', { unique: false });
      } else {
        const occStore = event.target.transaction.objectStore('occurrences');
        if (!occStore.indexNames.contains('reminderId')) {
          occStore.createIndex('reminderId', 'reminderId', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains('offline_queue')) {
        db.createObjectStore('offline_queue', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('app_state')) {
        db.createObjectStore('app_state', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function deduplicateById<T extends { id: string }>(items: T[]): T[] {
  if (!Array.isArray(items)) return [];
  const map = new Map<string, T>();
  for (const item of items) {
    if (item && item.id) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

// ==========================================
// AGENDAS OPERATIONAL API
// ==========================================

export async function saveAgendasToIDB(agendas: IDBAgenda[]): Promise<void> {
  if (!agendas || agendas.length === 0) return;
  const uniqueAgendas = deduplicateById(agendas);
  try {
    const db = await openDB();
    const tx = db.transaction('agendas', 'readwrite');
    const store = tx.objectStore('agendas');
    for (const item of uniqueAgendas) {
      store.put(item);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] saveAgendasToIDB error:', e);
  }
}

export async function getAgendasFromIDB(): Promise<IDBAgenda[]> {
  try {
    const db = await openDB();
    const tx = db.transaction('agendas', 'readonly');
    const store = tx.objectStore('agendas');
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(deduplicateById(request.result || []));
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IDB] getAgendasFromIDB error:', e);
    return [];
  }
}

export async function updateSingleAgendaInIDB(agenda: IDBAgenda): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('agendas', 'readwrite');
    const store = tx.objectStore('agendas');
    store.put(agenda);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] updateSingleAgendaInIDB error:', e);
  }
}

export async function deleteAgendaFromIDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('agendas', 'readwrite');
    const store = tx.objectStore('agendas');
    store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] deleteAgendaFromIDB error:', e);
  }
}

// ==========================================
// REMINDERS OPERATIONAL API
// ==========================================

export async function saveRemindersToIDB(reminders: IDBReminder[]): Promise<void> {
  if (!reminders || reminders.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction('reminders', 'readwrite');
    const store = tx.objectStore('reminders');
    for (const item of reminders) {
      store.put(item);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] saveRemindersToIDB error:', e);
  }
}

export async function getRemindersFromIDB(): Promise<IDBReminder[]> {
  try {
    const db = await openDB();
    const tx = db.transaction('reminders', 'readonly');
    const store = tx.objectStore('reminders');
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IDB] getRemindersFromIDB error:', e);
    return [];
  }
}

export async function updateSingleReminderInIDB(reminder: IDBReminder): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('reminders', 'readwrite');
    const store = tx.objectStore('reminders');
    store.put(reminder);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] updateSingleReminderInIDB error:', e);
  }
}

export async function deleteReminderFromIDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(['reminders', 'occurrences'], 'readwrite');
    const storeReminders = tx.objectStore('reminders');
    const storeOccurrences = tx.objectStore('occurrences');

    storeReminders.delete(id);

    // Delete associated occurrences
    const request = storeOccurrences.getAll();
    request.onsuccess = () => {
      const occs = request.result as IDBOccurrence[];
      for (const occ of occs) {
        if (occ.reminderId === id) {
          storeOccurrences.delete(occ.id);
        }
      }
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] deleteReminderFromIDB error:', e);
  }
}

// ==========================================
// OCCURRENCES OPERATIONAL API
// ==========================================

export async function saveOccurrencesToIDB(occurrences: IDBOccurrence[]): Promise<void> {
  if (!occurrences || occurrences.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction('occurrences', 'readwrite');
    const store = tx.objectStore('occurrences');
    for (const item of occurrences) {
      store.put(item);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] saveOccurrencesToIDB error:', e);
  }
}

export async function getOccurrencesFromIDB(): Promise<IDBOccurrence[]> {
  try {
    const db = await openDB();
    const tx = db.transaction('occurrences', 'readonly');
    const store = tx.objectStore('occurrences');
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IDB] getOccurrencesFromIDB error:', e);
    return [];
  }
}

export async function updateOccurrenceInIDB(occ: IDBOccurrence): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('occurrences', 'readwrite');
    const store = tx.objectStore('occurrences');
    store.put(occ);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] updateOccurrenceInIDB error:', e);
  }
}

// ==========================================
// OFFLINE QUEUE OPERATIONAL API
// ==========================================

export async function addToOfflineQueue(item: Omit<IDBOfflineQueueItem, 'id' | 'created_at'> & { id?: string }): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');

    const id = item.id || crypto.randomUUID();
    const now = Date.now();

    const request = store.getAll();
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const existingItems = (request.result || []) as IDBOfflineQueueItem[];

        if (item.operation === 'DELETE') {
          // Check if there is an UNSYNCED pending CREATE for this entity
          const pendingUnsyncedCreate = existingItems.find(
            i => i.entity_type === item.entity_type &&
                 i.entity_id === item.entity_id &&
                 i.operation === 'CREATE' &&
                 (i.status === 'PENDING' || i.status === 'FAILED_RETRYABLE' || i.status === 'FAILED_FATAL')
          );

          if (pendingUnsyncedCreate) {
            // Item was created offline and deleted offline BEFORE ever reaching server!
            // Safe to cancel out: remove ALL queue items for this entity_id (no remote mutation needed)
            console.log(`[IDB QUEUE] Unsynced local entity ${item.entity_id} deleted offline — cancelling pending CREATE queue items.`);
            for (const i of existingItems) {
              if (i.entity_type === item.entity_type && i.entity_id === item.entity_id) {
                store.delete(i.id);
              }
            }
            return resolve();
          }

          // If entity was already synced to server (or no unsynced CREATE exists),
          // we MUST enqueue the DELETE operation to mutate Supabase!
          // Remove any pending UPDATE items for this entity_id to prevent redundant mutations.
          for (const i of existingItems) {
            if (i.entity_type === item.entity_type && i.entity_id === item.entity_id && i.operation === 'UPDATE') {
              store.delete(i.id);
            }
          }
        } else if (item.operation === 'UPDATE') {
          // Check if there is a pending CREATE for this entity
          const pendingCreate = existingItems.find(
            i => i.entity_type === item.entity_type && i.entity_id === item.entity_id && i.operation === 'CREATE'
          );

          if (pendingCreate) {
            // Merge the updates into the pending CREATE payload
            pendingCreate.payload = {
              ...pendingCreate.payload,
              ...item.payload
            };
            store.put(pendingCreate);
            return resolve();
          }
        }

        const fullItem: IDBOfflineQueueItem = {
          ...item,
          id,
          created_at: now,
          retry_count: item.retry_count || 0,
          status: item.status || 'PENDING',
          type: item.type,
          createdAt: item.createdAt || now
        };

        store.put(fullItem);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] addToOfflineQueue error:', e);
  }
}

export async function getOfflineQueue(): Promise<IDBOfflineQueueItem[]> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_queue', 'readonly');
    const store = tx.objectStore('offline_queue');
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('[IDB] getOfflineQueue error:', e);
    return [];
  }
}

export async function updateQueueItemInIDB(item: IDBOfflineQueueItem): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');
    store.put(item);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] updateQueueItemInIDB error:', e);
  }
}

export async function removeFromOfflineQueue(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');
    store.delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] removeFromOfflineQueue error:', e);
  }
}

export async function clearOfflineQueue(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('offline_queue', 'readwrite');
    const store = tx.objectStore('offline_queue');
    store.clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('[IDB] clearOfflineQueue error:', e);
  }
}

// ==========================================
// ORPHAN DATA & QUEUE REPAIR API
// ==========================================

export async function repairOrphanDataAndQueueInIDB(userId: string): Promise<{
  repairedAgendas: number;
  repairedReminders: number;
  repairedOccurrences: number;
  repairedQueue: number;
}> {
  let repairedAgendas = 0;
  let repairedReminders = 0;
  let repairedOccurrences = 0;
  let repairedQueue = 0;

  try {
    const db = await openDB();
    const tx = db.transaction(['agendas', 'reminders', 'occurrences', 'offline_queue'], 'readwrite');

    // 1. Repair Agendas
    const agendaStore = tx.objectStore('agendas');
    const agendasReq = agendaStore.getAll();
    await new Promise<void>((res) => {
      agendasReq.onsuccess = () => {
        const items = (agendasReq.result || []) as IDBAgenda[];
        for (const item of items) {
          if (!item.user_id || item.user_id === 'undefined') {
            item.user_id = userId;
            agendaStore.put(item);
            repairedAgendas++;
          }
        }
        res();
      };
    });

    // 2. Repair Reminders
    const reminderStore = tx.objectStore('reminders');
    const remindersReq = reminderStore.getAll();
    await new Promise<void>((res) => {
      remindersReq.onsuccess = () => {
        const items = (remindersReq.result || []) as IDBReminder[];
        for (const item of items) {
          if (!item.user_id || item.user_id === 'undefined') {
            item.user_id = userId;
            reminderStore.put(item);
            repairedReminders++;
          }
        }
        res();
      };
    });

    // 3. Repair Occurrences
    const occStore = tx.objectStore('occurrences');
    const occReq = occStore.getAll();
    await new Promise<void>((res) => {
      occReq.onsuccess = () => {
        const items = (occReq.result || []) as IDBOccurrence[];
        for (const item of items) {
          if (!item.user_id || item.user_id === 'undefined') {
            item.user_id = userId;
            occStore.put(item);
            repairedOccurrences++;
          }
        }
        res();
      };
    });

    // 4. Repair Offline Queue items & reset FAILED_RETRYABLE status
    const queueStore = tx.objectStore('offline_queue');
    const queueReq = queueStore.getAll();
    await new Promise<void>((res) => {
      queueReq.onsuccess = () => {
        const items = (queueReq.result || []) as IDBOfflineQueueItem[];
        for (const item of items) {
          let updated = false;

          if (item.payload) {
            if (!item.payload.user_id || item.payload.user_id === 'undefined') {
              item.payload.user_id = userId;
              updated = true;
            }
            if (item.payload.reminder && (!item.payload.reminder.user_id || item.payload.reminder.user_id === 'undefined')) {
              item.payload.reminder.user_id = userId;
              updated = true;
            }
            if (item.payload.occurrence) {
              if ('user_id' in item.payload.occurrence) {
                delete item.payload.occurrence.user_id;
                updated = true;
              }
            }
            if (item.entity_type === 'occurrence' && item.payload && 'user_id' in item.payload) {
              delete item.payload.user_id;
              updated = true;
            }
          }

          if (item.status === 'FAILED_RETRYABLE' || item.status === 'FAILED_FATAL') {
            item.status = 'PENDING';
            item.retry_count = 0;
            item.error_message = undefined;
            updated = true;
          }

          if (updated) {
            queueStore.put(item);
            repairedQueue++;
          }
        }
        res();
      };
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    if (repairedAgendas > 0 || repairedReminders > 0 || repairedQueue > 0) {
      console.log(`[IDB REPAIR] Successfully repaired orphan data: agendas=${repairedAgendas}, reminders=${repairedReminders}, queue=${repairedQueue}`);
    }
  } catch (e) {
    console.error('[IDB] repairOrphanDataAndQueueInIDB error:', e);
  }

  return { repairedAgendas, repairedReminders, repairedOccurrences, repairedQueue };
}

export async function getOfflineQueueDebugInfo(): Promise<{
  total: number;
  agendas: number;
  reminders: number;
  occurrences: number;
  pending: number;
  syncing: number;
  failedRetryable: number;
  failedFatal: number;
}> {
  const queue = await getOfflineQueue();
  return {
    total: queue.length,
    agendas: queue.filter((i) => i.entity_type === 'agenda').length,
    reminders: queue.filter((i) => i.entity_type === 'reminder').length,
    occurrences: queue.filter((i) => i.entity_type === 'occurrence').length,
    pending: queue.filter((i) => i.status === 'PENDING').length,
    syncing: queue.filter((i) => i.status === 'SYNCING').length,
    failedRetryable: queue.filter((i) => i.status === 'FAILED_RETRYABLE').length,
    failedFatal: queue.filter((i) => i.status === 'FAILED_FATAL').length,
  };
}
