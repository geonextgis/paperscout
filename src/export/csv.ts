/** CSV export (RFC 4180, with a UTF-8 BOM so Excel detects the encoding). */
import { SOURCE_LABELS, type Paper } from '../types/paper';
import { uniquePapers } from './bibtex';

const COLUMNS: [string, (p: Paper) => string | number | undefined][] = [
  ['Title', (p) => p.title],
  ['Authors', (p) => p.authors.map((a) => a.name).join('; ')],
  ['Journal', (p) => p.journal],
  ['Year', (p) => p.year],
  ['Publication date', (p) => p.publicationDate],
  ['Volume', (p) => p.volume],
  ['Issue', (p) => p.issue],
  ['Pages', (p) => p.pages],
  ['DOI', (p) => p.doi],
  ['URL', (p) => p.url],
  ['Open access', (p) => (p.openAccess ? 'yes' : '')],
  ['PDF', (p) => p.pdfUrl],
  ['Citations', (p) => p.citationCount],
  ['Document type', (p) => p.documentType],
  ['Keywords', (p) => p.keywords?.join('; ')],
  ['Sources', (p) => p.sources.map((s) => SOURCE_LABELS[s]).join('; ')],
  ['Abstract', (p) => p.abstract],
];

function cell(value: string | number | undefined): string {
  if (value === undefined) return '';
  let s = String(value);
  // Neutralize spreadsheet formula injection from untrusted metadata.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(papers: Paper[]): string {
  const rows = [COLUMNS.map(([name]) => name).join(',')];
  for (const p of uniquePapers(papers)) rows.push(COLUMNS.map(([, get]) => cell(get(p))).join(','));
  return '﻿' + rows.join('\r\n') + '\r\n';
}
