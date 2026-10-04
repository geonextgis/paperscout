import { describe, expect, it } from 'vitest';
import { parseArxivFeed, topicToArxivQuery } from '../src/services/sources/arxiv';
import { normalizeCrossrefWork } from '../src/services/sources/crossref';
import { normalizeS2Paper } from '../src/services/sources/semanticScholar';
import { journalsToWosQueries, normalizeWosDocument, topicToWosQuery, WebOfScienceSource } from '../src/services/sources/webOfScience';
import type { Paper } from '../src/types/paper';
import { deduplicate } from '../src/utils/deduplicate';
import { cleanDoi, cleanText, fixAllCaps, isoDate, parseAuthorName, titleKey } from '../src/utils/normalize';

describe('normalize helpers', () => {
  it('cleans DOIs', () => {
    expect(cleanDoi('https://doi.org/10.1016/J.RSE.2026.1')).toBe('10.1016/j.rse.2026.1');
    expect(cleanDoi('doi: 10.1000/abc')).toBe('10.1000/abc');
    expect(cleanDoi('not a doi')).toBeUndefined();
  });
  it('strips JATS markup and entities', () => {
    expect(cleanText('<jats:p>CO<jats:sub>2</jats:sub> &amp; H&#x2082;O</jats:p>')).toBe('CO 2 & H₂O');
  });
  it('builds partial dates', () => {
    expect(isoDate(2026, 'OCT')).toBe('2026-10');
    expect(isoDate(2026, 'OCT 15')).toBe('2026-10-15');
    expect(isoDate(2026, 3, 7)).toBe('2026-03-07');
    expect(isoDate(2026)).toBe('2026');
  });
  it('parses author names', () => {
    expect(parseAuthorName('Smith, Jane A.')).toMatchObject({ family: 'Smith', given: 'Jane A.', name: 'Jane A. Smith' });
    expect(parseAuthorName('Ludwig van Beethoven')).toMatchObject({ family: 'van Beethoven', given: 'Ludwig' });
  });
  it('fixes ALL CAPS', () => {
    expect(fixAllCaps('REMOTE SENSING OF ENVIRONMENT')).toBe('Remote Sensing of Environment');
    expect(fixAllCaps('Nature Food')).toBe('Nature Food');
  });
});

