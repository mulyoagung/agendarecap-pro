import { AppSettings } from "@/app/actions/settings";
import { format } from "date-fns";

export interface AgendaItem {
  id: string;
  title: string;
  location?: string | null;
  scheduled_at: string;
  notes?: string | null;
  include_notes_in_share: boolean;
  is_completed: boolean;
}

export function formatAgendasToWhatsApp(
  dateTitle: string, 
  isUpdate: boolean,
  updateTimeStr: string | null,
  agendas: AgendaItem[], 
  settings?: AppSettings | null
) {
  const toCapitalizeAll = (str: string) => 
    str.toLowerCase().replace(/(?:^|\s)\S/g, (a) => a.toUpperCase());

  const appName = settings?.app_name ? toCapitalizeAll(settings.app_name) : 'Agenda Recap';
  const isWatermarkEnabled = settings?.is_watermark_enabled ?? true;
  const watermarkText = settings?.watermark_text 
    ? toCapitalizeAll(settings.watermark_text) 
    : 'Dibuat Oleh Agenda Recap Pro';

  // Capitalize format tanggal
  const formattedDateTitle = toCapitalizeAll(dateTitle);

  // Header Format:
  // *Agenda Rektor*
  // *Sabtu, 28 Maret 2026*
  let textPrefix = `*${appName}*\n*${formattedDateTitle}*`;
  
  if (isUpdate && updateTimeStr) {
    textPrefix = `*UPDATE ${appName.toUpperCase()}*\n*${formattedDateTitle}*\n_(Pembaruan pada ${updateTimeStr})_`;
  }

  if (!agendas || agendas.length === 0) {
    let emptyText = `${textPrefix}\n\n_Belum ada agenda di tanggal ini._`;
    if (isWatermarkEnabled) {
      emptyText += `\n\n------------------------------------------\n_${watermarkText}_`;
    }
    return emptyText;
  }

  let text = `${textPrefix}\n\n`;

  agendas.forEach((agenda, index) => {
    const statusInfo = agenda.is_completed ? " (Selesai)" : "";
    
    // 1. Judul Agenda
    text += `*${index + 1}. ${agenda.title}*${statusInfo}\n`;

    // 2. Waktu & Lokasi
    const time = format(new Date(agenda.scheduled_at), "HH:mm");
    let detailLine = time;
    if (agenda.location) {
      detailLine += ` — ${agenda.location}`;
    }
    text += `${detailLine}\n`;

    // 3. Catatan khusus
    if (agenda.notes && agenda.include_notes_in_share) {
      text += `_Catatan: ${agenda.notes}_\n`;
    }

    text += '\n'; // Spacer below each agenda item
  });

  if (isWatermarkEnabled) {
    // Spacer and Watermark footer
    text += `------------------------------------------\n_${watermarkText}_`;
  }

  return text.trim();
}
