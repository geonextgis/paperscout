import type { Paper } from '../types/paper';
import { toBibtex, type BibtexOptions } from './bibtex';
import { toCsv } from './csv';
import { toRis } from './ris';

export type ExportFormat = 'bibtex' | 'ris' | 'csv';

export interface ExportOptions extends BibtexOptions {}

export const EXPORT_FORMATS: Record<ExportFormat, { label: string; extension: string; mime: string }> = {
  bibtex: { label: 'BibTeX', extension: 'bib', mime: 'application/x-bibtex' },
  ris: { label: 'RIS', extension: 'ris', mime: 'application/x-research-info-systems' },
  csv: { label: 'CSV', extension: 'csv', mime: 'text/csv' },
};

export function exportPapers(papers: Paper[], format: ExportFormat, options: ExportOptions = {}): string {
  if (format === 'ris') return toRis(papers, options.includeAbstract ?? true);
  if (format === 'csv') return toCsv(papers);
  return toBibtex(papers, options);
}

/** Trigger a file download entirely in the browser. */
export function downloadText(content: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPapers(papers: Paper[], format: ExportFormat, options: ExportOptions = {}): void {
  const { extension, mime } = EXPORT_FORMATS[format];
  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(exportPapers(papers, format, options), `paperscout-${stamp}.${extension}`, mime);
}

export { toBibtex, toRis, toCsv };
