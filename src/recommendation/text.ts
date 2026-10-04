/**
 * Lightweight text processing for matching: tokenization, stop-word removal and
 * a deliberately small stemmer. The stemmer only needs to make the variants
 * researchers actually type line up — "modelling" / "modeling" / "models",
 * "agricultural" / "agriculture", "forecasting" / "forecasts".
 */
import { stripDiacritics } from '../utils/normalize';

const STOP_WORDS = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between
  both but by can could did do does doing down during each few for from further had has have having here how however
  i if in into is it its itself may more most much must no nor not of off on once only or other our out over own
  same should so some such than that the their them then there these they this those through to too under until up
  upon us use used using very via was we were what when where whether which while who whom why will with within
  without would you your new novel approach study paper results based show shows present propose proposed method
  methods analysis two one`.split(/\s+/),
);

const cache = new Map<string, string>();

export function stem(word: string): string {
  if (word.length <= 3) return word;
  const hit = cache.get(word);
  if (hit) return hit;
  let w = word;
  let stripped = false;
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);

  if (w.endsWith('ing') && w.length > 5) (w = w.slice(0, -3)), (stripped = true);
  else if (w.endsWith('ed') && w.length > 4) (w = w.slice(0, -2)), (stripped = true);
  // modell(ing) → model, mapp(ing) → map
  if (stripped && /([bdgklmnprt])\1$/.test(w)) w = w.slice(0, -1);

  if (w.endsWith('al') && w.length > 6) w = w.slice(0, -2);
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  if (cache.size < 50_000) cache.set(word, w);
  return w;
}

/** Lower-cased, de-accented, stop-word-free stems. Hyphens split words ("process-based" → process, base). */
export function tokenize(text: string | undefined): string[] {
  if (!text) return [];
  const words = stripDiacritics(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (STOP_WORDS.has(w) || (w.length < 2 && !/\d/.test(w))) continue;
    out.push(stem(w));
  }
  return out;
}

/** Token sequence as a padded string, so phrase containment is a substring test. */
export function phraseText(tokens: string[]): string {
  return ` ${tokens.join(' ')} `;
}
