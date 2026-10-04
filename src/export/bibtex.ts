/**
 * BibTeX export.
 *
 * Handles: duplicate papers (by DOI), unique readable keys (`smith2026crop`,
 * `smith2026cropa`, …), missing metadata, LaTeX special characters, optional
 * ASCII-only output, very long author lists and case protection of acronyms
 * and proper nouns in titles.
 */
import type { Author, Paper } from '../types/paper';
import { stripDiacritics } from '../utils/normalize';

export interface BibtexOptions {
  /** Include the abstract field (default false — keeps files small). */
  includeAbstract?: boolean;
  /** Author lists longer than this are cut and terminated with "and others" (→ "et al."). 0 = never. */
  maxAuthors?: number;
  /** Convert accented characters to LaTeX commands for pre-Unicode toolchains (default false). */
  asciiOnly?: boolean;
}

const LATEX_SPECIALS: Record<string, string> = {
  '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_',
  '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
};

const COMBINING: Record<string, string> = {
  '̀': '`', '́': "'", '̂': '^', '̃': '~', '̄': '=', '̆': 'u', '̇': '.',
  '̈': '"', '̊': 'r', '̋': 'H', '̌': 'v', '̧': 'c', '̨': 'k',
};

const UNICODE_TO_LATEX: Record<string, string> = {
  ß: '{\\ss}', ø: '{\\o}', Ø: '{\\O}', æ: '{\\ae}', Æ: '{\\AE}', œ: '{\\oe}', Œ: '{\\OE}', ł: '{\\l}', Ł: '{\\L}',
  ı: '{\\i}', đ: '{\\dj}', Đ: '{\\DJ}', '–': '--', '—': '---', '‘': '`', '’': "'", '“': '``', '”': "''",
  '…': '\\ldots{}', '×': '$\\times$', '°': '$^\\circ$', '±': '$\\pm$', '≤': '$\\leq$', '≥': '$\\geq$',
  µ: '$\\mu$', α: '$\\alpha$', β: '$\\beta$', γ: '$\\gamma$', δ: '$\\delta$', λ: '$\\lambda$', σ: '$\\sigma$',
  '₂': '$_2$', '²': '$^2$', '³': '$^3$', ' ': '~', ' ': ' ', '‐': '-', '‑': '-', '−': '-',
};

