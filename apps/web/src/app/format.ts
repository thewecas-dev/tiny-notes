const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** "2 days 3 h", "5 h 12 min", "42 min", "less than a minute". */
export function formatRemaining(iso: string, now = Date.now()): string {
  const minutes = Math.floor((new Date(iso).getTime() - now) / 60_000);
  if (minutes < 1) return 'less than a minute';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'}${hours ? ` ${hours} h` : ''}`;
  if (hours > 0) return `${hours} h${mins ? ` ${mins} min` : ''}`;
  return `${mins} min`;
}

export function formatViews(count: number): string {
  return `${count} ${count === 1 ? 'view' : 'views'}`;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
