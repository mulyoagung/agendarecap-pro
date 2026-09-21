"use client";

import { useEffect, useState, createContext, useContext, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { CalendarHeart, RefreshCw } from "lucide-react";

import { isNativePlatform, navigateNative } from "@/lib/native-alarm";

export type AuthState = 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

export type AuthContextType = {
  session: Session | null;
  user: User | null;
  authLoading: boolean;
  authState: AuthState;
  isOnline: boolean;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
  lastSyncAt: string | null;
  lastSyncError: string | null;
  pendingQueueCount: number;
  failedQueueCount: number;
  lastAuthEvent: string;
  refreshAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  authLoading: true,
  authState: 'INITIALIZING',
  isOnline: true,
  syncStatus: 'idle',
  lastSyncAt: null,
  lastSyncError: null,
  pendingQueueCount: 0,
  failedQueueCount: 0,
  lastAuthEvent: 'NONE',
  refreshAuth: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const PUBLIC_ROUTES = ['/login', '/login.html', '/waiting-approval', '/waiting-approval.html'];

function checkIsPublicRoute(currentPath: string): boolean {
  if (!currentPath) return false;
  return PUBLIC_ROUTES.some(r => currentPath === r || currentPath.endsWith(r));
}

export default function ClientAuthGuard({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>('INITIALIZING');
  const [isOnline, setIsOnline] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [failedQueueCount, setFailedQueueCount] = useState(0);
  const [lastAuthEvent, setLastAuthEvent] = useState('INITIALIZING');

  const pathname = usePathname();
  const router = useRouter();

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : (pathname || '');
  const isPublicRoute = checkIsPublicRoute(currentPath) || checkIsPublicRoute(pathname || '');

  // Helper to fetch IDB offline queue stats
  const refreshQueueStats = useCallback(async () => {
    try {
      const { getOfflineQueueDebugInfo } = await import("@/lib/idb");
      const qInfo = await getOfflineQueueDebugInfo();
      setPendingQueueCount(qInfo.pending);
      setFailedQueueCount(qInfo.failedRetryable + qInfo.failedFatal);
    } catch (_) { /* IDB not available yet */ }
  }, []);

  const refreshAuth = useCallback(async () => {
    if (typeof window === 'undefined') return;

    try {
      const supabase = createClient();
      const { data: { session: currentSession } } = await supabase.auth.getSession();

      console.log('[AUTH GUARD] Manual auth refresh:', {
        sessionExists: !!currentSession,
        userId: currentSession?.user?.id || 'none'
      });

      setSession(currentSession);
      setUser(currentSession?.user || null);

      if (currentSession) {
        setAuthState('AUTHENTICATED');
      } else {
        setAuthState('UNAUTHENTICATED');
      }

      await refreshQueueStats();
    } catch (e: any) {
      console.warn('[AUTH GUARD] Manual refresh notice:', e);
      setAuthState('UNAUTHENTICATED');
    }
  }, [refreshQueueStats]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsOnline(navigator.onLine);
    const isNative = isNativePlatform();

    console.log('[AUTH GUARD] Component mounted, state machine initialized as INITIALIZING', {
      href: window.location.href,
      pathname: window.location.pathname,
      isNative,
      isPublicRoute
    });

    const supabase = createClient();

    // 1. Subscribe to Auth State Changes FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: string, newSession: Session | null) => {
      console.log(`[AUTH GUARD] Auth Event: ${event}, Session Exists: ${!!newSession}`);
      setLastAuthEvent(event);
      setSession(newSession);
      setUser(newSession?.user || null);

      if (event === 'INITIAL_SESSION') {
        if (newSession) {
          console.log('[AUTH GUARD] INITIAL_SESSION resolved -> AUTHENTICATED');
          setAuthState('AUTHENTICATED');
        } else {
          console.log('[AUTH GUARD] INITIAL_SESSION resolved -> UNAUTHENTICATED');
          setAuthState('UNAUTHENTICATED');
        }
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        console.log(`[AUTH GUARD] Event ${event} -> AUTHENTICATED`);
        setAuthState('AUTHENTICATED');
      } else if (event === 'SIGNED_OUT') {
        console.log('[AUTH GUARD] SIGNED_OUT -> UNAUTHENTICATED');
        setAuthState('UNAUTHENTICATED');
        try {
          const { useStore } = await import("@/store/useStore");
          useStore.setState({ agendas: [], sharedDates: {} });
        } catch (_) {}
      } else if (newSession) {
        setAuthState('AUTHENTICATED');
      }
    });

    // 2. Hydrate session asynchronously
    const hydrateSession = async () => {
      try {
        const { data: { session: initialSession } } = await supabase.auth.getSession();
        setSession(initialSession);
        setUser(initialSession?.user || null);

        if (initialSession) {
          console.log('[AUTH GUARD] getSession found session -> AUTHENTICATED');
          setAuthState('AUTHENTICATED');
        } else {
          // If getSession returned null, transition from INITIALIZING to UNAUTHENTICATED
          console.log('[AUTH GUARD] getSession null -> Transitioning from INITIALIZING to UNAUTHENTICATED');
          setAuthState(prev => (prev === 'INITIALIZING' ? 'UNAUTHENTICATED' : prev));
        }

        await refreshQueueStats();
      } catch (err) {
        console.warn('[AUTH GUARD] Hydration exception:', err);
        setAuthState('UNAUTHENTICATED');
      }
    };

    hydrateSession();

    // Network Online / Offline Listeners
    const handleOnline = () => {
      setIsOnline(true);
      import("@/lib/sync-engine").then(({ runSyncEngine }) => {
        runSyncEngine().then(() => refreshQueueStats()).catch(err => console.warn('[AUTH GUARD] Online sync notice:', err));
      });
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshQueueStats]);

  // Route Protection & Navigation State Machine Effect
  useEffect(() => {
    // RULE A: While state is INITIALIZING, DO NOT redirect anywhere!
    if (authState === 'INITIALIZING') {
      console.log('[AUTH GUARD] State is INITIALIZING -> Holding current route in loading state.');
      return;
    }

    const isNative = isNativePlatform();
    const curPath = typeof window !== 'undefined' ? window.location.pathname : (pathname || '');
    const onPublic = checkIsPublicRoute(curPath) || checkIsPublicRoute(pathname || '');

    // RULE B: Protected route handling when strictly UNAUTHENTICATED
    if (authState === 'UNAUTHENTICATED' && !onPublic) {
      console.warn(`[AUTH GUARD] Auth state UNAUTHENTICATED on protected route "${curPath}" -> Navigating to login`);
      if (isNative) {
        navigateNative('login.html', true);
      } else {
        router.replace('/login');
      }
    } 
    // RULE C: Public login route handling when strictly AUTHENTICATED
    else if (authState === 'AUTHENTICATED' && onPublic && (curPath === '/login' || curPath.endsWith('/login.html') || pathname === '/login')) {
      console.log(`[AUTH GUARD] Auth state AUTHENTICATED on public login route "${curPath}" -> Navigating to index`);
      if (isNative) {
        navigateNative('index.html', true);
      } else {
        router.replace('/');
      }
    }
  }, [authState, pathname, router]);

  const authLoading = authState === 'INITIALIZING';

  // Render Loading Screen while state machine is INITIALIZING
  if (authState === 'INITIALIZING') {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-500/20 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-500/20 rounded-full blur-[140px] pointer-events-none" />
        
        <div className="glass p-8 rounded-[2rem] border border-white/10 flex flex-col items-center gap-4 text-center z-10 max-w-sm shadow-2xl">
          <div className="p-3 bg-gradient-to-tr from-purple-500 to-indigo-500 rounded-2xl shadow-lg shadow-purple-500/20 animate-pulse">
            <CalendarHeart className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-1">AgendaRecap Pro</h2>
            <p className="text-xs text-zinc-400 font-medium">Memverifikasi Sesi Otentikasi...</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-purple-400 font-semibold bg-purple-500/10 px-4 py-2 rounded-xl border border-purple-500/20">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Memuat data lokal...</span>
          </div>
        </div>
      </div>
    );
  }

  // Render Transition Screen if UNAUTHENTICATED on protected route while navigateNative/router.replace resolves
  if (authState === 'UNAUTHENTICATED' && !isPublicRoute) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex flex-col items-center justify-center p-4">
        <div className="glass p-6 rounded-[2rem] border border-white/10 flex flex-col items-center gap-3 text-center">
          <p className="text-xs text-zinc-400 font-medium">Mengarahkan ke Halaman Login...</p>
        </div>
      </div>
    );
  }

  const contextValue: AuthContextType = {
    session,
    user,
    authLoading,
    authState,
    isOnline,
    syncStatus,
    lastSyncAt,
    lastSyncError,
    pendingQueueCount,
    failedQueueCount,
    lastAuthEvent,
    refreshAuth
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
