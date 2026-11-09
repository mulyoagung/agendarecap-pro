import { format, isSameDay } from "date-fns";
import { getAgendaTimeDisplay, getAgendaTimeMode, AgendaTimeItem } from "./agenda-time";

export interface UpcomingWidgetItem {
  title: string;
  time: string;
}

export interface Agenda7DaysWidgetItem {
  title: string;
  time: string;
  date: string;
}

export interface ConsultationWidgetItem {
  title: string;
  notes: string;
  count: number;
}

export interface WidgetAgendaLike extends AgendaTimeItem {
  id: string;
  title: string;
  is_completed?: boolean;
  groupId?: string;
  notes?: string | null;
  privateNotes?: string | null;
}

/**
 * Builds payload for the daily/upcoming agenda widget.
 * Shows today's non-cancelled scheduled agendas, or up to 3 upcoming agendas within 7 days.
 */
export function buildUpcomingWidgetPayload(agendas: WidgetAgendaLike[], baseDate = new Date()): UpcomingWidgetItem[] {
  let todayAgendas = agendas.filter(a => {
    if (a.status === 'cancelled') return false;
    if (getAgendaTimeMode(a) === 'unscheduled') return false;
    if (!a.scheduled_at) return false;
    return isSameDay(new Date(a.scheduled_at), baseDate);
  });

  if (todayAgendas.length === 0) {
    const startOfToday = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).getTime();
    const endOfRange = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 8, 23, 59, 59, 999).getTime();
    todayAgendas = agendas.filter(a => {
      if (a.status === 'cancelled') return false;
      if (getAgendaTimeMode(a) === 'unscheduled') return false;
      if (!a.scheduled_at) return false;
      const t = new Date(a.scheduled_at).getTime();
      return t >= startOfToday && t <= endOfRange;
    }).slice(0, 3);
  }

  return todayAgendas.slice(0, 3).map(a => ({
    title: a.title,
    time: getAgendaTimeDisplay(a)
  }));
}

/**
 * Builds payload for the 7-Days interactive widget.
 * Filters agendas for today up to +8 days ahead (inclusive through 23:59:59), sorted by scheduled_at timestamp.
 */
export function buildAgenda7DaysWidgetPayload(agendas: WidgetAgendaLike[], baseDate = new Date()): Agenda7DaysWidgetItem[] {
  const startOfToday = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()).getTime();
  const endOf7Days = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 8, 23, 59, 59, 999).getTime();

  return agendas
    .filter(a => {
      if (a.status === 'cancelled') return false;
      if (getAgendaTimeMode(a) === 'unscheduled') return false;
      if (!a.scheduled_at) return false;
      const t = new Date(a.scheduled_at).getTime();
      return t >= startOfToday && t <= endOf7Days;
    })
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())
    .map(a => ({
      title: a.title,
      time: getAgendaTimeDisplay(a),
      date: format(new Date(a.scheduled_at!), 'yyyy-MM-dd')
    }));
}

/**
 * Builds payload for the consultation widget.
 * Groups active consultations by groupId || id, formatting multi-session items as (N Sesi).
 */
export function buildConsultationWidgetPayload(agendas: WidgetAgendaLike[]): ConsultationWidgetItem[] {
  const consultationMap = new Map<string, { title: string; count: number; notes: string }>();

  for (const a of agendas) {
    if ((a.status === 'pending_consultation' || a.status === 'rescheduled' || a.status === 'unscheduled') && !a.is_completed) {
      const groupKey = a.groupId || a.id;
      const existing = consultationMap.get(groupKey);
      if (!existing) {
        consultationMap.set(groupKey, {
          title: a.title,
          count: 1,
          notes: a.privateNotes || a.notes || ''
        });
      } else {
        existing.count += 1;
      }
    }
  }

  return Array.from(consultationMap.values())
    .slice(0, 100)
    .map(g => ({
      title: g.count > 1 ? `${g.title} (${g.count} Sesi)` : g.title,
      notes: g.notes,
      count: g.count
    }));
}
