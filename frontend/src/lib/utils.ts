import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** App-wide date rendition: DD-MM-YYYY (agreed convention). Date-only ISO
 *  strings are formatted without going through Date so a UTC-negative browser
 *  timezone can never shift them a day. */
export function formatDate(iso: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/** DD-MM-YYYY HH:mm — for timestamps (audit trail, revision metadata). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)} ${hh}:${mi}`;
}
