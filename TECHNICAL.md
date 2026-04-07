# Technical Documentation

## Stack

- Framework: Next.js `16.2.2`
- UI: React `19.2.4`
- Language: TypeScript `6.0.2`
- Styling: Tailwind CSS `4.2.2`
- Theme switching: `next-themes`
- RSS/XML parsing: `fast-xml-parser`
- HTML sanitizing: `isomorphic-dompurify`
- Persistent cache: `better-sqlite3`

## Architecture Overview

The application is a client-heavy reader UI backed by a server-side RSS normalization endpoint.

High-level flow:

1. The client loads `public/feeds.json`
2. The selected category resolves to a list of feed URLs
3. The client fetches normalized feed JSON from `/api/rss`
4. The server fetches/parses/caches RSS content
5. The client merges, deduplicates, sorts, and renders the resulting stories

## Important Directories and Files

- `app/page.tsx`
  Main reader page and layout switching logic
- `app/feeds/page.tsx`
  Feed management page
- `app/api/rss/route.ts`
  RSS fetch, parse, normalize, and cache endpoint
- `components/DetailsSheet.tsx`
  Slide-in article preview pane
- `lib/feed-cache-db.ts`
  SQLite cache access layer
- `lib/feed-preferences.ts`
  Browser-side feed selection and error-log persistence
- `lib/browser-storage.ts`
  Safe local-storage wrappers and quota handling
- `lib/date-format.ts`
  Shared timestamp formatting utilities
- `public/feeds.json`
  Feed/category configuration

## RSS Pipeline

The RSS route:

- accepts feed URL and request parameters
- checks SQLite cache first
- fetches the upstream feed if needed
- parses XML into normalized article objects
- stores normalized results in SQLite
- returns cached results on upstream failure when available

This approach reduces repeat network cost and makes the reader faster and more resilient.

## Caching

Cache storage is local SQLite:

- database path: `data/underwire.db`
- backend: `better-sqlite3`
- purpose:
  - feed response caching
  - stale fallback
  - improved startup responsiveness

The cache survives server restarts, unlike the earlier in-memory approach.

## Client-Side State

The client stores reader preferences in browser storage:

- selected feeds
- last active category
- chosen view mode
- feed error log

Safe storage helpers are used to avoid crashes when quota is exceeded.

## Deduplication

Story deduplication is primarily performed in the reader page by:

- exact link tracking
- normalized title comparison

Title normalization removes punctuation, diacritics, and spacing differences to collapse near-identical headlines from multiple sources.

## Views

Supported reader views:

- `grid4`
- `list`
- `frontpage`

The `frontpage` mode uses the latest 30 loaded stories from the active category and composes them into a newspaper-inspired editorial layout.

## Theme System

The app uses CSS variables defined in `app/globals.css`.

Theme principles:

- light mode: white background, black text
- dark mode: black background, white text
- minimal accent usage
- square corners globally

## Security Notes

- article descriptions are sanitized before rendering
- remote RSS content is normalized server-side
- browser rendering avoids trusting raw upstream HTML
- feed failures are tracked for operational visibility

## Build and Runtime

Commands:

```powershell
npm run dev
npm run build
npm run start
```

Current runtime notes:

- the app runs correctly in both dev and production
- `next start` still warns when `output: standalone` is configured, but it starts successfully

## Upgrade Status

Current dependency status:

- all installed npm packages are on their latest available versions
- `npm audit` is clean

## Suggested Future Technical Improvements

- Move article aggregation from many client requests to a single category endpoint
- Persist richer feed health telemetry in SQLite
- Add background feed refresh jobs
- Add automated tests for feed parsing and UI state persistence
- Add schema validation for `feeds.json`
