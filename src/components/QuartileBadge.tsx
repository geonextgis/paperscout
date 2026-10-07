import type { JournalInfo } from '../types/paper';

const SHARE = ['', 'top 25%', 'upper-middle 25%', 'lower-middle 25%', 'bottom 25%'];

/** Q1–Q4 tag for a ranked journal; renders nothing when the journal has no ranking. */
export function QuartileBadge({ journal }: { journal?: JournalInfo }) {
  if (!journal?.quartile) return null;
  const title =
    `Journal ranking: ${SHARE[journal.quartile]} of ${journal.field ?? 'all'} journals` +
    `${journal.impact !== undefined ? ` (2-year mean citedness ${journal.impact})` : ''}. ` +
    'Estimated from OpenAlex — not an official JCR/SJR quartile.';
  return <span className={`tag quartile quartile-${journal.quartile}`} title={title}>Q{journal.quartile}</span>;
}
