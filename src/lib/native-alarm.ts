// Native Android Alarm Bridge Engine
// Bridges Next.js TypeScript client with Java NativeAlarmPlugin on Android, with Web Fallbacks

import { Capacitor, registerPlugin } from '@capacitor/core';
import { reminderRepository } from '@/lib/repositories/reminder-repository';
import { syncRepository } from '@/lib/repositories/sync-repository';

export interface NativePendingAction {
  actionId: string;
  type: 'COMPLETE' | 'SNOOZE' | 'DISMISS';
  reminderId: string;
  occurrenceId: string;
  minutes?: number;
  snoozedUntilMs?: number;
  timestamp: number;
}

export interface NativeAlarmPluginInterface {
  schedule(options: {
    reminderId: string;
    occurrenceId: string;
    title: string;
    note?: string;
    sound?: string;
    scheduledAtMs: number;
  }): Promise<{ success: boolean; occurrenceId?: string; scheduledAtMs?: number }>;

  cancel(options: { occurrenceId: string }): Promise<{ success: boolean }>;

  snooze(options: {
    reminderId: string;
    occurrenceId: string;
    minutes: number;
    title?: string;
    note?: string;
    sound?: string;
  }): Promise<{ success: boolean; snoozedMinutes?: number; snoozedUntilMs?: number }>;

  cancelAll(): Promise<{ success: boolean }>;

  getScheduled(): Promise<{ alarms: any[] }>;

  getPendingNativeActions(): Promise<{ actions: NativePendingAction[] }>;

  acknowledgeNativeAction(options: { actionId: string }): Promise<{ success: boolean }>;

  checkPermissions(): Promise<{ notifications: string; exactAlarm: boolean }>;

  requestExactAlarmPermission(): Promise<{ opened: boolean; alreadyGranted?: boolean }>;

  playAudioPreview(options: { sound: string }): Promise<{ playing: boolean; sound: string }>;

  stopAudioPreview(): Promise<{ playing: boolean }>;
}

const NativeAlarm = registerPlugin<NativeAlarmPluginInterface>('NativeAlarm');

export interface ScheduleNativeAlarmInput {
  reminderId: string;
  occurrenceId: string;
  title: string;
  body?: string;
  sound?: string;
  scheduledAt: string; // ISO string UTC
}

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  return Capacitor.isNativePlatform() || (window as any).isAndroidNativeBridge === true || (window as any).Capacitor?.isNativePlatform?.() === true;
}

/**
 * Safely navigates to a target static HTML file or route in Native/Capacitor environment.
 * Prevents root origin leading-slash bugs on file:// or custom WebView schemes.
 */
export function navigateNative(targetFile: string, replace = false): void {
  if (typeof window === 'undefined') return;

  const cleanFile = targetFile.startsWith('/') ? targetFile.substring(1) : targetFile;
  let targetUrl = '/' + cleanFile;

  if (isNativePlatform()) {
    const href = window.location.href;
    const protocol = window.location.protocol;

    if (protocol === 'file:') {
      const publicIndex = href.indexOf('/public/');
      if (publicIndex !== -1) {
        const publicBase = href.substring(0, publicIndex + 8);
        targetUrl = publicBase + cleanFile;
      } else {
        const lastSlash = href.lastIndexOf('/');
        targetUrl = href.substring(0, lastSlash + 1) + cleanFile;
      }
    } else {
      targetUrl = window.location.origin + '/' + cleanFile;
    }
  }

  console.log(`[NATIVE NAV] Request: "${targetFile}" -> Resolved: "${targetUrl}" (replace=${replace})`);

  if (replace) {
    window.location.replace(targetUrl);
  } else {
    window.location.href = targetUrl;
  }
}


/**
 * Imports pending native user actions (e.g. COMPLETE / SNOOZE pressed from Android notifications while app was closed)
 * into local IndexedDB repository and triggers offline queue sync.
 */
export async function syncNativeActionsToIndexedDB(): Promise<number> {
  if (!isNativePlatform()) return 0;

  try {
    const { actions } = await NativeAlarm.getPendingNativeActions();
    if (!actions || actions.length === 0) return 0;

    console.log(`[NATIVE ALARM SYNC] Found ${actions.length} pending native notification user actions.`);
    let processed = 0;

    for (const action of actions) {
      try {
        if (action.type === 'COMPLETE') {
          await reminderRepository.completeOccurrence(action.reminderId, action.occurrenceId);
        } else if (action.type === 'SNOOZE') {
          await reminderRepository.snoozeOccurrence(action.reminderId, action.occurrenceId, action.minutes || 5);
        }

        // Acknowledge after safe import into IndexedDB & offline queue
        await NativeAlarm.acknowledgeNativeAction({ actionId: action.actionId });
        processed++;
        console.log(`[NATIVE ALARM SYNC] Processed & acknowledged native action: ${action.actionId}`);
      } catch (actionErr) {
        console.error(`[NATIVE ALARM SYNC] Failed to import action ${action.actionId}:`, actionErr);
      }
    }

    if (processed > 0 && typeof navigator !== 'undefined' && navigator.onLine) {
      syncRepository.runSync().catch(err => console.warn('[NATIVE ALARM SYNC] Sync notice:', err));
    }

    return processed;
  } catch (err) {
    console.warn('[NATIVE ALARM SYNC] syncNativeActionsToIndexedDB notice:', err);
    return 0;
  }
}

