"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { login, signup } from "./actions"
import { CalendarHeart, Mail, Lock } from "lucide-react"

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>, action: 'login' | 'signup') => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    
    const formData = new FormData(e.currentTarget)
    
    const err = action === 'login' 
      ? await login(formData)
      : await signup(formData)
      
    if (err) {
      setError(err)
      setIsLoading(false)
    }
  }

  return (
    <main className="min-h-screen relative p-4 flex flex-col items-center justify-center overflow-hidden bg-background">
      {/* Background Ornaments */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-500/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-500/20 rounded-full blur-[140px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, type: 'spring' }}
        className="w-full max-w-sm glass p-8 rounded-[2rem] shadow-2xl relative z-10 border border-white/10"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-gradient-to-tr from-purple-500 to-indigo-500 rounded-2xl shadow-lg shadow-purple-500/20 mb-4 inline-flex">
            <CalendarHeart className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">AgendaRecap Pro</h1>
          <p className="text-zinc-400 text-sm text-center">Masuk untuk melihat agenda Anda yang tersinkronisasi dan aman.</p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-6 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl text-center"
          >
            {error}
          </motion.div>
        )}

        <form className="space-y-4" onSubmit={(e) => handleSubmit(e, 'login')}>
          <div className="space-y-4">
            <div className="relative">
              <Mail className="w-5 h-5 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input 
                id="email" 
                name="email" 
                type="email" 
                required 
                placeholder="Email address"
                className="w-full bg-[#121214]/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
              />
            </div>
            
            <div className="relative">
              <Lock className="w-5 h-5 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input 
                id="password" 
                name="password" 
                type="password" 
                required 
                placeholder="Password"
                className="w-full bg-[#121214]/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
              />
            </div>
          </div>

          <div className="pt-4 space-y-3">
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full py-3.5 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white font-semibold rounded-xl shadow-lg shadow-purple-500/25 transition-all outline-none focus:ring-2 focus:ring-purple-500/50 active:scale-[0.98] disabled:opacity-50"
            >
              {isLoading ? "Memproses..." : "Masuk"}
            </button>
            <button 
              type="button"
              disabled={isLoading}
              onClick={(e) => {
                const form = e.currentTarget.form
                if (form) handleSubmit({ currentTarget: form, preventDefault: () => {} } as any, 'signup')
              }}
              className="w-full py-3.5 bg-white/5 hover:bg-white/10 text-white font-medium rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
            >
              Daftar Akun Baru
            </button>
          </div>
        </form>
      </motion.div>
      
      <p className="mt-8 text-xs text-zinc-500 text-center relative z-10 max-w-xs">
        Pastikan Anda sudah mengonfigurasi URL Supabase dan Anon Key Anda di `.env.local`
      </p>
    </main>
  )
}
