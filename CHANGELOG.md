# Changelog

## Recent Changes

### Platform and dependencies

- Upgraded the app to Next.js `16.2.2`
- Upgraded React and React DOM to `19.2.4`
- Upgraded TypeScript to `6.0.2`
- Updated Tailwind/PostCSS tooling
- Updated `isomorphic-dompurify` to `3.7.1`
- Cleared the npm audit vulnerability backlog

### Feed processing and performance

- Moved RSS parsing to the server
- Replaced browser-only XML parsing with `fast-xml-parser`
- Added concurrency-limited feed loading
- Added title-based duplicate filtering
- Added SQLite-backed feed caching using `better-sqlite3`
- Added stale-cache fallback for temporary upstream failures

### Feed management

- Added a `/feeds` management page
- Added per-feed enable/disable state persisted in local storage
- Added category-wide enable/disable controls
- Added feed error tracking and problem-feed highlighting

### Reader UI

- Added icon-based toolbar controls
- Added multiple article layouts:
  - dense grid
  - list
  - newspaper front page
- Added a newspaper-style editorial layout for the active category using the latest 15 articles
- Expanded newspaper mode to use the latest 30 articles
- Simplified the reader header and removed extra explanatory text
- Removed the category title block above the story area
- Removed the top feed-failure banner from the reader page
- Added a fixed version label at the bottom-right of every page

### Visual design

- Reworked the theme toward a strict minimalist black/white palette
- Made dark mode flat black and light mode flat white
- Removed rounded corners globally
- Reduced gradients, blur, and decorative color treatments
- Simplified metadata presentation in article cards

### Reliability and safety

- Hardened local storage handling to avoid quota-related crashes
- Improved stale and malformed preference/error-log handling
- Sanitized rendered article HTML more safely
- Normalized relative links and images in article descriptions

## Current Version

- `v1.0.0`
