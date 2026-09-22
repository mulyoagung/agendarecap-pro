import { createClient as createAdminSupabase } from '@supabase/supabase-js';
import webpush from 'web-push';
import { formatLocalFromUTC, getUTCISOFromLocal } from '@/lib/timezone';

export interface ProcessRemindersResult {
  success: boolean;
  checkedAt: string;
  foundCount: number;
  processedCount: number;
  successPushCount: number;
  failedPushCount: number;
  logs: string[];
  error?: string;
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
  return createAdminSupabase(supabaseUrl, serviceKey);
}

export async function processDueReminders(): Promise<ProcessRemindersResult> {
  const logs: string[] = [];
  const addLog = (msg: string) => {
    const timeStr = new Date().toISOString();
    const logLine = `[CRON ${timeStr}] ${msg}`;
    console.log(logLine);
    logs.push(logLine);
  };

  addLog('Scheduler trigger initiated - Checking due reminder occurrences');

  const adminSupabase = getAdminClient();

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@agendarecap.com';

  if (!vapidPublic || !vapidPrivate) {
    addLog('CRITICAL ERROR: VAPID public or private key is missing in server environment variables!');
    return {
      success: false,
      checkedAt: new Date().toISOString(),
      foundCount: 0,
      processedCount: 0,
      successPushCount: 0,
      failedPushCount: 0,
      logs,
      error: 'VAPID keys missing'
    };
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  } catch (err: any) {
    addLog(`VAPID setup warning: ${err.message}`);
  }

  const now = new Date();
  const nowISO = now.toISOString();
  const nowLocalWIB = formatLocalFromUTC(nowISO, 'Asia/Jakarta');
  addLog(`Current Server Execution Time: UTC=${nowISO} | Asia/Jakarta=${nowLocalWIB}`);

  let successPushCount = 0;
  let failedPushCount = 0;
  let processedCount = 0;

  // 1. Fetch All Active Push Subscriptions Across User Devices
  const { data: subscribers, error: subErr } = await adminSupabase
    .from('push_subscribers')
    .select('*');

  if (subErr || !subscribers || subscribers.length === 0) {
    addLog(`WARNING: No active push subscribers found in database! (Device subscriptions = 0)`);
    return {
      success: true,
      checkedAt: nowISO,
      foundCount: 0,
      processedCount: 0,
      successPushCount: 0,
      failedPushCount: 0,
      logs,
      error: 'No active push subscribers in DB'
    };
  }

  addLog(`Active device push subscriptions in database: ${subscribers.length}`);

  // 1.5 Stale 'processing' Recovery: Reset occurrences stuck in 'processing' for > 10 minutes back to 'scheduled'
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  try {
    const { data: recoveredData, error: recoverErr } = await adminSupabase
      .from('reminder_occurrences')
      .update({ status: 'scheduled', updated_at: nowISO })
      .eq('status', 'processing')
      .lte('updated_at', tenMinutesAgo)
      .select('id');

    if (!recoverErr && recoveredData && recoveredData.length > 0) {
      addLog(`[RECOVERY] Successfully recovered ${recoveredData.length} stale 'processing' occurrence(s) back to 'scheduled' state`);
    }
  } catch (recErr: any) {
    addLog(`Stale processing recovery warning: ${recErr.message}`);
  }

  // 2. Authoritative Atomic Claim Lock Query for Due Occurrences
  let dueOccurrences: any[] = [];

  // Use stored procedure `claim_due_occurrences` as authoritative atomic claim
  try {
    const { data: claimedData, error: rpcErr } = await adminSupabase.rpc('claim_due_occurrences', {
      target_now: nowISO,
      fetch_limit: 50
    });

    if (!rpcErr && claimedData && Array.isArray(claimedData)) {
      dueOccurrences = claimedData;
      if (dueOccurrences.length > 0) {
        addLog(`RPC claim_due_occurrences authoritative claim returned ${dueOccurrences.length} occurrence(s)`);
      }
    } else if (rpcErr) {
      addLog(`RPC claim_due_occurrences notice: ${rpcErr.message} (code=${rpcErr.code})`);
    }
  } catch (e: any) {
    addLog(`RPC claim_due_occurrences error: ${e.message}`);
  }

  // Non-atomic direct SELECT -> UPDATE fallback is removed in production to eliminate concurrency race conditions.
  // Fail-safe: if RPC returns 0 rows or is unready, no un-claimed rows are processed.

  const foundCount = dueOccurrences.length;
  addLog(`Found ${foundCount} due occurrences ready for push delivery`);

  // 3. Process Each Due Occurrence
  for (const occ of dueOccurrences) {
    processedCount++;

    // Fetch parent reminder definition if details are missing
    let reminderTitle = occ.title;
    let reminderBody = occ.body;
    let reminderTime = occ.time || '08:00';
    let reminderFreq = occ.frequency || 'once';
    let reminderTz = occ.timezone || 'Asia/Jakarta';

    if (!reminderTitle) {
      const { data: rParent } = await adminSupabase
        .from('reminders')
        .select('*')
        .eq('id', occ.reminder_id)
        .single();

      if (rParent) {
        reminderTitle = rParent.title;
        reminderBody = rParent.body;
        reminderTime = rParent.time;
        reminderFreq = rParent.frequency;
        reminderTz = rParent.timezone;
      } else {
        reminderTitle = 'Pengingat AgendaRecap';
      }
    }

    const occurrenceId = occ.id;
    const reminderId = occ.reminder_id;
    const notificationTag = occ.notification_tag || `reminder-${reminderId}-occurrence-${occurrenceId}`;

    const scheduledLocal = formatLocalFromUTC(occ.scheduled_at || nowISO, reminderTz);
    addLog(`Processing Occurrence ID=${occurrenceId} (Reminder ID=${reminderId}) Tag="${notificationTag}" Title="${reminderTitle}" ScheduledAt=${occ.scheduled_at} (${scheduledLocal})`);

    // Target devices matching user_id or all devices if single user
    const targetSubs = subscribers.filter(s => !occ.user_id || s.user_id === occ.user_id || subscribers.length === 1);
    const subsToSend = targetSubs.length > 0 ? targetSubs : subscribers;

    // Build Web Push & FCM Payload: STRICTLY NO OPEN ACTION! ONLY CLOSE & SNOOZE
    const payloadData = {
      type: 'reminder',
      reminderId,
      occurrenceId,
      notificationTag,
      title: reminderTitle,
      body: reminderBody || `Waktu pengingat Anda (${reminderTime}) telah tiba!`,
      scheduledAt: occ.scheduled_at,
      isRecurring: reminderFreq !== 'once',
      actions: [
        { action: 'close', title: '❌ CLOSE' },
        { action: 'snooze_5', title: '⏱ 5 MIN' },
        { action: 'snooze_15', title: '⏱ 15 MIN' },
        { action: 'snooze_60', title: '⏱ 1 HOUR' }
      ]
    };
    const payload = JSON.stringify(payloadData);

    let pushSuccess = false;
    for (const sub of subsToSend) {
      addLog(`Sending Push Notification to device endpoint=${sub.endpoint.substring(0, 35)}...`);
      
      // 1. Send via WebPush
      try {
        const res = await webpush.sendNotification(sub.subscription, payload);
        addLog(`WebPush delivered successfully status=${res.statusCode} endpoint=${sub.endpoint.substring(0, 30)}...`);
        successPushCount++;
        pushSuccess = true;
      } catch (err: any) {
        failedPushCount++;
        addLog(`WebPush failed error=${err.message} statusCode=${err.statusCode}`);
        if (err.statusCode === 404 || err.statusCode === 410) {
          addLog(`Subscribed endpoint expired (404/410) -> Deleting stale subscription endpoint=${sub.endpoint.substring(0, 30)}...`);
          await adminSupabase.from('push_subscribers').delete().eq('endpoint', sub.endpoint);
        }
      }

      // 2. Direct FCM Push payload if subscription contains fcm_token
      if (sub.subscription && sub.subscription.fcm_token) {
        const fcmServerKey = process.env.FCM_SERVER_KEY;
        if (fcmServerKey) {
          try {
            addLog(`Sending FCM High-Priority Floating push to token=${sub.subscription.fcm_token.substring(0, 15)}...`);
            const fcmRes = await fetch('https://fcm.googleapis.com/fcm/send', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `key=${fcmServerKey}`
              },
              body: JSON.stringify({
                to: sub.subscription.fcm_token,
                priority: 'high',
                data: {
                  title: reminderTitle,
                  body: reminderBody || `Waktu pengingat Anda (${reminderTime}) telah tiba!`,
                  reminderId,
                  occurrenceId
                }
              })
            });
            if (fcmRes.ok) {
              addLog(`FCM Floating Push delivered successfully to token=${sub.subscription.fcm_token.substring(0, 15)}...`);
              pushSuccess = true;
            }
          } catch (fcmErr: any) {
            addLog(`FCM Push warning: ${fcmErr.message}`);
          }
        }
      }
    }

    // Mark occurrence status as 'sent'
    const finalStatus = pushSuccess ? 'sent' : 'failed';
    try {
      await adminSupabase
        .from('reminder_occurrences')
        .update({
          status: finalStatus,
          sent_at: nowISO,
          updated_at: nowISO
        })
        .eq('id', occurrenceId);
    } catch (e) {
      // Legacy fallback update
      await adminSupabase
        .from('reminders')
        .update({ status: finalStatus, updated_at: nowISO })
        .eq('id', reminderId);
    }
  }

  addLog(`Scheduler execution completed: Checked=${foundCount}, Processed=${processedCount}, PushSuccess=${successPushCount}, PushFailed=${failedPushCount}`);

  return {
    success: true,
    checkedAt: nowISO,
    foundCount,
    processedCount,
    successPushCount,
    failedPushCount,
    logs
  };
}

