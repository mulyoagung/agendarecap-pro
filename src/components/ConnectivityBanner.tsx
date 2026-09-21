"use client";

import { useAuth } from "@/components/ClientAuthGuard";
import { useState, useEffect } from "react";
import { Wifi, WifiOff, UserCheck, RefreshCw, CheckCircle2, AlertTriangle, Database } from "lucide-react";
import { runSyncEngine } from "@/lib/sync-engine";

export default function ConnectivityBanner() {
  const { user, isOnline, pendingQueueCount, failedQueueCount } = useAuth();
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);
  const [isSupabaseReachable, setIsSupabaseReachable] = useState<boolean | null>(null);

  const checkSupabaseReachability = async () => {
    if (!isOnline) {
      setIsSupabaseReachable(false);
      return;
    }
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { error } = await supabase.from('agendas').select('id', { head: true, count: 'exact' }).limit(1);
      setIsSupabaseReachable(!error);
    } catch {
      setIsSupabaseReachable(false);
    }
  };

  const handleManualTriggerSync = async () => {
    if (!isOnline) return;
    setSyncState('syncing');
    setSyncErrorMsg(null);
    try {
      const res = await runSyncEngine();
      if (res.success) {
        setSyncState('success');
        setIsSupabaseReachable(true);
        setLastSyncTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }));
      } else {
        setSyncState('error');
        setSyncErrorMsg(res.errors[0] || 'Sync failed');
      }
    } catch (e: any) {
      setSyncState('error');
      setSyncErrorMsg(e.message);
    }
  };

  useEffect(() => {
    checkSupabaseReachability();
    if (isOnline) {
      setLastSyncTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }));
    }
  }, [isOnline]);

  const shortUserId = user?.id ? `${user.id.substring(0, 6)}...` : null;

  return (
    <div className="w-full bg-[#121215]/80 backdrop-blur-md border-b border-white/5 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 shadow-inner">
      {/* 1. Network & Supabase Status */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
          {isOnline ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-bold text-emerald-400">Network: Online</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
              <span className="font-bold text-red-400">Network: Offline</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
          {isSupabaseReachable === true ? (
            <span className="font-bold text-emerald-400">Supabase: Connected</span>
          ) : isSupabaseReachable === false && isOnline ? (
            <span className="font-bold text-amber-400">Supabase: Unreachable</span>
          ) : (
            <span className="font-bold text-zinc-500">Supabase: Offline</span>
          )}
        </div>

        {/* 2. Auth Status */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
          <UserCheck className="w-3.5 h-3.5 text-purple-400" />
          {user ? (
            <span className="font-medium text-zinc-300">
              Auth: <span className="font-mono text-purple-300 font-bold">{shortUserId}</span>
            </span>
          ) : (
            <span className="font-bold text-amber-400">Auth: Belum Login</span>
          )}
        </div>
      </div>

      {/* 3. Sync Status & Controls */}
      <div className="flex items-center gap-2">
        {pendingQueueCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/30">
            <Database className="w-3 h-3" />
            <span>Pending: {pendingQueueCount}</span>
          </div>
        )}

        {failedQueueCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold text-[10px] border border-red-500/30">
            <AlertTriangle className="w-3 h-3" />
            <span>Gagal: {failedQueueCount}</span>
          </div>
        )}

        <button
          onClick={handleManualTriggerSync}
          disabled={syncState === 'syncing' || !isOnline}
          className="flex items-center gap-1.5 px-3 py-1 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-full text-purple-300 hover:text-purple-200 font-semibold transition-all active:scale-95 disabled:opacity-50"
          title={syncErrorMsg || "Jalankan Sinkronisasi Supabase"}
        >
          {syncState === 'syncing' ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="text-amber-400">Syncing...</span>
            </>
          ) : syncState === 'error' ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400">{syncErrorMsg ? (syncErrorMsg.length > 25 ? `${syncErrorMsg.substring(0, 25)}...` : syncErrorMsg) : 'Sync Gagal'}</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{lastSyncTime ? `Synced (${lastSyncTime})` : 'Sync Ready'}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
