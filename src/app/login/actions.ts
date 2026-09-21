import { createClient } from "@/lib/supabase/client"
import { isNativePlatform } from "@/lib/native-alarm"

export async function login(formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string

  const supabase = createClient()

  console.log('[AUTH] Logging in with email:', email)

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error('[AUTH] signInWithPassword error:', error.message)
    return error.message
  }

  // Verify session is active in browser storage
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    console.error('[AUTH] Sesi tidak ditemukan setelah login')
    return "Sesi otentikasi tidak ditemukan. Silakan coba lagi."
  }

  console.log('[AUTH] Session confirmed for user:', session.user.id)

  const { data: profile } = await supabase.from('profiles').select('status').eq('id', session.user.id).single()
  if (profile?.status === 'pending') {
    if (typeof window !== 'undefined') {
      if (isNativePlatform()) {
        window.location.href = "/waiting-approval.html"
      } else {
        window.location.href = "/waiting-approval"
      }
    }
    return null
  }

  if (typeof window !== 'undefined') {
    if (isNativePlatform()) {
      window.location.href = "/index.html"
    } else {
      window.location.href = "/"
    }
  }
  return null
}

export async function signup(formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const supabase = createClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    return error.message
  }
  
  // New users are pending by default
  if (typeof window !== 'undefined') {
    if (isNativePlatform()) {
      window.location.href = "/waiting-approval.html"
    } else {
      window.location.href = "/waiting-approval"
    }
  }
  return null
}

export async function logout() {
  const supabase = createClient()
  await supabase.auth.signOut()
  if (typeof window !== 'undefined') {
    if (isNativePlatform()) {
      window.location.href = "/login.html"
    } else {
      window.location.href = "/login"
    }
  }
}
