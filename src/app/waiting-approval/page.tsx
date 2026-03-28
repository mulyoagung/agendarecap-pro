import { ShieldAlert, LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";

export default function WaitingApprovalPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#09090b] text-white p-4 relative overflow-hidden">
      {/* Background Ornaments */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-amber-500/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-orange-500/20 rounded-full blur-[140px] pointer-events-none" />

      <div className="bg-[#121214]/80 backdrop-blur-xl border border-white/10 rounded-[2rem] p-8 max-w-md w-full text-center shadow-2xl relative z-10 flex flex-col items-center gap-6">
        <div className="w-20 h-20 bg-amber-500/10 border border-amber-500/20 rounded-full flex items-center justify-center mx-auto relative">
          <div className="absolute inset-0 bg-amber-500/20 rounded-full animate-ping opacity-75" />
          <ShieldAlert className="w-10 h-10 text-amber-500 relative z-10" />
        </div>
        
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent mb-3">
            Persetujuan Dibutuhkan
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Akun Anda sedang menunggu persetujuan admin. Anda tidak dapat mengakses fitur aplikasi sebelum akun berstatus Approved.
          </p>
        </div>

        <form action={logout} className="w-full mt-2">
          <button 
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all text-zinc-300 hover:text-white font-medium hover:scale-[1.02] active:scale-95"
          >
            <LogOut className="w-4 h-4" /> Keluar dari Akun
          </button>
        </form>
      </div>
    </main>
  );
}
