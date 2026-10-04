import type { Author } from '../types/paper';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-04" → "4 Oct 2026", "2026-10" → "Oct 2026", "2026" → "2026" */
export function formatDate(date: string | undefined): string {
  if (!date) return 'Date unknown';
  const [y, m, d] = date.slice(0, 10).split('-');
  if (!m) return y;
  const month = MONTHS[Number(m) - 1] ?? '';
  return d ? `${Number(d)} ${month} ${y}` : `${month} ${y}`;
}

export function formatAuthors(authors: Author[], max = 4): string {
  if (!authors.length) return 'Unknown authors';
  const names = authors.slice(0, max).map((a) => a.name);
  return authors.length > max ? `${names.join(', ')} … +${authors.length - max} more` : names.join(', ');
}

export function relativeDay(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
