import { describe, expect, it } from 'vitest';
import { assignKeys, baseKey, escapeLatex, protectTitleCase, toBibtex, toBibtexEntry, uniquePapers } from '../src/export/bibtex';
import { toCsv } from '../src/export/csv';
import { toRis } from '../src/export/ris';
import type { Paper } from '../src/types/paper';

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'doi:10.1000/x1',
  title: 'Differentiable crop models for seasonal yield prediction',
  authors: [{ name: 'Jane Smith', given: 'Jane', family: 'Smith' }, { name: 'José Müller', given: 'José', family: 'Müller' }],
  journal: 'Remote Sensing of Environment',
  publicationDate: '2026-10-02',
  year: 2026,
  volume: '310',
  pages: '114-128',
  doi: '10.1000/x1',
  url: 'https://doi.org/10.1000/x1',
  documentType: 'article',
  sources: ['crossref'],
  ...over,
});

describe('BibTeX keys', () => {
  it('builds author-year-word keys', () => {
    expect(baseKey(paper())).toBe('smith2026differentiable');
    expect(baseKey(paper({ title: 'A new approach to the modelling of wheat' }))).toBe('smith2026approach');
  });
  it('folds diacritics and handles missing metadata', () => {
    expect(baseKey(paper({ authors: [{ name: 'Søren Ångström', given: 'Søren', family: 'Ångström' }] }))).toBe('angstrom2026differentiable');
    expect(baseKey(paper({ authors: [], year: undefined, publicationDate: undefined }))).toBe('anonnddifferentiable');
  });
  it('disambiguates colliding keys', () => {
    const papers = [paper(), paper({ id: 'b', doi: '10.1000/x2' }), paper({ id: 'c', doi: '10.1000/x3' })];
    expect([...assignKeys(papers).values()]).toEqual(['smith2026differentiable', 'smith2026differentiablea', 'smith2026differentiableb']);
  });
});

describe('BibTeX escaping', () => {
  it('escapes LaTeX special characters', () => {
    expect(escapeLatex('R&D: 50% of $x_1 #2 {a} ~ ^ \\')).toBe(
      'R\\&D: 50\\% of \\$x\\_1 \\#2 \\{a\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}',
    );
  });
  it('keeps UTF-8 by default and transliterates on request', () => {
    expect(escapeLatex('Müller')).toBe('Müller');
    expect(escapeLatex('Müller, José & Søren', true)).toBe('M{\\"u}ller, Jos{\\\'e} \\& S{\\o}ren');
    expect(escapeLatex('Čech', true)).toBe('{\\v{C}}ech');
  });
  it('protects acronyms and proper nouns in sentence-case titles', () => {
    expect(protectTitleCase('Mapping wheat with Sentinel-2 and LSTM networks: A review')).toBe(
      'Mapping wheat with {Sentinel-2} and {LSTM} networks: A review',
    );
    // Title Case titles: only mixed-case / acronyms are protected.
    expect(protectTitleCase('Deep Learning for Crop Yield with WOFOST')).toBe('Deep Learning for Crop Yield with {WOFOST}');
  });
});

describe('BibTeX entries', () => {
  it('writes a complete article entry', () => {
    const entry = toBibtexEntry(paper(), 'smith2026differentiable');
    expect(entry).toContain('@article{smith2026differentiable,');
    expect(entry).toContain('author = {Smith, Jane and Müller, José}');
    expect(entry).toContain('journal = {Remote Sensing of Environment}');
    expect(entry).toContain('year = {2026}');
    expect(entry).toContain('month = oct');
    expect(entry).toContain('pages = {114--128}');
    expect(entry).toContain('doi = {10.1000/x1}');
    expect(entry).not.toContain('abstract');
  });
  it('omits missing fields instead of writing empty ones', () => {
    const entry = toBibtexEntry(paper({ authors: [], journal: undefined, volume: undefined, pages: undefined, doi: undefined, url: undefined }), 'k');
    expect(entry).not.toMatch(/author|journal|volume|pages|doi|url/);
    expect(entry).not.toContain('{}');
  });
  it('does not escape DOIs and URLs', () => {
    const entry = toBibtexEntry(paper({ doi: '10.1000/a_b%c', url: 'https://doi.org/10.1000/a_b%c' }), 'k');
    expect(entry).toContain('doi = {10.1000/a_b%c}');
  });
  it('truncates long author lists with "and others"', () => {
    const authors = Array.from({ length: 30 }, (_, i) => ({ name: `A${i} B${i}`, given: `A${i}`, family: `B${i}` }));
    const entry = toBibtexEntry(paper({ authors }), 'k', { maxAuthors: 3 });
    expect(entry).toContain('author = {B0, A0 and B1, A1 and B2, A2 and others}');
  });
  it('braces institutional authors', () => {
    expect(toBibtexEntry(paper({ authors: [{ name: 'AgMIP Wheat Team' }] }), 'k')).toContain('author = {{AgMIP Wheat Team}}');
  });
  it('exports arXiv preprints as @misc with eprint fields', () => {
    const entry = toBibtexEntry(
      paper({ documentType: 'preprint', journal: 'arXiv', arxivId: '2610.01234', fieldsOfStudy: ['cs.LG'], doi: '10.48550/arxiv.2610.01234' }),
      'k',
    );
    expect(entry).toContain('@misc{k,');
    expect(entry).toContain('eprint = {2610.01234}');
    expect(entry).toContain('primaryclass = {cs.LG}');
  });
  it('removes duplicate DOIs across the whole file', () => {
    const papers = [paper(), paper({ id: 'other-id', doi: '10.1000/X1' }), paper({ id: 'z', doi: '10.1000/z' })];
    expect(uniquePapers(papers)).toHaveLength(2);
    expect(toBibtex(papers).match(/@article/g)).toHaveLength(2);
  });
});

describe('RIS and CSV', () => {
  it('writes RIS records', () => {
    const ris = toRis([paper({ abstract: 'An abstract.' })]);
    expect(ris).toContain('TY  - JOUR');
    expect(ris).toContain('AU  - Smith, Jane');
    expect(ris).toContain('SP  - 114');
    expect(ris).toContain('EP  - 128');
    expect(ris.trim().endsWith('ER  -')).toBe(true);
  });
  it('quotes CSV cells and neutralizes formulas', () => {
    const csv = toCsv([paper({ title: '=HYPERLINK("x"), a "quoted" title' })]);
    expect(csv).toContain('"\'=HYPERLINK(""x""), a ""quoted"" title"');
  });
});
