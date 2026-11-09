"use client";

import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, AlertTriangle, CheckCircle2, Database, Copy, Wrench, Clock, ShieldAlert, Layers, Smartphone, Globe, Radio, Trash2 } from "lucide-react";
import Swal from "sweetalert2";
import { getOfflineQueue, repairOrphanDataAndQueueInIDB, removeFromOfflineQueue, purgeAllFailedQueueItems, IDBOfflineQueueItem } from "@/lib/idb";
import { runSyncEngine } from "@/lib/sync-engine";
import { isNativePlatform, checkNativeAlarmPermissions, getScheduledNativeAlarms } from "@/lib/native-alarm";

export type DiagnosticStatus = 'PENDING' | 'PROCESSING' | 'FAILED_RETRYABLE' | 'FAILED_FATAL' | 'SUCCESS';

export interface DiagnosticItem {
  id: string;
  category: 'SYNC' | 'PUSH' | 'NATIVE_ALARM' | 'NATIVE_SOUND' | 'FCM' | 'WIDGET' | 'AUTH' | 'OFFLINE';
  feature: string;
  status: DiagnosticStatus;
  message: string;
  detail?: string;
  timestamp: string;
  occurrenceId?: string;
  retryCount: number;
  source: string;
  platform: 'Android Native' | 'Web Browser';
}

interface DiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFilter?: 'ALL' | 'PENDING' | 'PROCESSING' | 'FAILED' | 'RESOLVED';
  onQueueUpdated?: () => void;
}

const STORAGE_RESOLVED_KEY = 'agendaku_diag_resolved_ids_v2';

