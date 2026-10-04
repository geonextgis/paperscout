import { describe, expect, it } from 'vitest';
import { authorKey, createRanker, findSimilar, stem, TfidfSimilarity, tokenize } from '../src/recommendation';
import type { Paper } from '../src/types/paper';
import { EMPTY_PROFILE, type UserProfile } from '../src/types/profile';
import { matchQuery, parseQuery } from '../src/utils/filter';

const NOW = Date.UTC(2026, 9, 4);
let n = 0;
const paper = (over: Partial<Paper>): Paper => ({ id: `p${n++}`, title: 'Untitled', authors: [], sources: ['crossref'], publicationDate: '2026-10-01', ...over });

const crop = paper({
  title: 'Differentiable crop modelling for seasonal yield forecasting',
  abstract: 'We couple a process-based crop model with neural networks and remote sensing observations of wheat to forecast yield.',
  journal: 'Remote Sensing of Environment', authors: [{ name: 'Jane Smith', given: 'Jane', family: 'Smith' }],
});
const cropOld = paper({ ...crop, id: 'old', publicationDate: '2026-05-01' });
const similar = paper({ title: 'Hybrid neural crop models improve wheat yield forecasts', abstract: 'A process-based crop model coupled with neural networks forecasts wheat yield from remote sensing.', journal: 'Field Crops Research' });
const unrelated = paper({ title: 'Protein folding dynamics in yeast', abstract: 'We study chaperone-mediated folding of proteins in Saccharomyces cerevisiae.', journal: 'Cell' });
const corpus = [crop, cropOld, similar, unrelated];
const profile = (over: Partial<UserProfile>): UserProfile => ({ ...EMPTY_PROFILE, ...over });

describe('text processing', () => {
  it('unifies spelling and inflection variants', () => {
    expect(stem('modelling')).toBe(stem('modeling'));
    expect(stem('models')).toBe(stem('model'));
    expect(stem('agricultural')).toBe(stem('agriculture'));
    expect(tokenize('The Process-Based Models of crops')).toEqual(['process', 'model', 'crop']);
  });
});

describe('ranking', () => {
  it('scores topic matches high and unrelated papers low, within 0–100', () => {
    const ranker = createRanker(profile({ topics: ['crop models', 'yield forecasting'] }), corpus, { now: NOW });
    const a = ranker.score(crop);
    const b = ranker.score(unrelated);
    expect(a.score).toBeGreaterThan(60);
    expect(a.score).toBeLessThanOrEqual(100);
    expect(b.score).toBeLessThan(20);
    expect(a.matchedTopics).toEqual(expect.arrayContaining(['crop models', 'yield forecasting']));
    expect(a.reasons.map((r) => r.text)).toContain('Strong match: crop models');
  });
  it('explains and rewards followed journals, authors and recency', () => {
    const base = createRanker(profile({ topics: ['crop models'] }), corpus, { now: NOW });
    const boosted = createRanker(
      profile({ topics: ['crop models'], journals: [{ name: 'remote sensing of environment' }], authors: ['Smith, J.'] }),
      corpus, { now: NOW },
    );
    const s = boosted.score(crop);
    expect(s.score).toBeGreaterThan(base.score(crop).score);
    const texts = s.reasons.map((r) => r.text).join(' | ');
    expect(texts).toContain('Published in followed journal');
    expect(texts).toContain('By followed author Jane Smith');
    expect(texts).toContain('Published 3 days ago');
    expect(boosted.score(crop).score).toBeGreaterThan(boosted.score(cropOld).score);
  });
  it('uses example papers', () => {
    const ranker = createRanker(profile({ examplePapers: [crop] }), corpus, { now: NOW });
    const s = ranker.score(similar);
    expect(s.score).toBeGreaterThan(ranker.score(unrelated).score + 15);
    expect(s.reasons.some((r) => r.text.includes('imilar to “Differentiable crop modelling'))).toBe(true);
  });
  it('breakdown points add up to the score and weights are respected', () => {
    const ranker = createRanker(profile({ topics: ['crop models'], weights: { topics: 50, examples: 0, journal: 0, authors: 0, recency: 0, citations: 0 } }), corpus, { now: NOW });
    const s = ranker.score(crop);
    expect(s.breakdown).toHaveLength(1);
    expect(Math.round(s.breakdown.reduce((sum, b) => sum + b.points, 0))).toBe(s.score);
    expect(s.breakdown[0]).toMatchObject({ signal: 'topics', bonus: false, maxPoints: 100 });
    expect(s.score).toBe(90);
  });
  it('rank() sorts best first', () => {
    const ranked = createRanker(profile({ topics: ['crop models'] }), corpus, { now: NOW }).rank(corpus);
    expect(ranked[ranked.length - 1].paper).toBe(unrelated);
  });
  it('finds similar papers', () => {
    const sim = new TfidfSimilarity(corpus);
    expect(sim.similarity(crop, crop)).toBeCloseTo(1, 5);
    expect(sim.similarity(crop, similar)).toBeGreaterThan(sim.similarity(crop, unrelated));
    expect(findSimilar(sim, [crop], [similar, unrelated], 5).map((r) => r.paper)).toEqual([similar]);
  });
  it('matches author name variants', () => {
    expect(authorKey('Müller, Hans Peter')).toBe(authorKey({ name: 'H. Muller', given: 'H.', family: 'Muller' }));
    expect(authorKey('Jane Smith')).toBe('smith j');
  });
});

describe('search', () => {
  it('requires all terms, supports phrases, fields and DOIs', () => {
    const p = paper({ title: 'Remote sensing of wheat', doi: '10.1000/abc', authors: [{ name: 'José Müller' }], journal: 'Field Crops Research' });
    expect(parseQuery('crop "remote sensing" Müller')).toEqual(['crop', 'remote sensing', 'muller']);
    expect(matchQuery(p, parseQuery('"remote sensing" muller'), 'all', '')).toBeGreaterThan(0);
    expect(matchQuery(p, parseQuery('remote maize'), 'all', '')).toBe(0);
    expect(matchQuery(p, parseQuery('muller'), 'title', '')).toBe(0);
    expect(matchQuery(p, parseQuery('muller'), 'author', '')).toBeGreaterThan(0);
    expect(matchQuery(p, parseQuery('https://doi.org/10.1000/ABC'), 'all', 'https://doi.org/10.1000/ABC')).toBe(100);
  });
});
