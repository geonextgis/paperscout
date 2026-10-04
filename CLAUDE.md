I want you to design and implement a complete web application for discovering and managing scientific literature. The entire project should live in a GitHub repository and be deployable through GitHub Pages, with GitHub Actions used for scheduled paper retrieval and preprocessing where necessary.

The application should be clean, modern, responsive, researcher-focused, and suitable for eventual public use.

## Core idea

Build a personalized literature discovery application where researchers can specify:

1. Research interests/topics
2. Preferred journals
3. Specific papers they like or consider relevant
4. Authors or keywords if useful

The app should then show newly published papers that match those interests.

## Data sources

The literature finder should support multiple scholarly sources, including:

- Web of Science
- Crossref
- Semantic Scholar
- arXiv

Web of Science is particularly important.

Implement the Web of Science integration properly using the official API. API credentials must NEVER be exposed in frontend code. Use GitHub repository secrets and GitHub Actions or another secure server-side workflow for Web of Science requests.

Assume that Web of Science access may require an API key and/or institutional subscription. The application should degrade gracefully when Web of Science credentials are unavailable.

## Deployment architecture

Prefer a mostly static architecture that can run cheaply/free:

- GitHub repository for source code
- GitHub Pages for frontend hosting
- GitHub Actions for scheduled literature retrieval
- GitHub Secrets for API credentials
- Generated JSON/database files for the frontend where appropriate
- Browser localStorage for user preferences in the initial version

Avoid requiring a continuously running server unless absolutely necessary.

The repository should be easy to fork and deploy.

## User onboarding

When a researcher first opens the application, provide an onboarding interface where they can define their interests.

Allow users to select or enter:

### Research topics

For example:

- crop modelling
- remote sensing
- differentiable models
- agricultural foundation models
- crop classification
- yield forecasting
- AI agents
- process-based modelling

Topics should support free-text entry as well as suggested topics.

### Preferred journals

Users should be able to search for and select journals.

Examples:

- Remote Sensing of Environment
- Agricultural and Forest Meteorology
- Field Crops Research
- European Journal of Agronomy
- Computers and Electronics in Agriculture
- Artificial Intelligence in Agriculture
- Nature Food
- Nature Communications
- Scientific Reports

Do not hard-code only these journals. They are examples.

Users should be able to:

- follow journals
- unfollow journals
- filter the literature feed by selected journals
- give selected journals higher ranking priority

### Example papers

This is an important feature.

Allow users to select existing papers that represent their research interests.

The app should use these papers to improve recommendations based on:

- title
- abstract
- keywords/topics
- authors
- journal
- related papers
- references/citations where available

A user's profile could therefore contain:

```text
Topics:
- crop modelling
- remote sensing
- differentiable modelling

Preferred journals:
- Remote Sensing of Environment
- Field Crops Research

Example papers:
- Paper A
- Paper B
- Paper C
```

Use this profile to calculate relevance for newly discovered papers.

## Main literature feed

Create a personalized dashboard containing sections such as:

- For You
- Latest
- New This Week
- Preferred Journals
- Highly Relevant
- Trending
- Related to Saved Papers

Each paper card should display at least:

- title
- authors
- journal/conference
- publication date
- abstract or shortened abstract
- DOI
- open-access link if available
- publisher link
- Web of Science link if available
- Semantic Scholar link if available
- citation count where available
- source/database
- relevance score
- matched topics/interests

Example:

```text
96% match

Differentiable Crop Models for Seasonal Yield Prediction

Authors...
Remote Sensing of Environment
October 2026

Why recommended:
Matches:
• differentiable modelling
• crop simulation
• remote sensing

[Abstract] [DOI] [PDF] [Save] [Select]
```

## Search

Include a global literature search.

Users should be able to search by:

- title
- keyword
- author
- DOI
- journal
- research topic

Provide filters for:

- publication date
- journal
- source
- open access
- document type
- citation count
- relevance
- newest first

## Paper selection

Users must be able to select multiple papers using checkboxes.

For example:

```text
☐ Paper 1
☑ Paper 2
☑ Paper 3
☐ Paper 4
☑ Paper 5
```

Provide:

- Select all
- Clear selection
- Select visible results
- Selected papers count

Example:

```text
3 papers selected
```

## BibTeX export

This is a major requirement.

Users should be able to select any number of papers and click:

```text
Download BibTeX
```

The app should automatically generate a `.bib` file containing BibTeX entries for all selected papers.

Example:

```bibtex
@article{smith2026crop,
  title={...},
  author={...},
  journal={...},
  year={2026},
  volume={...},
  pages={...},
  doi={...},
  url={...}
}
```

Generate clean BibTeX keys automatically.

Handle:

- duplicate DOIs
- missing metadata
- special LaTeX characters
- long author lists
- journal names
- DOI
- URL
- publication year

The `.bib` file should download directly in the browser.

Also consider export options for:

- BibTeX
- RIS
- CSV

But BibTeX is mandatory.

## Saved papers

Allow users to bookmark papers.

Store bookmarks locally for the first version.

Provide a Saved Papers page.

Users should be able to:

- save
- unsave
- select saved papers
- export saved papers to BibTeX

## User preferences

For the GitHub-only MVP, store preferences using browser localStorage.

Persist:

- selected research interests
- preferred journals
- example papers
- saved papers
- dismissed papers
- preferred filters

Structure the code so that Supabase/Firebase authentication could be added later without rewriting the entire application.

## Recommendation engine

