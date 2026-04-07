# Underwire

Underwire is a minimalist RSS-driven news reader built with Next.js. It aggregates articles from curated feeds, groups them by category, removes duplicate headlines, and lets the reader switch between compact cards, a list view, and a newspaper-style front page.

## What It Does

- Loads articles from configured RSS feeds
- Groups sources into categories such as world, AI, security, science, photography, movies, and Dutch news
- Deduplicates stories based on normalized titles and links
- Supports light and dark themes
- Offers multiple reading layouts:
  - dense grid
  - list
  - newspaper front page
- Opens a focused preview pane for reading article details
- Lets users enable and disable individual feeds on a dedicated feed management page
- Tracks recent feed failures and highlights problematic sources

## Main Pages

- `/`: main reader experience
- `/feeds`: feed selection and health overview
- `/api/rss`: server-side RSS fetch and normalization endpoint

## Core Characteristics

- SQLite-backed RSS cache for faster repeat loads
- Server-side XML parsing and normalization
- Client-side persistence for reader preferences
- Minimal black/white visual system
- Responsive layouts for desktop and mobile

## Local Development

```powershell
npm install
npm run dev
```

Production build:

```powershell
npm run build
npm run start
```

## Notes

- Feed definitions are stored in `public/feeds.json`
- Cached feed data is stored locally in `data/underwire.db`
- Theme, last category, selected feeds, and view mode are persisted in browser storage

See also:

- [CHANGELOG.md](/CHANGELOG.md)
- [TECHNICAL.md](/TECHNICAL.md)
- [FUNCTIONAL.md](/FUNCTIONAL.md)
