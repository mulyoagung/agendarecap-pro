"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export async function login(formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  // Dummy Login Fallback if Supabase is not configured yet
  if (email === "admin@agendaku.com" && password === "admin123") {
    const { cookies } = await import("next/headers");
    (await cookies()).set("dummy_auth", "true");
    redirect("/");
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return error.message
  }
  
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('status').eq('id', user.id).single()
    if (profile?.status === 'pending') {
      redirect("/waiting-approval")
    }
  }

  redirect("/")
}

export async function signup(formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    return error.message
  }
  
  // New users are pending by default
  redirect("/waiting-approval")
}

export async function logout() {
  const { cookies } = await import("next/headers");
  (await cookies()).delete("dummy_auth");

  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