Implement a transparent relevance ranking system.

Start with a lightweight approach that does not require paid LLM APIs.

Possible signals:

- title similarity
- abstract similarity
- keyword overlap
- preferred journal bonus
- similarity to example papers
- recency
- citation information
- followed authors

Return a normalized score such as:

```text
0–100%
```

Also explain why each paper was recommended.

For example:

```text
Why recommended

+ Strong match: differentiable modelling
+ Strong match: crop model
+ Published in preferred journal
+ Similar to Paper X
+ Published 2 days ago
```

Architect the recommendation code so embedding-based semantic search can be added later.

## Scheduled paper retrieval

Set up a GitHub Actions workflow that runs automatically, for example once per day.

It should:

1. Query supported scholarly APIs
2. Retrieve recent publications
3. Normalize metadata
4. Deduplicate by DOI and other identifiers
5. Merge metadata from different sources
6. Store the resulting catalogue
7. Commit/update generated data used by the website

Suggested structure:

```text
data/
  papers.json
  journals.json
  last_updated.json
```

Do not make unnecessary API calls every time a user opens the website.

## Web of Science

Give Web of Science special attention.

Create a clean abstraction such as:

```text
src/services/
    crossref.ts
    semanticScholar.ts
    arxiv.ts
    webOfScience.ts
```

For Web of Science:

- use the official API
- read the API key only from GitHub Secrets
- document required credentials
- provide `.env.example`
- never commit API keys
- implement pagination
- implement reasonable rate limiting
- handle failed requests
- log useful errors
- normalize Web of Science records into the common paper schema

If Web of Science API licensing prevents certain functionality, document the limitation clearly instead of implementing unofficial scraping.

## Common paper schema

Create a normalized internal representation such as:

```typescript
interface Paper {
  id: string;
  title: string;
  abstract?: string;
  authors: Author[];
  journal?: string;
  publicationDate?: string;
  year?: number;
  doi?: string;
  url?: string;
  pdfUrl?: string;
  openAccess?: boolean;
  citationCount?: number;
  keywords?: string[];
  fieldsOfStudy?: string[];
  sources: string[];
  webOfScienceId?: string;
  semanticScholarId?: string;
  arxivId?: string;
}
```

Improve this schema if necessary.

## UI

Use a polished researcher-oriented design.

Suggested navigation:

```text
Literature Finder

For You
Latest
Journals
Search
Saved
Export
Settings
```

Top-level dashboard example:

```text
-----------------------------------------------------
 Literature Finder                    Updated today
-----------------------------------------------------

Your interests
[Crop Models] [Remote Sensing] [AI Agents] [+ Add]

Following journals
[RSE] [Field Crops Research] [+ Add]

-----------------------------------------------------

🔥 Highly Relevant

96%  Paper title...
      Journal • date

      Why recommended:
      Crop modelling · Remote sensing

      [Save] [Select] [DOI] [PDF]

-----------------------------------------------------

🆕 New This Week

...
```

Use a card/grid/list layout appropriate for academic literature.

Support desktop and mobile.

## Technology

Prefer:

- React
- TypeScript
- Vite
- GitHub Pages
- GitHub Actions

Use a maintainable component architecture.

Do not overengineer the initial application.

## Repository structure

Create a clear production-ready repository, for example:

```text
literature-finder/
├── .github/
│   └── workflows/
│       ├── deploy.yml
│       └── update-papers.yml
├── src/
│   ├── components/
│   ├── pages/
│   ├── services/
│   ├── hooks/
│   ├── utils/
│   ├── types/
│   └── recommendation/
├── scripts/
│   ├── fetch-papers.ts
│   ├── normalize.ts
│   └── deduplicate.ts
├── data/
├── public/
├── README.md
├── .env.example
├── package.json
└── vite.config.ts
```

Adjust if there is a better architecture.

## README

Write a detailed README containing:

- what the application does
- architecture
- screenshots placeholder
- local installation
- development instructions
- GitHub Pages deployment
- GitHub Actions configuration
- API keys/secrets
- Web of Science setup
- Crossref setup
- Semantic Scholar setup
- arXiv setup
- how recommendation ranking works
- how BibTeX export works
- limitations
- future roadmap

## Security

Never expose API credentials in browser JavaScript.

All protected API requests must occur during GitHub Actions/server-side processing.

Do not scrape Web of Science pages.

Use official APIs and respect their terms and rate limits.

## Future extensibility

Design the project so we could later add:

- Supabase authentication
- user accounts
- synchronization across devices
- followed authors
- citation alerts
- email alerts
- weekly literature digest
- semantic embeddings
- AI paper summaries
- "similar papers"
- Zotero integration
- Mendeley export
- research groups
- collaborative reading lists
- recommendation feedback such as 👍 Relevant / 👎 Not relevant

## Important

Do not just create a conceptual plan.

Inspect the complete requirements, decide on the most sensible architecture, and then CREATE the actual project files and working implementation.

Start by:

1. creating an `ARCHITECTURE.md`
2. defining the common metadata schema
3. implementing the scholarly-source service layer
4. implementing the GitHub Actions literature pipeline
5. implementing the frontend
6. implementing user interests and journal preferences
7. implementing paper selection
8. implementing BibTeX export
9. implementing recommendation ranking
10. creating deployment workflows
11. creating comprehensive documentation

Keep everything modular, readable and production-quality.

The final result should be something I can push to GitHub, configure the required secrets, enable GitHub Pages, and have a functional personalized literature-discovery application.
