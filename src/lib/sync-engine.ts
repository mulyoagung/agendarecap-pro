// Offline Sync Engine for Agendaku PWA & Native Android
// Reconciles local IndexedDB offline queue with Supabase server via Direct Client SDK & Union Merge Strategy
// Also reconciles Android Native AlarmManager state with active occurrences

import { syncRepository } from '@/lib/repositories/sync-repository';
import { createClient } from '@/lib/supabase/client';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';

let isListenersInitialized = false;

export async function runSyncEngine(): Promise<{ success: boolean; syncedCount: number; errors: string[] }> {
  const result = await syncRepository.runSync();
  
  if (typeof window !== 'undefined') {
    try {
      // Reload Zustand stores from updated IndexedDB after sync
      const { useStore } = await import('@/store/useStore');
      const { useReminderStore } = await import('@/store/useReminderStore');
      const { agendaRepository } = await import('@/lib/repositories/agenda-repository');
      
      const localAgendas = await agendaRepository.getLocal();
      useStore.setState({ agendas: localAgendas as any[] });
      
      await useReminderStore.getState().fetchReminders();
    } catch (err) {
      console.warn('[SYNC ENGINE] Post-sync store reload notice:', err);
    }
  }

  return result;
}

export function initSyncEngineListeners() {
  if (typeof window === 'undefined' || isListenersInitialized) return;
  isListenersInitialized = true;

  console.log('[SYNC ENGINE] Initializing global listeners (Auth, Online, NetworkStatus, Visibility, App State)');
  const supabase = createClient();

  // Debounced sync runner to prevent redundant concurrent sync calls
  let syncTimeout: NodeJS.Timeout | null = null;
  const triggerDebouncedSync = (reason: string) => {
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      console.log(`[SYNC ENGINE] Triggering debounced sync (${reason})`);
      runSyncEngine().catch((err) => console.warn(`[SYNC ENGINE] Sync notice (${reason}):`, err));
    }, 500);
  };

  // 1. Supabase Auth State Change Listener
  supabase.auth.onAuthStateChange(async (event: string, session: any) => {
    console.log(`[AUTH] Auth state changed: ${event} | user_id=${session?.user?.id || 'none'}`);

    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      if (session?.user?.id && navigator.onLine) {
        triggerDebouncedSync('Auth State');
      }
    }
  });

  // 2. Network Online Listener (HTML5 Browser Event)
  const handleOnline = () => {
    console.log('[SYNC] HTML5 Online event detected -> Triggering Sync Engine');
    triggerDebouncedSync('HTML5 Online');
  };

  // 3. Document Visibility Listener (Tab Focus)
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      triggerDebouncedSync('Visibility Change');
    }
  };

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // 4. Capacitor Android Native Network Status Listener
  if (Capacitor.isNativePlatform()) {
    Network.addListener('networkStatusChange', (status) => {
      console.log(`[CAPACITOR NETWORK] Status change: connected=${status.connected}, connectionType=${status.connectionType}`);
      if (status.connected) {
        triggerDebouncedSync('Capacitor Network Reconnected');
      }
    }).catch((err) => {
      console.warn('[CAPACITOR NETWORK LISTENER] Error adding networkStatusChange listener:', err);
    });

    // 5. Capacitor Android Native App Resume Listener
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && navigator.onLine) {
        console.log('[SYNC ENGINE] Capacitor App resumed (isActive=true) -> Triggering Sync Engine');
        triggerDebouncedSync('App Resume');
      }
    }).catch((err) => {
      console.warn('[CAPACITOR APP LISTENER] Error adding appStateChange listener:', err);
    });
  }

  // 6. Immediate Startup Sync
  if (navigator.onLine) {
    triggerDebouncedSync('Startup');
  }
}
