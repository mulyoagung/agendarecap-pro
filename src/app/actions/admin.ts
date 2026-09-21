'use server';

import { createClient } from '@supabase/supabase-js';
import { createClient as createServerSupabase } from "@/lib/supabase/server";

// We need a service role client to bypass RLS and manage users
function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
  }

  if (!supabaseServiceKey) {
    console.warn("[WARNING] SUPABASE_SERVICE_ROLE_KEY is missing on server environment! Admin API operations will fail.");
    throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is required for Admin operations");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

// Verify if the caller is an admin using Service Role to bypass any RLS issues
async function checkIsAdmin(): Promise<{ isAdmin: boolean, reason?: string }> {
  try {
    const serverSupabase = await createServerSupabase();
    const { data: { user }, error: authError } = await serverSupabase.auth.getUser();

    if (authError || !user) {
      return { isAdmin: false, reason: "No active authenticated session: " + (authError?.message || 'Unauthenticated') };
    }

    let supabaseAdmin;
    try {
      supabaseAdmin = getAdminClient();
    } catch (e: any) {
      return { isAdmin: false, reason: "Admin Client Error: " + e.message };
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (error) {
      return { isAdmin: false, reason: "Failed finding user profile: " + error.message };
    }

    const allowedRoles = ['admin', 'super_admin', 'superadmin'];
    const userRole = profile?.role ? String(profile.role).toLowerCase() : '';

    if (!userRole || !allowedRoles.includes(userRole)) {
      return { isAdmin: false, reason: "Role not authorized: " + (profile?.role || 'null') };
    }

    return { isAdmin: true };
  } catch (err: any) {
    return { isAdmin: false, reason: "Unexpected catch error: " + err.message };
  }
}

export async function deleteUser(userId: string) {
  const { isAdmin, reason } = await checkIsAdmin();
  if (!isAdmin) {
    return { success: false, error: "Unauthorized. Admin only. Reason: " + reason };
  }

  const supabaseAdmin = getAdminClient();
  
  const { data, error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  
  if (error) {
    console.error("Error deleting user:", error);
    return { success: false, error: error.message };
  }
  
  return { success: true, data };
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const { isAdmin, reason } = await checkIsAdmin();
  if (!isAdmin) {
    return { success: false, error: "Unauthorized. Admin only. Reason: " + reason };
  }

  const supabaseAdmin = getAdminClient();
  
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { password: newPassword }
  );

  if (error) {
    console.error("Error resetting password:", error);
    return { success: false, error: error.message };
  }
  
  return { success: true, data };
}

export async function approveUser(userId: string) {
  const { isAdmin, reason } = await checkIsAdmin();
  if (!isAdmin) {
    return { success: false, error: "Unauthorized. Admin only. Reason: " + reason };
  }

  const supabaseAdmin = getAdminClient();
  
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ status: 'approved' })
    .eq('id', userId);

  if (error) {
    console.error("Error approving user:", error);
    return { success: false, error: error.message };
  }
  
  return { success: true, data };
}

export async function getUsers() {
  const { isAdmin, reason } = await checkIsAdmin();
  if (!isAdmin) {
    return { success: false, error: "Unauthorized. Admin only. Reason: " + reason, data: [] };
  }

  const supabaseAdmin = getAdminClient();
  
  // Fetch profiles which holds role and status
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*');

  if (error) {
    console.error("Error fetching users:", error);
    return { success: false, error: error.message, data: [] };
  }
  
  return { success: true, data };
}