/** Escape characters that are special to LaTeX; optionally transliterate non-ASCII to LaTeX commands. */
export function escapeLatex(text: string, asciiOnly = false): string {
  let out = text.replace(/[\\&%$#_{}~^]/g, (c) => LATEX_SPECIALS[c]);
  if (!asciiOnly) return out;
  out = out.replace(/[^\x00-\x7f]/g, (c) => UNICODE_TO_LATEX[c] ?? c);
  // é → e + U+0301 → {\'e}
  return out.normalize('NFD').replace(/([A-Za-z])([̀-ͯ])/g, (_m, base: string, mark: string) => {
    const cmd = COMBINING[mark];
    if (!cmd) return base;
    return /[a-zA-Z]/.test(cmd) ? `{\\${cmd}{${base}}}` : `{\\${cmd}${base}}`;
  }).normalize('NFC');
}

/**
 * Wrap words whose capitalization must survive bibliography styles that
 * lower-case titles: acronyms / mixed case ("LSTM", "WOFOST", "mRNA") always,
 * and capitalized words ("Sentinel-2", "Europe") when the title is in sentence case.
 */
export function protectTitleCase(title: string, asciiOnly = false): string {
  const words = title.split(' ');
  const long = words.filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 4);
  const capitalized = long.filter((w) => /^\P{L}*\p{Lu}/u.test(w)).length;
  const sentenceCase = long.length > 0 && capitalized / long.length < 0.5;

  let sentenceStart = true;
  return words
    .map((word) => {
      const escaped = escapeLatex(word, asciiOnly);
      const letters = word.replace(/^\P{L}+/u, '');
      const innerCapital = /\p{Lu}/u.test(letters.slice(1));
      const leadingCapital = /^\p{Lu}/u.test(letters);
      const protect = innerCapital || (sentenceCase && leadingCapital && !sentenceStart);
      sentenceStart = /[.:?!]$/.test(word);
      return protect ? `{${escaped}}` : escaped;
    })
    .join(' ');
}

const KEY_STOP_WORDS = new Set(
  'a an the on of in for and or to with from by at as is are towards toward using via into over under new novel'.split(' '),
);

function asciiLetters(text: string): string {
  return stripDiacritics(text.replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l').replace(/[æÆ]/g, 'ae'))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** `smith2026crop` — first author's family name + year + first significant title word. */
export function baseKey(paper: Paper): string {
  const first = paper.authors[0];
  const family = first ? asciiLetters(first.family ?? first.name.split(/\s+/).pop() ?? '') : '';
  const year = paper.year ?? paper.publicationDate?.slice(0, 4) ?? 'nd';
  const word = paper.title
    .split(/[\s\-–—:/]+/)
    .map(asciiLetters)
    .find((w) => w.length > 1 && !KEY_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return `${family || 'anon'}${year}${word ?? ''}`;
}

function formatAuthor(author: Author, asciiOnly: boolean): string {
  if (author.family) {
    const family = escapeLatex(author.family, asciiOnly);
    return author.given ? `${family}, ${escapeLatex(author.given, asciiOnly)}` : family;
  }
  // Consortia / unparsed names: braces stop BibTeX from splitting them into name parts.
  return `{${escapeLatex(author.name, asciiOnly)}}`;
}

function formatAuthors(authors: Author[], options: BibtexOptions): string {
  const max = options.maxAuthors ?? 0;
  const list = max > 0 && authors.length > max ? authors.slice(0, max) : authors;
  const names = list.map((a) => formatAuthor(a, !!options.asciiOnly));
  if (list.length < authors.length) names.push('others');
  return names.join(' and ');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function entryType(paper: Paper): string {
  switch (paper.documentType) {
    case 'conference': return 'inproceedings';
    case 'book': return 'book';
    case 'book-chapter': return 'incollection';
    case 'preprint':
    case 'dataset': return 'misc';
    case 'other': return paper.journal ? 'article' : 'misc';
    default: return 'article';
  }
}

export function toBibtexEntry(paper: Paper, key: string, options: BibtexOptions = {}): string {
  const ascii = !!options.asciiOnly;
  const esc = (s: string) => escapeLatex(s, ascii);
  const type = entryType(paper);
  const fields: [string, string | undefined][] = [];
  const add = (name: string, value: string | undefined | false) => fields.push([name, value || undefined]);

  add('title', `{${protectTitleCase(paper.title, ascii)}}`);
  add('author', paper.authors.length ? `{${formatAuthors(paper.authors, options)}}` : undefined);

  if (type === 'article') add('journal', paper.journal && `{${esc(paper.journal)}}`);
  else if (type === 'inproceedings' || type === 'incollection') add('booktitle', paper.journal && `{${esc(paper.journal)}}`);
  else if (type === 'misc' && paper.arxivId) {
    add('eprint', `{${paper.arxivId}}`);
    add('archiveprefix', '{arXiv}');
    add('primaryclass', paper.fieldsOfStudy?.[0] && /^[a-z-]+\.[A-Za-z-]+$/.test(paper.fieldsOfStudy[0]) && `{${paper.fieldsOfStudy[0]}}`);
  } else if (type === 'misc') add('howpublished', paper.journal && `{${esc(paper.journal)}}`);

  const year = paper.year ?? (paper.publicationDate ? Number(paper.publicationDate.slice(0, 4)) : undefined);
  add('year', year ? `{${year}}` : undefined);
  const month = paper.publicationDate && paper.publicationDate.length >= 7 ? MONTHS[Number(paper.publicationDate.slice(5, 7)) - 1] : undefined;
  add('month', month); // unquoted: standard BibTeX month macro
  add('volume', paper.volume && `{${esc(paper.volume)}}`);
  add('number', paper.issue && `{${esc(paper.issue)}}`);
  add('pages', paper.pages && `{${esc(paper.pages).replace(/\s*[-–—]+\s*/g, '--')}}`);
  add('publisher', paper.publisher && type !== 'misc' && `{${esc(paper.publisher)}}`);
  add('issn', paper.issn?.[0] && `{${paper.issn[0]}}`);
  // DOI and URL are identifiers, not text: they are written verbatim.
  add('doi', paper.doi && `{${paper.doi}}`);
  add('url', (paper.url ?? (paper.doi && `https://doi.org/${paper.doi}`)) ? `{${paper.url ?? `https://doi.org/${paper.doi}`}}` : undefined);
  add('keywords', paper.keywords?.length ? `{${esc(paper.keywords.join(', '))}}` : undefined);
  add('abstract', options.includeAbstract && paper.abstract ? `{${esc(paper.abstract)}}` : undefined);

  const body = fields.filter(([, v]) => v !== undefined).map(([k, v]) => `  ${k} = ${v}`).join(',\n');
  return `@${type}{${key},\n${body}\n}`;
}

/** Remove papers that are the same work (same DOI, or same id when there is no DOI). */
export function uniquePapers(papers: Paper[]): Paper[] {
  const seen = new Set<string>();
  return papers.filter((p) => {
    const key = p.doi ? `doi:${p.doi.toLowerCase()}` : p.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Assign a unique key to every paper: collisions get a, b, c, … suffixes. */
export function assignKeys(papers: Paper[]): Map<Paper, string> {
  const used = new Set<string>();
  const keys = new Map<Paper, string>();
  for (const paper of papers) {
    const base = baseKey(paper);
    let key = base;
    for (let i = 0; used.has(key); i++) {
      // a…z, then aa, ab, …
      let suffix = '';
      for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) suffix = String.fromCharCode(97 + (n % 26)) + suffix;
      key = base + suffix;
    }
    used.add(key);
    keys.set(paper, key);
  }
  return keys;
}

export function toBibtex(papers: Paper[], options: BibtexOptions = {}): string {
  const unique = uniquePapers(papers);
  const keys = assignKeys(unique);
  const header = `% ${unique.length} ${unique.length === 1 ? 'entry' : 'entries'} exported from PaperScout on ${new Date().toISOString().slice(0, 10)}\n`;
  return header + '\n' + unique.map((p) => toBibtexEntry(p, keys.get(p)!, options)).join('\n\n') + '\n';
}
