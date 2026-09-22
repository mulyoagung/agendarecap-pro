"use client";

import { useState, useEffect } from "react";
import { useReminderStore, Frequency, ReminderItem } from "@/store/useReminderStore";
import { getUTCISOFromLocal, formatLocalFromUTC } from "@/lib/timezone";

// Format time input for consistent 24h display (auto-colon, zero-pad)
function formatTimeInput(raw: string): string {
  // Strip non-digits
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length <= 2) return digits;
  const hh = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  return `${hh}:${mm}`;
}

function isValidTime24(val: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(val);
}

function padTime24(val: string): string {
  // Try to normalize partial inputs: "8:5" -> "08:05", "830" -> "08:30"
  const stripped = val.replace(/[^\d:]/g, '');
  const parts = stripped.split(':');
  if (parts.length === 2) {
    const hh = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    return `${hh}:${mm}`;
  }
  // Digits only
  const digits = stripped.replace(/:/g, '');
  if (digits.length >= 3) {
    const hh = digits.slice(0, digits.length - 2).padStart(2, '0');
    const mm = digits.slice(-2).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return val;
}
import { Bell, BellRing, Plus, Trash2, ArrowLeft, Clock, Calendar, ShieldAlert, Edit2, RefreshCw, Zap, CheckCircle2, AlertTriangle, Send, Check, BellOff, Terminal, Play, RotateCcw, Download } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Swal from "sweetalert2";
import { downloadICSFile, generateGoogleCalendarUrl } from "@/lib/calendar-service";
import ConnectivityBanner from "@/components/ConnectivityBanner";

export default function RemindersPage() {
  const { reminders, occurrences, dbSynced, isOffline, fetchReminders, addReminder, updateReminder, reactivateReminder, toggleReminder, deleteReminder, snoozeOccurrence, completeOccurrence, triggerSync } = useReminderStore();

  // Helper: get current local time as HH:mm (device local time, not UTC)
  const getLocalNowHHmm = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [time, setTime] = useState(getLocalNowHHmm);
  const [scheduledDate, setScheduledDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [timezone, setTimezone] = useState<string>("Asia/Jakarta");
  const [frequency, setFrequency] = useState<Frequency>("once");
  const [sound, setSound] = useState<string>("default");
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'all'>('active');

  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [swActive, setSwActive] = useState(false);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTestingCron, setIsTestingCron] = useState(false);

  useEffect(() => {
    fetchReminders();
    if (typeof window !== 'undefined') {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta");
      if ('Notification' in window) {
        setPermission(Notification.permission);
      }
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((reg) => {
          setSwActive(true);
          reg.pushManager.getSubscription().then((sub) => {
            setSubscriptionActive(!!sub);
          });
        }).catch(() => setSwActive(false));
      }
    }
  }, [fetchReminders]);

  const syncPushSubscription = async (forceReRegister = false) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (forceReRegister && subscription) {
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!VAPID_KEY) {
          console.warn("[REMINDER] VAPID Public key missing in environment variables");
          return;
        }
        const urlBase64ToUint8Array = (base64String: string) => {
          const padding = '='.repeat((4 - base64String.length % 4) % 4);
          const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
          const rawData = window.atob(base64);
          const outputArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
          return outputArray;
        };

        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_KEY)
        });
      }

      if (subscription) {
        setSubscriptionActive(true);
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription,
            deviceInfo: {
              userAgent: navigator.userAgent,
              platform: navigator.platform
            }
          })
        });
      }
    } catch (err: any) {
      console.error("[REMINDER] Failed to sync push subscription:", err);
    }
  };

  useEffect(() => {
    if (permission === 'granted') {
      syncPushSubscription();
    }
  }, [permission]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    await triggerSync();
    setIsSyncing(false);
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Data Tersinkronisasi',
      showConfirmButton: false,
      timer: 1500
    });
  };

  const handleTriggerCronServer = async () => {
    setIsTestingCron(true);
    try {
      const res = await fetch('/api/cron/reminders?manual=true');
      const data = await res.json();
      await fetchReminders();

      if (data.success) {
        Swal.fire({
          title: '⚙️ SCHEDULER SERVER EXECUTED',
          html: `
            <div class="text-left text-xs space-y-2 font-mono bg-black/50 p-3 rounded-xl border border-white/10">
              <p class="text-emerald-400 font-bold">✓ Status: Server Cron Execution Success</p>
              <p class="text-zinc-300"><b>Pengingat Jatuh Tempo Ditemukan:</b> ${data.foundCount || 0}</p>
              <p class="text-zinc-300"><b>Notifikasi Push Berhasil Dikirim:</b> ${data.successPushCount || 0}</p>
              <p class="text-amber-300"><b>Target Push Gagal / Expired:</b> ${data.failedPushCount || 0}</p>
              ${data.foundCount === 0 ? '<p class="text-zinc-400 italic mt-2">Catatan: Belum ada pengingat yang telah melewati jam jatuh tempo saat ini.</p>' : ''}
            </div>
          `,
          icon: 'success',
          confirmButtonText: 'Tutup'
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Eksekusi Cron Server Gagal',
          text: data.error || 'Terjadi kesalahan saat memproses cron server.'
        });
      }
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Gagal Trigger Cron', text: err.message });
    } finally {
      setIsTestingCron(false);
    }
  };

  const handleEdit = (reminder: ReminderItem) => {
    setEditingId(reminder.id);
    setTitle(reminder.title);
    setBodyText(reminder.body || "");
    setTime(reminder.time || "08:00");
    if (reminder.currentOccurrence?.scheduledAt) {
      const localIso = formatLocalFromUTC(reminder.currentOccurrence.scheduledAt, reminder.timezone);
      const datePart = localIso.split(" ")[0];
      if (datePart && datePart.includes("-")) {
        setScheduledDate(datePart);
      }
    }
    setFrequency(reminder.frequency || "once");
    setSound(reminder.sound || "default");
    setIsAdding(true);
  };

  const handleReactivate = async (id: string) => {
    const target = reminders.find(r => r.id === id);
    if (!target) return;

    // Check if this is a one-time reminder with an expired schedule
    if (target.frequency === 'once') {
      const occ = target.currentOccurrence;
      const scheduledMs = occ?.scheduledAt ? new Date(occ.scheduledAt).getTime() : 0;
      const nowMs = Date.now();

      if (scheduledMs <= nowMs) {
        // Expired one-time reminder — ask user before rescheduling
        const tomorrow = new Date(nowMs + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        const displayTime = target.time || '08:00';

        const result = await Swal.fire({
          icon: 'warning',
          title: 'Pengingat Sudah Lewat',
          html: `<p style="margin-bottom:8px">Waktu pengingat ini sudah lewat.</p><p><b>Jadwalkan kembali besok pukul ${displayTime}?</b></p>`,
          showCancelButton: true,
          confirmButtonText: 'Jadwalkan Besok',
          cancelButtonText: 'Batal',
          confirmButtonColor: '#3B82F6',
          cancelButtonColor: '#6B7280',
          background: '#18181b',
          color: '#fff'
        });

        if (!result.isConfirmed) return; // User cancelled — remain inactive

        try {
          await reactivateReminder(id, { scheduledDate: tomorrowStr });
          Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: `Pengingat dijadwalkan besok pukul ${displayTime}`,
            showConfirmButton: false,
            timer: 2000
          });
        } catch (e: any) {
          Swal.fire({
            icon: 'error',
            title: 'Gagal Mengaktifkan',
            text: e.message || 'Terjadi kesalahan.',
            confirmButtonColor: '#ef4444',
            background: '#18181b',
            color: '#fff'
          });
        }
        return;
      }
    }

    // Non-expired or recurring — reactivate directly
    try {
      await reactivateReminder(id);
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Pengingat Diaktifkan Kembali!',
        showConfirmButton: false,
        timer: 1500
      });
    } catch (e: any) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal Mengaktifkan',
        text: e.message || 'Terjadi kesalahan.',
        confirmButtonColor: '#ef4444',
        background: '#18181b',
        color: '#fff'
      });
    }
  };

  const handleAddOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    const scheduledAtISO = getUTCISOFromLocal(scheduledDate, time, timezone);

    if (editingId) {
      await updateReminder(editingId, {
        title,
        body: bodyText,
        time,
        scheduledDate,
        timezone,
        frequency,
        sound,
        daysOfWeek: frequency === 'weekly' ? [new Date(scheduledDate).getDay()] : undefined
      });
      Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Pengingat Diperbarui & Diunggah', showConfirmButton: false, timer: 1500 });
      resetForm();
    } else {
      // addReminder returns boolean — only show success if it returned true
      const success = await addReminder({
        title,
        body: bodyText,
        time,
        scheduledDate,
        scheduledAt: scheduledAtISO,
        timezone,
        frequency,
        sound,
        daysOfWeek: frequency === 'weekly' ? [new Date(scheduledDate).getDay()] : undefined
      });
      if (success) {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Pengingat Dijadwalkan & Diunggah', showConfirmButton: false, timer: 1500 });
        resetForm();
      }
      // If !success, the store already showed an error Swal — don't resetForm so user can fix time
    }
  };

  const resetForm = () => {
    setTitle("");
    setBodyText("");
    setTime(getLocalNowHHmm());  // Reset to current local time, not static 08:00
    setScheduledDate(new Date().toISOString().split('T')[0]);
    setFrequency("once");
    setSound("default");
    setEditingId(null);
    setIsAdding(false);
  };

  const filteredReminders = reminders.filter(r => {
    const occ = r.currentOccurrence;
    const isCompleted = occ?.status === 'completed' || occ?.status === 'dismissed';
    if (activeTab === 'active') {
      return r.isActive && !isCompleted;
    }
    if (activeTab === 'completed') {
      return isCompleted;
    }
    return true;
  });

  return (
    <main className="min-h-screen relative bg-[#0A0A0B] text-zinc-100 pb-16">
      <ConnectivityBanner />
      {/* Dynamic Background Glow */}
      <div className="fixed top-[-10%] right-[-10%] w-[45%] h-[45%] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-10%] left-[-10%] w-[45%] h-[45%] bg-purple-600/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto p-4 sm:p-8 flex flex-col gap-6">
        
        {/* Navigation & Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between glass p-4 sm:p-6 rounded-[2rem] border border-blue-500/15 shadow-2xl gap-4">
          <div className="flex items-center gap-4">
            <Link 
              href="/"
              className="p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all text-zinc-400 hover:text-white border border-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <BellRing className="w-6 h-6 text-blue-400" />
                Offline-First Reminder Engine
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 font-medium">Hybrid Alarm Engine for Personal Notes (Vercel Cron + PWA)</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <a
              href="/downloads/AgendaRecap_Pro.apk"
              download="AgendaRecap_Pro.apk"
              onClick={(e) => {
                if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform()) {
                  e.preventDefault();
                  Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'info',
                    title: 'Aplikasi AgendaRecap Pro sudah berjalan di perangkat Android Native.',
                    showConfirmButton: false,
                    timer: 3000
                  });
                }
              }}
              className="p-3 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-xl transition-all text-emerald-300 flex items-center gap-2 text-xs font-bold"
              title="Download APK AgendaRecap Pro"
            >
              <Download className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline">Download APK</span>
            </a>

            <button
              onClick={handleTriggerCronServer}
              disabled={isTestingCron}
              className="p-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl transition-all text-amber-300 flex items-center gap-2 text-xs font-bold"
              title="Manual Trigger Scheduler Server"
            >
              <Play className={`w-4 h-4 ${isTestingCron ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Cek Jam Jatuh Tempo</span>
            </button>

            <Link
              href="/diagnostics"
              className="p-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-xl transition-all text-blue-300 flex items-center gap-2 text-xs font-bold"
              title="Open Diagnostics Page"
            >
              <Terminal className="w-4 h-4" />
              <span className="hidden sm:inline">Diagnostik</span>
            </Link>

            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="p-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl transition-all text-white flex items-center gap-2 text-xs font-semibold"
              title="Sync local queue with Supabase"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync</span>
            </button>
          </div>
        </header>

        {/* System Health Bar */}
        <div className="glass p-5 rounded-[1.8rem] border border-white/10 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <h2 className="text-xs font-bold text-white uppercase tracking-wider">Status Hybrid Engine</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${!isOffline ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-xs text-zinc-400 font-semibold">
                {!isOffline ? 'Online (Supabase Server Sync Active)' : 'Offline (IndexedDB Local Replica)'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5">
              <span className="text-zinc-400 font-medium">Browser Permission:</span>
              <span className={`font-bold flex items-center gap-1.5 ${permission === 'granted' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {permission === 'granted' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {permission === 'granted' ? 'Granted' : 'Default'}
              </span>
            </div>

            <div className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5">
              <span className="text-zinc-400 font-medium">Service Worker:</span>
              <span className={`font-bold flex items-center gap-1.5 ${swActive ? 'text-emerald-400' : 'text-amber-400'}`}>
                {swActive ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {swActive ? 'Active (v4)' : 'Inactive'}
              </span>
            </div>

            <div className="flex items-center justify-between p-3.5 bg-white/5 rounded-xl border border-white/5">
              <span className="text-zinc-400 font-medium">Web Push Sub:</span>
              <span className={`font-bold flex items-center gap-1.5 ${subscriptionActive ? 'text-emerald-400' : 'text-blue-400'}`}>
                {subscriptionActive ? <Send className="w-3.5 h-3.5 text-emerald-400" /> : <BellOff className="w-3.5 h-3.5" />}
                {subscriptionActive ? 'Subscribed' : 'Not Subscribed'}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Filters & Create Button */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-1">
          <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'active' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Aktif ({reminders.filter(r => r.isActive && r.currentOccurrence?.status !== 'completed' && r.currentOccurrence?.status !== 'dismissed').length})
            </button>
            <button
              onClick={() => setActiveTab('completed')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'completed' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Selesai ({reminders.filter(r => r.currentOccurrence?.status === 'completed' || r.currentOccurrence?.status === 'dismissed').length})
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'all' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Semua ({reminders.length})
            </button>
          </div>

          <button
            onClick={() => {
              if (isAdding && editingId) resetForm();
              else setIsAdding(!isAdding);
            }}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-500/25 font-bold text-xs transition-all"
          >
            <Plus className="w-4 h-4" /> {isAdding && editingId ? 'Batal Edit' : 'Buat Pengingat Baru'}
          </button>
        </div>

        {/* Add / Edit Form Drawer */}
        <AnimatePresence>
          {isAdding && (
            <motion.form
              initial={{ opacity: 0, y: -20, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -20, height: 0 }}
              onSubmit={handleAddOrUpdate}
              className="glass p-6 rounded-[1.8rem] border border-blue-500/20 mb-2 overflow-hidden shadow-2xl"
            >
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-400" />
                {editingId ? 'Edit Catatan & Pengingat Alarm' : 'Buat Catatan & Pengingat Alarm'}
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-full">
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Judul Pengingat *</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Contoh: Rapat Panitia Dies Natalis, Tagihan Listrik..."
                    className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/60 text-sm"
                  />
                </div>

                <div className="col-span-full">
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Catatan / Detail Notifikasi (Body)</label>
                  <textarea
                    rows={2}
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    placeholder="Contoh: Pastikan membawa draft rundown dan daftar VIP."
                    className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/60 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Tanggal Eksekusi</label>
                  <input
                    type="date"
                    required
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/60 text-sm [color-scheme:dark]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Waktu Jam (HH:mm)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    placeholder="HH:mm"
                    maxLength={5}
                    value={time}
                    onChange={(e) => {
                      const formatted = formatTimeInput(e.target.value);
                      setTime(formatted);
                    }}
                    onBlur={() => {
                      const padded = padTime24(time);
                      if (isValidTime24(padded)) {
                        setTime(padded);
                      }
                    }}
                    className={`w-full bg-[#121214] border rounded-xl px-4 py-2.5 text-white focus:outline-none text-sm font-mono tracking-widest ${
                      time && !isValidTime24(time) ? 'border-red-500/60 focus:border-red-500/80' : 'border-white/10 focus:border-blue-500/60'
                    }`}
                  />
                  {time && !isValidTime24(time) && (
                    <p className="text-red-400 text-[10px] mt-1">Format harus HH:mm (00:00 - 23:59)</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-1">Frekuensi Pengulangan (Recurring)</label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as Frequency)}
                    className="w-full bg-[#121214] border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/60 text-sm [&>option]:bg-[#121214]"
                  >
                    <option value="once">Sekali Jalan (One-time)</option>
                    <option value="daily">Setiap Hari (Daily)</option>
                    <option value="weekdays">Hari Kerja (Senin - Jumat)</option>
                    <option value="weekly">Mingguan (Weekly)</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-5 mt-2 border-t border-white/10">
                <button type="button" onClick={resetForm} className="px-5 py-2.5 text-zinc-400 hover:text-white font-semibold rounded-xl text-xs transition-colors">
                  Batal
                </button>
                <button type="submit" className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-500/20">
                  {editingId ? 'Simpan Perubahan' : 'Jadwalkan & Upload'}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Reminder Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredReminders.length > 0 ? (
            filteredReminders.map(reminder => {
              const occ = reminder.currentOccurrence;
              const isSnoozed = occ?.status === 'snoozed';
              const isProcessing = occ?.status === 'processing';
              const isCompleted = occ?.status === 'completed' || occ?.status === 'dismissed';

              return (
                <div 
                  key={reminder.id} 
                  className={`glass p-5 rounded-[1.8rem] border flex flex-col relative overflow-hidden transition-all ${
                    isSnoozed ? 'border-amber-500/40 bg-amber-500/5' :
                    isProcessing ? 'border-blue-500/40 bg-blue-500/5 animate-pulse' :
                    isCompleted ? 'border-white/5 opacity-65 bg-zinc-900/30' :
                    'border-white/10 hover:border-blue-500/30'
                  }`}
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                    isSnoozed ? 'bg-amber-400' :
                    isProcessing ? 'bg-amber-300' :
                    isCompleted ? 'bg-zinc-600' :
                    reminder.isActive ? 'bg-blue-500' : 'bg-zinc-700'
                  }`} />

                  <div className="flex justify-between items-start mb-2 pl-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-bold text-base ${isCompleted ? 'line-through text-zinc-400' : 'text-white'}`}>
                          {reminder.title}
                        </h3>
                        {isSnoozed && (
                          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] font-bold rounded-full border border-amber-500/30">
                            SNOOZED
                          </span>
                        )}
                        {isProcessing && (
                          <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 text-[10px] font-bold rounded-full border border-amber-400/30">
                            PROCESSING
                          </span>
                        )}
                        {occ?.status === 'sent' && (
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold rounded-full border border-emerald-500/30">
                            SENT
                          </span>
                        )}
                        {isCompleted && (
                          <span className="px-2 py-0.5 bg-zinc-700/50 text-zinc-400 text-[10px] font-bold rounded-full border border-zinc-600/30">
                            SELESAI
                          </span>
                        )}
                      </div>
                      {reminder.body && (
                        <p className="text-xs text-zinc-300 mt-1 italic font-mono bg-white/5 p-2 rounded-lg border border-white/5">
                          "{reminder.body}"
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => toggleReminder(reminder.id)}
                      className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-colors ${
                        reminder.isActive && !isCompleted ? "bg-blue-500" : "bg-zinc-700"
                      }`}
                      title={isCompleted ? "Aktifkan Kembali" : reminder.isActive ? "Nonaktifkan" : "Aktifkan"}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          reminder.isActive && !isCompleted ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  
                  <div className="flex flex-col gap-2.5 mt-auto pt-3 border-t border-white/5 pl-2">
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-blue-400" />
                        <span className="font-bold text-white text-sm">{reminder.time}</span>
                        <span className="text-[10px] text-zinc-500">({reminder.timezone})</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                        <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                        <span>
                          {reminder.frequency === 'daily' ? 'Setiap Hari' :
                           reminder.frequency === 'weekdays' ? 'Hari Kerja' :
                           reminder.frequency === 'weekly' ? 'Mingguan' : 'Satu Kali'}
                        </span>
                      </div>
                    </div>

                    {/* Occurrence UTC Timestamp */}
                    <div className="text-[10px] font-mono text-zinc-500 bg-white/5 p-1.5 rounded-lg flex items-center justify-between">
                      <span>Scheduled: {occ?.scheduledAt ? formatLocalFromUTC(occ.scheduledAt, reminder.timezone) : 'N/A'}</span>
                      <span className={`font-bold ${isCompleted ? 'text-zinc-400' : 'text-amber-400'}`}>{occ?.status ? occ.status.toUpperCase() : 'SCHEDULED'}</span>
                    </div>

                    {/* Quick Snooze & Close Actions */}
                    {!isCompleted && occ && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          onClick={() => snoozeOccurrence(reminder.id, occ.id, 5)}
                          className="flex-1 py-1.5 px-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-lg text-[11px] font-bold transition-all text-center"
                        >
                          ⏱ 5 MIN
                        </button>
                        <button
                          onClick={() => snoozeOccurrence(reminder.id, occ.id, 15)}
                          className="flex-1 py-1.5 px-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-lg text-[11px] font-bold transition-all text-center"
                        >
                          ⏱ 15 MIN
                        </button>
                        <button
                          onClick={() => snoozeOccurrence(reminder.id, occ.id, 60)}
                          className="flex-1 py-1.5 px-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 rounded-lg text-[11px] font-bold transition-all text-center"
                        >
                          ⏱ 1 HOUR
                        </button>
                        <button
                          onClick={() => completeOccurrence(reminder.id, occ.id)}
                          className="py-1.5 px-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                          title="CLOSE / Dismiss"
                        >
                          <Check className="w-3.5 h-3.5" /> CLOSE
                        </button>
                      </div>
                    )}

                    {/* Reactivate Action Button for Completed Reminders */}
                    {isCompleted && (
                      <div className="pt-1">
                        <button
                          onClick={() => handleReactivate(reminder.id)}
                          className="w-full py-2 px-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Aktifkan Kembali Pengingat Ini
                        </button>
                      </div>
                    )}

                    {/* Card Footer with Calendar Export, Edit & Delete */}
                    <div className="flex justify-between items-center pt-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            if (occ?.scheduledAt) {
                              downloadICSFile({ title: reminder.title, body: reminder.body, scheduledAt: occ.scheduledAt });
                            }
                          }}
                          className="px-2 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-md text-[10px] font-semibold border border-white/10 flex items-center gap-1 transition-all"
                          title="Download file .ICS Kalender"
                        >
                          <Calendar className="w-3 h-3 text-blue-400" />
                          <span>.ICS</span>
                        </button>
                        <a
                          href={occ?.scheduledAt ? generateGoogleCalendarUrl({ title: reminder.title, body: reminder.body, scheduledAt: occ.scheduledAt }) : '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 rounded-md text-[10px] font-semibold border border-blue-500/20 flex items-center gap-1 transition-all"
                          title="Buka di Google Calendar"
                        >
                          <Calendar className="w-3 h-3 text-blue-400" />
                          <span>Google Cal</span>
                        </a>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEdit(reminder)}
                          className="p-1.5 text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors"
                          title="Edit Pengingat"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteReminder(reminder.id)}
                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                          title="Hapus"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-full py-16 flex flex-col items-center justify-center text-center glass rounded-[2rem] border border-white/5">
              <Bell className="w-16 h-16 text-zinc-700 mb-4" />
              <h3 className="text-base font-bold text-zinc-400">Tidak ada pengingat dalam kategori ini</h3>
              <p className="text-zinc-500 text-xs max-w-sm mt-1">Pengingat tersinkron otomatis antara IndexedDB lokal dan Supabase cloud.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