describe('source normalization', () => {
  it('normalizes Web of Science Starter documents', () => {
    const p = normalizeWosDocument({
      uid: 'WOS:001',
      title: 'Crop yield forecasting with Sentinel-2',
      types: ['Article'],
      source: { sourceTitle: 'FIELD CROPS RESEARCH', publishYear: 2026, publishMonth: 'SEP 15', volume: '12', pages: { range: '1-9' } },
      names: { authors: [{ displayName: 'Smith, Jane' }, { displayName: 'Doe, John' }] },
      links: { record: 'https://www.webofscience.com/wos/woscc/full-record/WOS:001' },
      citations: [{ db: 'WOS', count: 7 }],
      identifiers: { doi: '10.1000/ABC', issn: '0378-4290' },
      keywords: { authorKeywords: ['yield', 'Sentinel-2'] },
    })!;
    expect(p).toMatchObject({
      id: 'doi:10.1000/abc', journal: 'Field Crops Research', publicationDate: '2026-09-15', citationCount: 7,
      webOfScienceId: 'WOS:001', sources: ['wos'], documentType: 'article', issn: ['0378-4290'],
    });
    expect(p.authors[0]).toMatchObject({ family: 'Smith', given: 'Jane' });
    expect(p.webOfScienceUrl).toContain('webofscience.com');
  });
  it('builds Web of Science queries', () => {
    expect(topicToWosQuery('crop modelling (APSIM)')).toBe('TS=(crop modelling APSIM)');
    expect(topicToWosQuery('soil AND water')).toBe('TS=(soil water)');
    expect(journalsToWosQueries([{ name: 'A', issn: ['0034-4257'] }, { name: 'B', issn: ['0378-4290'] }])).toEqual(['IS=(0034-4257 OR 0378-4290)']);
  });
  it('reports Web of Science as unconfigured without a key', () => {
    expect(new WebOfScienceSource({}).isConfigured()).toBe(false);
    expect(new WebOfScienceSource({ apiKey: '  ' }).isConfigured()).toBe(false);
    expect(new WebOfScienceSource({ apiKey: 'k' }).isConfigured()).toBe(true);
  });
  it('normalizes Crossref works and uses the registration date for future issue dates', () => {
    const p = normalizeCrossrefWork({
      DOI: '10.1016/J.X.2026.1', title: ['A <i>title</i>'], type: 'journal-article',
      author: [{ given: 'Jane', family: 'Smith', ORCID: 'https://orcid.org/0000-0001' }],
      'container-title': ['Field Crops Research'], ISSN: ['0378-4290'],
      published: { 'date-parts': [[2027, 1]] }, created: { 'date-parts': [[2026, 9, 20]], 'date-time': '2026-09-20T10:00:00Z' },
      license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }],
      'is-referenced-by-count': 2,
    })!;
    expect(p).toMatchObject({ doi: '10.1016/j.x.2026.1', title: 'A title', publicationDate: '2026-09-20', openAccess: true, citationCount: 2 });
    expect(normalizeCrossrefWork({ DOI: '10.1/x', title: ['Editorial Board'] })).toBeUndefined();
  });
  it('normalizes Semantic Scholar papers', () => {
    const p = normalizeS2Paper({
      paperId: 'abc', title: 'T', authors: [{ name: 'Jane Smith' }], externalIds: { DOI: '10.1000/Y', ArXiv: '2610.00001' },
      publicationDate: '2026-09-30', year: 2026, openAccessPdf: { url: 'https://x/y.pdf' }, citationCount: 3, venue: 'arXiv.org',
    })!;
    expect(p).toMatchObject({ doi: '10.1000/y', arxivId: '2610.00001', semanticScholarId: 'abc', openAccess: true, journal: 'arXiv', documentType: 'preprint' });
  });
  it('parses arXiv Atom feeds', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
      <entry><id>http://arxiv.org/abs/2610.01234v2</id><title>Differentiable
        crop models</title><summary> An abstract. </summary><published>2026-10-01T12:00:00Z</published>
        <author><name>Jane Smith</name></author><author><name>John Doe</name></author>
        <arxiv:primary_category term="cs.LG"/><category term="cs.LG"/><category term="stat.ML"/></entry></feed>`;
    const [p] = parseArxivFeed(xml);
    expect(p).toMatchObject({
      arxivId: '2610.01234', title: 'Differentiable crop models', publicationDate: '2026-10-01', doi: '10.48550/arxiv.2610.01234',
      pdfUrl: 'https://arxiv.org/pdf/2610.01234', fieldsOfStudy: ['cs.LG', 'stat.ML'],
    });
    expect(p.authors).toHaveLength(2);
    expect(topicToArxivQuery('process-based modelling')).toBe('all:process-based AND all:modelling');
  });
});

describe('deduplicate', () => {
  const base: Paper = {
    id: 'doi:10.1/a', title: 'Differentiable crop models for seasonal yield prediction', doi: '10.1/a', year: 2026,
    authors: [{ name: 'Jane Smith', family: 'Smith', given: 'Jane' }], sources: ['crossref'], publicationDate: '2026-10', journal: 'Field Crops Research',
    documentType: 'article', firstSeen: '2026-10-01T00:00:00Z',
  };
  it('merges records sharing a DOI and keeps the best of each field', () => {
    const s2: Paper = { ...base, sources: ['semanticscholar'], abstract: 'A'.repeat(80), citationCount: 4, semanticScholarId: 's2', publicationDate: '2026-10-03', firstSeen: '2026-10-04T00:00:00Z' };
    const wos: Paper = { ...base, sources: ['wos'], citationCount: 2, webOfScienceId: 'WOS:1', keywords: ['yield'] };
    const [m, ...rest] = deduplicate([base, s2, wos]);
    expect(rest).toHaveLength(0);
    expect(m.sources.sort()).toEqual(['crossref', 'semanticscholar', 'wos']);
    expect(m.abstract).toHaveLength(80);
    expect(m.citationCount).toBe(2); // Web of Science count wins
    expect(m.publicationDate).toBe('2026-10-03'); // most precise
    expect(m.firstSeen).toBe('2026-10-01T00:00:00Z');
    expect(m).toMatchObject({ webOfScienceId: 'WOS:1', semanticScholarId: 's2', keywords: ['yield'] });
  });
  it('merges a preprint with its published version by title and prefers the publisher DOI', () => {
    const arxiv: Paper = { ...base, id: 'arxiv:2610.1', doi: '10.48550/arxiv.2610.1', arxivId: '2610.1', sources: ['arxiv'], journal: 'arXiv', documentType: 'preprint', abstract: 'B'.repeat(60) };
    const [m, ...rest] = deduplicate([arxiv, base]);
    expect(rest).toHaveLength(0);
    expect(m).toMatchObject({ id: 'doi:10.1/a', doi: '10.1/a', arxivId: '2610.1', journal: 'Field Crops Research', documentType: 'article' });
  });
  it('does not merge different papers with the same title', () => {
    const other: Paper = { ...base, id: 'doi:10.1/b', doi: '10.1/b' };
    const otherAuthor: Paper = { ...base, id: 'x', doi: undefined, authors: [{ name: 'Li Wei', family: 'Wei', given: 'Li' }] };
    expect(deduplicate([base, other, otherAuthor])).toHaveLength(3);
  });
  it('title keys ignore case, accents and punctuation', () => {
    expect(titleKey('Über-Model: A Test!')).toBe(titleKey('uber model a test'));
  });
});