// Function to generate the NEXT occurrence for recurring reminders upon completion
export async function generateNextOccurrence(reminderId: string, completedOccurrenceScheduledAt: string): Promise<any> {
  const adminSupabase = getAdminClient();

  const { data: r } = await adminSupabase
    .from('reminders')
    .select('*')
    .eq('id', reminderId)
    .single();

  if (!r || !r.is_active || r.frequency === 'once') return null;

  const currentScheduled = new Date(completedOccurrenceScheduledAt);
  let nextDate = new Date(currentScheduled.getTime());

  if (r.frequency === 'daily') {
    nextDate.setDate(nextDate.getDate() + 1);
  } else if (r.frequency === 'weekdays') {
    do {
      nextDate.setDate(nextDate.getDate() + 1);
    } while (nextDate.getDay() === 0 || nextDate.getDay() === 6);
  } else if (r.frequency === 'weekly') {
    nextDate.setDate(nextDate.getDate() + 7);
  }

  const nextScheduledISO = nextDate.toISOString();
  const nextOccurrenceId = crypto.randomUUID();

  const nextOccurrence = {
    id: nextOccurrenceId,
    reminder_id: reminderId,
    user_id: r.user_id,
    scheduled_at: nextScheduledISO,
    status: 'scheduled',
    notification_tag: `reminder-${reminderId}-occurrence-${nextOccurrenceId}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    await adminSupabase.from('reminder_occurrences').insert(nextOccurrence);
    console.log(`[RECURRING] Generated next occurrence for reminder ${reminderId} -> Target: ${nextScheduledISO}`);
  } catch (e) {
    console.warn('[RECURRING] Failed to insert next occurrence:', e);
  }

  return nextOccurrence;
}
