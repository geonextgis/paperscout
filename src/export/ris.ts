/** RIS export (Zotero, Mendeley, EndNote, RefWorks all import it). */
import type { Paper } from '../types/paper';
import { uniquePapers } from './bibtex';

const TYPE: Record<string, string> = {
  article: 'JOUR', review: 'JOUR', editorial: 'JOUR', conference: 'CPAPER', 'book-chapter': 'CHAP',
  book: 'BOOK', dataset: 'DATA', preprint: 'GEN', other: 'GEN',
};

export function toRisEntry(paper: Paper, includeAbstract = true): string {
  const lines: string[] = [];
  const add = (tag: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') lines.push(`${tag}  - ${String(value).replace(/[\r\n]+/g, ' ')}`);
  };
  add('TY', TYPE[paper.documentType ?? 'article'] ?? 'JOUR');
  add('TI', paper.title);
  for (const a of paper.authors) add('AU', a.family ? [a.family, a.given].filter(Boolean).join(', ') : a.name);
  add(paper.documentType === 'article' || !paper.documentType ? 'JO' : 'T2', paper.journal);
  add('PY', paper.year);
  if (paper.publicationDate) add('DA', paper.publicationDate.replace(/-/g, '/'));
  add('VL', paper.volume);
  add('IS', paper.issue);
  if (paper.pages) {
    const [start, end] = paper.pages.split(/\s*[-–—]+\s*/);
    add('SP', start);
    add('EP', end);
  }
  add('PB', paper.publisher);
  add('SN', paper.issn?.[0]);
  add('DO', paper.doi);
  add('UR', paper.url ?? (paper.doi ? `https://doi.org/${paper.doi}` : undefined));
  if (paper.pdfUrl && paper.pdfUrl !== paper.url) add('L1', paper.pdfUrl);
  for (const k of paper.keywords ?? []) add('KW', k);
  if (includeAbstract) add('AB', paper.abstract);
  lines.push('ER  - ');
  return lines.join('\r\n');
}

export function toRis(papers: Paper[], includeAbstract = true): string {
  return uniquePapers(papers).map((p) => toRisEntry(p, includeAbstract)).join('\r\n\r\n') + '\r\n';
}
