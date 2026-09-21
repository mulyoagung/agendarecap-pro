/**
 * Sanitizer & Normalizer for Supabase Database Persistence
 * Ensures no UI-only helper attributes (like `scheduledDate`, `currentOccurrence`, `displayTime`)
 * are sent to Supabase table queries, preventing "unknown column" SQL errors during sync.
 */

export interface SupabaseAgendaPayload {
  id?: string;
  user_id?: string;
  title?: string;
  location?: string;
  scheduled_at?: string;
  notes?: string;
  include_notes_in_share?: boolean;
  is_completed?: boolean;
  status?: string;
  privateNotes?: string;
  isShareable?: boolean;
  groupId?: string;
  isOnline?: boolean;
  onlineLink?: string;
  meetingId?: string;
  meetingPasscode?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseReminderPayload {
  id?: string;
  user_id?: string;
  title?: string;
  body?: string;
  time?: string;
  timezone?: string;
  frequency?: string;
  days_of_week?: number[] | null;
  sound?: string;
  is_active?: boolean;
  delivery_mode?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseOccurrencePayload {
  id?: string;
  reminder_id?: string;
  scheduled_at?: string;
  status?: string;
  snoozed_until?: string | null;
  sent_at?: string | null;
  completed_at?: string | null;
  dismissed_at?: string | null;
  notification_tag?: string;
  created_at?: string;
  updated_at?: string;
}

export function sanitizeAgendaForSupabase(input: any): SupabaseAgendaPayload {
  if (!input || typeof input !== 'object') return {};

  const sanitized: SupabaseAgendaPayload = {};

  if (input.id !== undefined) sanitized.id = input.id;
  if (input.user_id !== undefined) sanitized.user_id = input.user_id;
  if (input.title !== undefined) sanitized.title = input.title;
  if (input.location !== undefined) sanitized.location = input.location;
  if (input.scheduled_at !== undefined) sanitized.scheduled_at = input.scheduled_at;
  if (input.notes !== undefined) sanitized.notes = input.notes;
  if (input.include_notes_in_share !== undefined) sanitized.include_notes_in_share = input.include_notes_in_share;
  if (input.is_completed !== undefined) sanitized.is_completed = input.is_completed;
  if (input.status !== undefined) sanitized.status = input.status;
  if (input.privateNotes !== undefined) sanitized.privateNotes = input.privateNotes;
  if (input.isShareable !== undefined) sanitized.isShareable = input.isShareable;
  if (input.groupId !== undefined) sanitized.groupId = input.groupId;
  if (input.isOnline !== undefined) sanitized.isOnline = input.isOnline;
  if (input.onlineLink !== undefined) sanitized.onlineLink = input.onlineLink;
  if (input.meetingId !== undefined) sanitized.meetingId = input.meetingId;
  if (input.meetingPasscode !== undefined) sanitized.meetingPasscode = input.meetingPasscode;
  if (input.created_at !== undefined) sanitized.created_at = input.created_at;
  if (input.updated_at !== undefined) sanitized.updated_at = input.updated_at;

  return sanitized;
}

export function sanitizeReminderForSupabase(input: any): SupabaseReminderPayload {
  if (!input || typeof input !== 'object') return {};

  const sanitized: SupabaseReminderPayload = {};

  if (input.id !== undefined) sanitized.id = input.id;
  if (input.user_id !== undefined || input.userId !== undefined) {
    sanitized.user_id = input.user_id || input.userId;
  }
  if (input.title !== undefined) sanitized.title = input.title;
  if (input.body !== undefined) sanitized.body = input.body;
  if (input.time !== undefined) sanitized.time = input.time;
  if (input.timezone !== undefined) sanitized.timezone = input.timezone;
  if (input.frequency !== undefined) sanitized.frequency = input.frequency;

  if (input.days_of_week !== undefined) sanitized.days_of_week = input.days_of_week;
  else if (input.daysOfWeek !== undefined) sanitized.days_of_week = input.daysOfWeek;

  if (input.sound !== undefined) sanitized.sound = input.sound;

  if (input.is_active !== undefined) sanitized.is_active = input.is_active;
  else if (input.isActive !== undefined) sanitized.is_active = input.isActive;

  if (input.delivery_mode !== undefined) sanitized.delivery_mode = input.delivery_mode;
  else if (input.deliveryMode !== undefined) sanitized.delivery_mode = input.deliveryMode;

  if (input.created_at !== undefined) sanitized.created_at = input.created_at;
  else if (input.createdAt !== undefined) sanitized.created_at = input.createdAt;

  if (input.updated_at !== undefined) sanitized.updated_at = input.updated_at;
  else if (input.updatedAt !== undefined) sanitized.updated_at = input.updatedAt;

  return sanitized;
}

export function sanitizeOccurrenceForSupabase(input: any): SupabaseOccurrencePayload {
  if (!input || typeof input !== 'object') return {};

  const sanitized: SupabaseOccurrencePayload = {};

  if (input.id !== undefined) sanitized.id = input.id;

  if (input.reminder_id !== undefined) sanitized.reminder_id = input.reminder_id;
  else if (input.reminderId !== undefined) sanitized.reminder_id = input.reminderId;

  if (input.scheduled_at !== undefined) sanitized.scheduled_at = input.scheduled_at;
  else if (input.scheduledAt !== undefined) sanitized.scheduled_at = input.scheduledAt;

  if (input.status !== undefined) sanitized.status = input.status;

  if (input.snoozed_until !== undefined) sanitized.snoozed_until = input.snoozed_until;
  else if (input.snoozedUntil !== undefined) sanitized.snoozed_until = input.snoozedUntil;

  if (input.sent_at !== undefined) sanitized.sent_at = input.sent_at;
  else if (input.sentAt !== undefined) sanitized.sent_at = input.sentAt;

  if (input.completed_at !== undefined) sanitized.completed_at = input.completed_at;
  else if (input.completedAt !== undefined) sanitized.completed_at = input.completedAt;

  if (input.dismissed_at !== undefined) sanitized.dismissed_at = input.dismissed_at;
  else if (input.dismissedAt !== undefined) sanitized.dismissed_at = input.dismissedAt;

  if (input.notification_tag !== undefined) sanitized.notification_tag = input.notification_tag;
  else if (input.notificationTag !== undefined) sanitized.notification_tag = input.notificationTag;

  if (input.created_at !== undefined) sanitized.created_at = input.created_at;
  else if (input.createdAt !== undefined) sanitized.created_at = input.createdAt;

  if (input.updated_at !== undefined) sanitized.updated_at = input.updated_at;
  else if (input.updatedAt !== undefined) sanitized.updated_at = input.updatedAt;

  return sanitized;
}

export function mapAgendaFromSupabase(r: any): any {
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title || '',
    location: r.location || '',
    notes: r.notes || '',
    scheduled_at: r.scheduled_at,
    privateNotes: r.privateNotes || '',
    is_completed: Boolean(r.is_completed),
    include_notes_in_share: Boolean(r.include_notes_in_share),
    status: r.status || 'confirmed',
    isShareable: r.isShareable !== undefined ? Boolean(r.isShareable) : true,
    groupId: r.groupId || undefined,
    isOnline: Boolean(r.isOnline),
    onlineLink: r.onlineLink || '',
    meetingId: r.meetingId || '',
    meetingPasscode: r.meetingPasscode || '',
    isUrgent: Boolean(r.isUrgent),
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}

export function mapAgendaToSupabase(agenda: any): SupabaseAgendaPayload {
  return sanitizeAgendaForSupabase(agenda);
}