export function initNativeAlarmListeners(): void {
  if (isNativePlatform()) {
    console.log('[NATIVE ALARM] Native Android Alarm Engine initialized.');
    syncNativeActionsToIndexedDB();

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => {
        syncNativeActionsToIndexedDB();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          syncNativeActionsToIndexedDB();
        }
      });
    }
  }
}

export async function checkNativeAlarmPermissions(): Promise<{ notifications: string; exactAlarm: boolean }> {
  if (!isNativePlatform()) {
    const perm = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied';
    return { notifications: perm, exactAlarm: true };
  }

  try {
    const status = await NativeAlarm.checkPermissions();
    return status;
  } catch (err) {
    console.warn('[NATIVE ALARM] checkPermissions notice:', err);
    return { notifications: 'denied', exactAlarm: false };
  }
}

export async function requestExactAlarmPermission(): Promise<boolean> {
  if (!isNativePlatform()) return true;

  try {
    const res = await NativeAlarm.requestExactAlarmPermission();
    return res.opened || res.alreadyGranted === true;
  } catch (err) {
    console.warn('[NATIVE ALARM] requestExactAlarmPermission notice:', err);
    return false;
  }
}

export async function scheduleNativeLocalAlarm(input: ScheduleNativeAlarmInput): Promise<boolean> {
  const targetDate = new Date(input.scheduledAt);
  const scheduledAtMs = targetDate.getTime();
  const nowMs = Date.now();

  if (scheduledAtMs <= nowMs) {
    console.warn('[NATIVE ALARM] Scheduled time is in the past, skipping native alarm schedule.');
    return false;
  }

  if (isNativePlatform()) {
    try {
      const res = await NativeAlarm.schedule({
        reminderId: input.reminderId,
        occurrenceId: input.occurrenceId,
        title: input.title,
        note: input.body || '',
        sound: input.sound || 'default',
        scheduledAtMs
      });
      console.log(`[NATIVE ALARM] Scheduled native OS exact alarm occurrenceId=${input.occurrenceId} target=${input.scheduledAt} sound=${input.sound || 'default'}`);
      return res.success;
    } catch (err: any) {
      console.error('[NATIVE ALARM] Native schedule error:', err);
      return false;
    }
  }

  return true;
}

export async function cancelNativeLocalAlarm(occurrenceId: string): Promise<boolean> {
  if (!isNativePlatform()) return true;

  try {
    const res = await NativeAlarm.cancel({ occurrenceId });
    console.log(`[NATIVE ALARM] Cancelled native OS alarm occurrenceId=${occurrenceId}`);
    return res.success;
  } catch (err) {
    console.warn('[NATIVE ALARM] Cancel native alarm notice:', err);
    return false;
  }
}

export async function snoozeNativeLocalAlarm(
  reminderId: string,
  occurrenceId: string,
  minutes: number,
  title?: string,
  note?: string,
  sound?: string
): Promise<boolean> {
  if (!isNativePlatform()) return true;

  try {
    const res = await NativeAlarm.snooze({
      reminderId,
      occurrenceId,
      minutes,
      title: title || 'Pengingat AgendaRecap Pro',
      note: note || '',
      sound: sound || 'default'
    });
    console.log(`[NATIVE ALARM] Snoozed native OS alarm occurrenceId=${occurrenceId} +${minutes} minutes`);
    return res.success;
  } catch (err) {
    console.warn('[NATIVE ALARM] Snooze native alarm notice:', err);
    return false;
  }
}

export async function cancelAllNativeLocalAlarms(): Promise<boolean> {
  if (!isNativePlatform()) return true;

  try {
    const res = await NativeAlarm.cancelAll();
    console.log('[NATIVE ALARM] Cancelled all pending native OS alarms.');
    return res.success;
  } catch (err) {
    console.warn('[NATIVE ALARM] Cancel all native alarms notice:', err);
    return false;
  }
}

export async function getScheduledNativeAlarms(): Promise<any[]> {
  if (!isNativePlatform()) return [];

  try {
    const res = await NativeAlarm.getScheduled();
    return res.alarms || [];
  } catch (err) {
    console.warn('[NATIVE ALARM] getScheduled notice:', err);
    return [];
  }
}

export async function playNativeAudioPreview(sound: string): Promise<boolean> {
  if (isNativePlatform()) {
    try {
      const res = await NativeAlarm.playAudioPreview({ sound });
      return res.playing;
    } catch (err) {
      console.warn('[NATIVE ALARM] playAudioPreview notice:', err);
      return false;
    }
  }
  return false;
}

export async function stopNativeAudioPreview(): Promise<boolean> {
  if (isNativePlatform()) {
    try {
      await NativeAlarm.stopAudioPreview();
      return true;
    } catch (err) {
      console.warn('[NATIVE ALARM] stopAudioPreview notice:', err);
      return false;
    }
  }
  return false;
}
