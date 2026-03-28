"use client";

import { motion } from "framer-motion";
import { Users, Shield, Trash2, RefreshCw, ChevronLeft, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useTransition } from "react";
import { getUsers, deleteUser, resetUserPassword, approveUser } from "@/app/actions/admin";
import Swal from "sweetalert2";

interface UserProfile {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const result = await getUsers();
      if (result.success && result.data) {
        setUsers(result.data as UserProfile[]);
      } else {
        await Swal.fire({ icon: 'error', title: 'Akses Ditolak', text: result.error });
        window.location.href = "/";
      }
    } catch (err: any) {
      await Swal.fire({ icon: 'error', title: 'Akses Ditolak', text: err.message });
      window.location.href = "/";
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDelete = async (id: string, email: string) => {
    const confirm = await Swal.fire({
      title: 'Hapus Pengguna?',
      text: `Anda yakin ingin menghapus akun ${email} secara permanen?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Ya, Hapus!'
    });
    
    if (!confirm.isConfirmed) return;

    startTransition(async () => {
      const res = await deleteUser(id);
      if (res.success) {
        setUsers(users.filter(u => u.id !== id));
        Swal.fire({ icon: 'success', title: 'Terhapus!', text: 'Pengguna berhasil dihapus.', timer: 1500, showConfirmButton: false });
      } else {
        Swal.fire({ icon: 'error', title: 'Gagal menghapus', text: res.error });
      }
    });
  };

  const handleReset = async (id: string, email: string) => {
    const { value: newPass } = await Swal.fire({
      title: `Reset Password`,
      text: `Masukkan password baru untuk ${email}`,
      input: 'password',
      inputPlaceholder: 'Password baru',
      showCancelButton: true,
      inputValidator: (value) => {
        if (!value) return 'Password tidak boleh kosong!'
        if (value.length < 6) return 'Password minimal 6 karakter!'
      }
    });
    
    if (!newPass) return;
    
    startTransition(async () => {
      const res = await resetUserPassword(id, newPass);
      if (res.success) {
        Swal.fire({ icon: 'success', title: 'Berhasil!', text: 'Password berhasil direset.', timer: 1500, showConfirmButton: false });
      } else {
        Swal.fire({ icon: 'error', title: 'Gagal reset password', text: res.error });
      }
    });
  };

  const handleApprove = async (id: string) => {
    startTransition(async () => {
      const res = await approveUser(id);
      if (res.success) {
        setUsers(users.map(u => u.id === id ? { ...u, status: 'approved' } : u));
        Swal.fire({ icon: 'success', title: 'Disetujui!', text: 'Pengguna berhasil di-approve.', timer: 1500, showConfirmButton: false });
      } else {
        Swal.fire({ icon: 'error', title: 'Gagal approve', text: res.error });
      }
    });
  };

  return (
    <main className="min-h-screen relative overflow-hidden bg-background p-4 sm:p-8">
      {/* Background Ornaments */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-500/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/20 rounded-full blur-[140px] pointer-events-none" />

      <div className="max-w-6xl mx-auto relative z-10">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link 
              href="/"
              className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2 text-white">
                <Shield className="w-6 h-6 text-blue-400" />
                Admin Panel
              </h1>
              <p className="text-sm text-zinc-400">Manajemen Pengguna AgendaRecap Pro</p>
            </div>
          </div>
        </header>

        <div className="glass rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-white/5 bg-white/5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-purple-400" />
              Daftar Pengguna ({users.length}) 
              {isPending && <span className="ml-2 w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            </h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-sm">
                  <th className="px-6 py-4 font-medium text-zinc-400">Email Pengguna</th>
                  <th className="px-6 py-4 font-medium text-zinc-400">Role</th>
                  <th className="px-6 py-4 font-medium text-zinc-400">Status</th>
                  <th className="px-6 py-4 font-medium text-zinc-400">Terdaftar Pada</th>
                  <th className="px-6 py-4 font-medium text-zinc-400 text-right min-w-[180px]">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-zinc-500">
                      Memuat data pengguna...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-zinc-500">
                      Belum ada pengguna terdaftar (selain Anda).
                    </td>
                  </tr>
                ) : users.map((user, index) => (
                  <motion.tr 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    key={user.id} 
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-4 text-white font-medium">{user.email}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-lg ${
                        user.role === 'admin' 
                          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' 
                          : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                      }`}>
                        {user.role.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {user.status === 'approved' ? (
                        <span className="flex w-fit items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approved
                        </span>
                      ) : (
                        <span className="flex w-fit items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <AlertCircle className="w-3.5 h-3.5" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-zinc-400 text-sm">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString('id-ID', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      }) : 'Tidak Tersedia'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {user.status !== 'approved' && user.role !== 'admin' && (
                          <button 
                            onClick={() => handleApprove(user.id)}
                            disabled={isPending}
                            className="p-2 flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-400/10 rounded-lg transition-colors border border-emerald-500/20 hover:border-emerald-400/40"
                            title="Setujui Pengguna"
                          >
                            <CheckCircle2 className="w-4 h-4" /> Approve
                          </button>
                        )}
                        <button 
                          onClick={() => handleReset(user.id, user.email)}
                          disabled={isPending}
                          className="p-2 text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors border border-transparent hover:border-blue-400/20"
                          title="Reset Password"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(user.id, user.email)}
                          disabled={isPending}
                          className="p-2 text-zinc-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-zinc-400 border border-transparent hover:border-red-400/20"
                          title="Hapus Pengguna"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