export default function DiagnosticModal({ isOpen, onClose, initialFilter = 'ALL', onQueueUpdated }: DiagnosticModalProps) {
  const [filter, setFilter] = useState<'ALL' | 'PENDING' | 'PROCESSING' | 'FAILED' | 'RESOLVED'>('ALL');
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);

  useEffect(() => {
    if (initialFilter) {
      setFilter(initialFilter);
    }
  }, [initialFilter]);

  // Persist resolved IDs in localStorage so they survive refresh, modal close, app restart, and sync
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_RESOLVED_KEY);
      if (stored) setResolvedIds(new Set(JSON.parse(stored)));
    } catch (e) {}
  }, []);

  const markAsResolved = async (id: string) => {
    // Also remove from offline queue if present
    try {
      await removeFromOfflineQueue(id);
    } catch (_) {}

    setResolvedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(STORAGE_RESOLVED_KEY, JSON.stringify([...next]));
      } catch (e) {}
      return next;
    });

    if (onQueueUpdated) onQueueUpdated();
  };

  const clearAllResolved = () => {
    setResolvedIds(new Set());
    try {
      localStorage.removeItem(STORAGE_RESOLVED_KEY);
    } catch (e) {}
  };

  const loadDiagnosticsData = useCallback(async () => {
    setIsLoading(true);
    try {
      const items: DiagnosticItem[] = [];
      const platformName = isNativePlatform() ? 'Android Native' : 'Web Browser';

      // 1. Load IndexedDB Offline Queue items with explicit lifecycle states
      const queueItems = await getOfflineQueue();
      for (const q of queueItems) {
        let status: DiagnosticStatus = 'PENDING';
        let message = q.error_message || 'Menunggu koneksi & giliran eksekusi sinkronisasi';

        if (q.status === 'SYNCING') {
          status = 'PROCESSING';
          message = 'Sedang diproses oleh Sync Engine...';
        } else if (q.status === 'FAILED_RETRYABLE') {
          status = 'FAILED_RETRYABLE';
          message = q.error_message || `Gagal sementara (Percobaan ${q.retry_count || 1}), akan diulang otomatis.`;
        } else if (q.status === 'FAILED_FATAL') {
          status = 'FAILED_FATAL';
          message = q.error_message || 'Gagal permanen: Ditolak oleh server atau validasi skema.';
        }

        let category: DiagnosticItem['category'] = 'SYNC';
        if (q.entity_type === 'occurrence' && (q.operation === 'SNOOZE' || q.operation === 'COMPLETE')) {
          category = 'NATIVE_ALARM';
        }

        const featureName = `${q.entity_type.toUpperCase()} (${q.operation})`;
        const timestampStr = new Date(q.created_at || q.createdAt || Date.now()).toLocaleTimeString('id-ID', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });

        items.push({
          id: q.id,
          category,
          feature: featureName,
          status,
          message,
          detail: JSON.stringify({
            queueId: q.id,
            entityType: q.entity_type,
            entityId: q.entity_id,
            operation: q.operation,
            retryCount: q.retry_count || 0,
            status: q.status,
            payload: q.payload
          }, null, 2),
          timestamp: timestampStr,
          occurrenceId: q.entity_id,
          retryCount: q.retry_count || 0,
          source: 'IndexedDB Offline Queue',
          platform: platformName
        });
      }

      // 2. Load Native Alarm diagnostics if on Android
      if (isNativePlatform()) {
        try {
          const perms = await checkNativeAlarmPermissions();
          if (perms.notifications !== 'granted') {
            items.push({
              id: 'sys-perm-notif',
              category: 'NATIVE_ALARM',
              feature: 'Izin Notifikasi Android',
              status: 'FAILED_FATAL',
              message: 'Izin notifikasi belum diberikan oleh pengguna.',
              detail: `Status izin notifikasi OS: ${perms.notifications}`,
              timestamp: new Date().toLocaleTimeString('id-ID'),
              retryCount: 0,
              source: 'Android OS Permission',
              platform: 'Android Native'
            });
          }
          if (!perms.exactAlarm) {
            items.push({
              id: 'sys-perm-exact',
              category: 'NATIVE_ALARM',
              feature: 'Exact Alarm Permission',
              status: 'PENDING',
              message: 'Exact alarm permission belum aktif.',
              detail: 'Android 12+ memerlukan izin SCHEDULE_EXACT_ALARM.',
              timestamp: new Date().toLocaleTimeString('id-ID'),
              retryCount: 0,
              source: 'Android AlarmManager',
              platform: 'Android Native'
            });
          }

          const scheduledAlarms = await getScheduledNativeAlarms();
          if (scheduledAlarms.length > 0) {
            items.push({
              id: 'sys-scheduled-alarms',
              category: 'NATIVE_ALARM',
              feature: 'Active Native Alarms',
              status: 'SUCCESS',
              message: `${scheduledAlarms.length} alarm OS Android terjadwal aktif.`,
              detail: JSON.stringify(scheduledAlarms, null, 2),
              timestamp: new Date().toLocaleTimeString('id-ID'),
              retryCount: 0,
              source: 'NativeAlarmPlugin',
              platform: 'Android Native'
            });
          }
        } catch (e: any) {
          console.warn('[DIAGNOSTICS MODAL] Native alarm check notice:', e);
        }
      }

      // 3. Load Server Push Delivery diagnostics (if available)
      try {
        const delRes = await fetch('/api/diagnostics/delivery').catch(() => null);
        if (delRes && delRes.ok) {
          const delData = await delRes.json();
          if (delData.success && Array.isArray(delData.diagnostics)) {
            for (const d of delData.diagnostics) {
              const timestampStr = new Date(d.attemptedAt).toLocaleTimeString('id-ID', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
              });
              let dStatus: DiagnosticStatus = 'PENDING';
              if (d.status === 'sent') dStatus = 'SUCCESS';
              else if (d.status === 'failed') dStatus = 'FAILED_RETRYABLE';
              else if (d.status === 'processing') dStatus = 'PROCESSING';

              items.push({
                id: d.id,
                category: 'PUSH',
                feature: `DELIVERY (${d.result})`,
                status: dStatus,
                message: d.message,
                detail: JSON.stringify(d, null, 2),
                timestamp: timestampStr,
                occurrenceId: d.occurrenceId,
                retryCount: 0,
                source: 'Push Delivery Service',
                platform: platformName
              });
            }
          }
        }
      } catch (e) {
        console.warn('[DIAGNOSTICS MODAL] Delivery diagnostics fetch notice:', e);
      }

      setDiagnostics(items);
    } catch (e: any) {
      console.error('[DIAGNOSTICS MODAL] Error loading diagnostics:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadDiagnosticsData();
    }
  }, [isOpen, loadDiagnosticsData]);

  if (!isOpen) return null;

  // Separate active vs resolved items
  const activeItems = diagnostics.filter(d => !resolvedIds.has(d.id));
  const resolvedItems = diagnostics.filter(d => resolvedIds.has(d.id));

  const pendingItems = activeItems.filter(d => d.status === 'PENDING');
  const processingItems = activeItems.filter(d => d.status === 'PROCESSING');
  const failedItems = activeItems.filter(d => d.status === 'FAILED_RETRYABLE' || d.status === 'FAILED_FATAL');

  const filteredDiagnostics = (() => {
    if (filter === 'RESOLVED') return resolvedItems;
    if (filter === 'PENDING') return pendingItems;
    if (filter === 'PROCESSING') return processingItems;
    if (filter === 'FAILED') return failedItems;
    return activeItems; // ALL = active unresolved pool
  })();

  const pendingCount = pendingItems.length;
  const processingCount = processingItems.length;
  const failedCount = failedItems.length;
  const resolvedCount = resolvedItems.length;
  const successCount = activeItems.filter(d => d.status === 'SUCCESS').length;

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const res = await runSyncEngine();
      if (res.success) {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'success',
          title: 'Sinkronisasi berhasil dijalankan!',
          showConfirmButton: false,
          timer: 2000
        });
      } else {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'warning',
          title: res.errors[0] || 'Beberapa item antrean memerlukan retry.',
          showConfirmButton: false,
          timer: 3000
        });
      }
      await loadDiagnosticsData();
      if (onQueueUpdated) onQueueUpdated();
    } catch (e: any) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'error',
        title: e?.message || 'Sync gagal',
        showConfirmButton: false,
        timer: 3000
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteQueueItem = async (id: string) => {
    const confirm = await Swal.fire({
      title: 'Hapus Item Antrean?',
      text: 'Item ini akan dihapus permanen dari antrean lokal dan tidak akan dicoba lagi.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Ya, Hapus!',
      cancelButtonText: 'Batal'
    });

    if (!confirm.isConfirmed) return;

    await removeFromOfflineQueue(id);
    await markAsResolved(id);
    await loadDiagnosticsData();
    if (onQueueUpdated) onQueueUpdated();
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: 'Item antrean berhasil dihapus',
      showConfirmButton: false,
      timer: 1500
    });
  };

  const handlePurgeAllFailed = async () => {
    const confirm = await Swal.fire({
      title: 'Bersihkan Semua Antrean Gagal?',
      text: 'Semua item antrean yang berstatus gagal / tertahan akan dibersihkan dari antrean lokal.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Ya, Bersihkan Semua',
      cancelButtonText: 'Batal'
    });

    if (!confirm.isConfirmed) return;

    const count = await purgeAllFailedQueueItems();
    await loadDiagnosticsData();
    if (onQueueUpdated) onQueueUpdated();
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'success',
      title: `Berhasil membersihkan ${count} antrean gagal`,
      showConfirmButton: false,
      timer: 2000
    });
  };

  const handleRepairDatabase = async () => {
    const confirm = await Swal.fire({
      title: 'Perbaiki Antrean & Database?',
      text: 'Ini akan mereset status retry antrean yang tertunda, membersihkan antrean orphan/rusak, dan menyelaraskan data lokal.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Perbaiki',
      cancelButtonText: 'Batal'
    });

    if (!confirm.isConfirmed) return;

    setIsRepairing(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || '';

      const result = await repairOrphanDataAndQueueInIDB(userId);
      Swal.fire({
        icon: 'success',
        title: 'Perbaikan Selesai',
        text: `Berhasil memperbaiki ${result.repairedQueue} item antrean dan data lokal.`,
        timer: 2500,
        showConfirmButton: false
      });
      await loadDiagnosticsData();
      if (onQueueUpdated) onQueueUpdated();
    } catch (e: any) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal Memperbaiki',
        text: e?.message || 'Terjadi kesalahan perbaikan.',
      });
    } finally {
      setIsRepairing(false);
    }
  };

  const handleCopyLog = async () => {
    const logText = JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: isNativePlatform() ? 'Android Native' : 'Web Browser',
      summary: { total: diagnostics.length, pending: pendingCount, failed: failedCount, success: successCount },
      diagnostics
    }, null, 2);

    try {
      await navigator.clipboard.writeText(logText);
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Log Diagnostik tersalin ke clipboard!',
        showConfirmButton: false,
        timer: 2000
      });
    } catch (e) {
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'error',
        title: 'Gagal menyalin log',
        showConfirmButton: false,
        timer: 2000
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl max-h-[85vh] bg-[#121215] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/20 text-purple-400 rounded-2xl border border-purple-500/30">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white leading-tight">Detail Diagnostik Status & Antrean</h3>
              <p className="text-xs text-zinc-400 font-medium">Inspeksi detail status Gagal, Pending, & Sinkronisasi</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter Tabs & Summary */}
        <div className="px-6 py-3 border-b border-white/5 bg-zinc-900/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                filter === 'ALL'
                  ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20'
                  : 'bg-white/5 text-zinc-400 hover:text-white'
              }`}
            >
              Aktif ({activeItems.length})
            </button>
            <button
              onClick={() => setFilter('PENDING')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                filter === 'PENDING'
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20'
                  : 'bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Pending ({pendingCount})</span>
            </button>
            {processingCount > 0 && (
              <button
                onClick={() => setFilter('PROCESSING')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  filter === 'PROCESSING'
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                    : 'bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20'
                }`}
              >
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Diproses ({processingCount})</span>
              </button>
            )}
            <button
              onClick={() => setFilter('FAILED')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                filter === 'FAILED'
                  ? 'bg-red-500 text-white shadow-lg shadow-red-500/20'
                  : 'bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Gagal ({failedCount})</span>
            </button>
            <button
              onClick={() => setFilter('RESOLVED')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                filter === 'RESOLVED'
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Resolved ({resolvedItems.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {filter === 'RESOLVED' && resolvedItems.length > 0 && (
              <button
                onClick={clearAllResolved}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl text-red-300 text-xs font-medium transition-all"
                title="Hapus semua resolved"
              >
                <X className="w-3.5 h-3.5" />
                <span>Clear Resolved</span>
              </button>
            )}
            <button
              onClick={handleCopyLog}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-zinc-300 text-xs font-medium transition-all"
              title="Salin JSON Diagnostik"
            >
              <Copy className="w-3.5 h-3.5 text-blue-400" />
              <span>Salin Log</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <RefreshCw className="w-8 h-8 text-purple-400 animate-spin mb-3" />
              <p className="text-xs text-zinc-400">Memuat rincian diagnostik...</p>
            </div>
          ) : filteredDiagnostics.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-white/10 rounded-2xl bg-white/[0.01]">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
              <h4 className="text-sm font-semibold text-white">Tidak Ada Catatan Diagnostik</h4>
              <p className="text-xs text-zinc-400 mt-1">
                {filter === 'PENDING'
                  ? 'Tidak ada antrean atau tindakan yang sedang pending.'
                  : filter === 'PROCESSING'
                  ? 'Tidak ada operasi sinkronisasi yang sedang berjalan.'
                  : filter === 'FAILED'
                  ? 'Tidak ada kegagalan aktif pada sistem saat ini.'
                  : filter === 'RESOLVED'
                  ? 'Belum ada log yang ditandai selesai.'
                  : 'Sistem dan antrean sinkronisasi berjalan normal.'}
              </p>
            </div>
          ) : (
            filteredDiagnostics.map((item) => {
              const isResolved = resolvedIds.has(item.id);
              const isFailedFatal = item.status === 'FAILED_FATAL';
              const isFailedRetryable = item.status === 'FAILED_RETRYABLE';
              const isProcessing = item.status === 'PROCESSING';
              const isPending = item.status === 'PENDING';

              const cardClass = isResolved
                ? 'bg-zinc-500/5 border-zinc-500/20'
                : isFailedFatal
                ? 'bg-red-500/5 border-red-500/20 hover:border-red-500/40'
                : isFailedRetryable
                ? 'bg-orange-500/5 border-orange-500/20 hover:border-orange-500/40'
                : isProcessing
                ? 'bg-blue-500/5 border-blue-500/20 hover:border-blue-500/40'
                : isPending
                ? 'bg-amber-500/5 border-amber-500/20 hover:border-amber-500/40'
                : 'bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40';

              const badgeText = isResolved
                ? 'RESOLVED'
                : isFailedFatal
                ? 'GAGAL FATAL'
                : isFailedRetryable
                ? 'RETRYING'
                : isProcessing
                ? 'DIPROSES'
                : isPending
                ? 'PENDING'
                : 'BERHASIL';

              const badgeClass = isResolved
                ? 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30'
                : isFailedFatal
                ? 'bg-red-500/20 text-red-300 border-red-500/30'
                : isFailedRetryable
                ? 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                : isProcessing
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/30 animate-pulse'
                : isPending
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl border transition-all ${cardClass}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-bold text-white text-sm">{item.feature}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border ${badgeClass}`}>
                          {badgeText}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-zinc-400 border border-white/10">
                          {item.category}
                        </span>
                      </div>

                    <p className="text-xs text-zinc-300 font-medium mb-1.5">{item.message}</p>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
                      <span>Waktu: <strong className="text-zinc-300">{item.timestamp}</strong></span>
                      <span>Source: <strong className="text-zinc-300">{item.source}</strong></span>
                      <span>Platform: <strong className="text-zinc-300">{item.platform}</strong></span>
                      {item.retryCount > 0 && (
                        <span>Retry Count: <strong className="text-amber-400">{item.retryCount}</strong></span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleDeleteQueueItem(item.id)}
                      className="px-2 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-xs font-semibold text-red-300 hover:text-red-200 transition-colors"
                      title="Hapus / Buang dari antrean"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    {!resolvedIds.has(item.id) && (
                      <button
                        onClick={() => markAsResolved(item.id)}
                        className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition-colors"
                        title="Tandai sebagai resolved"
                      >
                        ✓
                      </button>
                    )}
                    {item.detail && (
                      <button
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                        className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-purple-300 hover:text-white transition-colors"
                      >
                        {expandedId === item.id ? 'Sembunyikan' : 'Rincian'}
                      </button>
                    )}
                  </div>
                </div>

                {expandedId === item.id && item.detail && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">JSON Payload / Technical Detail:</div>
                    <pre className="p-3 bg-black/60 rounded-xl text-[11px] font-mono text-purple-200 overflow-x-auto border border-white/5 max-h-48 hide-scrollbar">
                      {item.detail}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-purple-500/20 active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Menjalankan Sync...' : 'Jalankan Sync (Retry)'}</span>
            </button>

            <button
              onClick={handleRepairDatabase}
              disabled={isRepairing}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              <Wrench className="w-4 h-4 text-amber-400" />
              <span>{isRepairing ? 'Memperbaiki...' : 'Perbaiki Database'}</span>
            </button>

            {failedCount > 0 && (
              <button
                onClick={handlePurgeAllFailed}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl text-xs font-bold transition-all active:scale-95"
                title="Bersihkan semua antrean yang gagal"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Bersihkan Gagal ({failedCount})</span>
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all"
          >
            Tutup
          </button>
        </div>

      </div>
    </div>
  );
}
