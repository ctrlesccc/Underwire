# Functional Documentation

## Purpose

Underwire is a feed reader that helps users browse a curated selection of news sources in a fast, visually clear way. It is designed to feel lighter and more editorial than a traditional dashboard, while still giving the user control over which feeds are included.

## Primary User Goals

- Read the latest stories by topic
- Switch quickly between categories
- Compare stories from multiple sources
- Exclude noisy or unwanted feeds
- Spot failing feeds
- Open a readable article preview without leaving the page
- Switch between different reading layouts depending on preference

## Main Functional Areas

### 1. Reader homepage

The homepage is the main reading surface.

It allows the user to:

- select a category
- switch between layout modes
- refresh feed data
- open the feed management screen
- inspect feed health
- switch theme

Stories are shown as a unified stream assembled from multiple feeds in the selected category.

### 2. Category navigation

Categories come from `feeds.json`.

Each category:

- has a key
- has a label
- may have an emoji
- can be enabled or disabled in configuration

There is also an `All` category that merges all enabled categories.

### 3. Story aggregation

For the active category, the app:

- loads all selected feeds in that category
- merges the returned articles
- removes duplicates
- sorts the result by freshness
- filters out blocked or stale content according to configuration

### 4. Reader layouts

The app currently supports three reading modes:

- Dense grid: compact card-based overview
- List: larger horizontal reading list
- Front page: newspaper-style editorial arrangement using the latest 30 stories

The selected view is remembered between sessions.

### 5. Article preview

Clicking a story opens a right-side preview pane.

The preview pane shows:

- source
- title
- publication timestamp
- image when available
- sanitized description/content
- a link to the original article

### 6. Feed management page

The `/feeds` page gives the user direct control over source selection.

Functions:

- enable all feeds
- disable all feeds
- enable an entire category
- disable an entire category
- toggle individual feeds
- inspect problematic feeds

### 7. Feed health visibility

The app tracks feed fetch errors and surfaces them in the feed management page.

The user can see:

- which feeds are currently problematic
- basic error counts
- the last observed failure timestamp

### 8. Theme support

The app supports:

- light mode
- dark mode

The visual design is intentionally minimal:

- light mode is white with black text
- dark mode is black with white text

### 9. Persistent preferences

The app remembers:

- last selected category
- selected view mode
- enabled/disabled feeds
- feed error history

This allows the reader to return to the same working setup on the next visit.

## Functional Behavior Details

### Freshness

Articles are sorted by publication date when timestamps are available.

### Deduplication

If multiple feeds publish the same headline, the app attempts to collapse duplicates so only one card/story remains visible.

### Fallback behavior

If some feeds fail but others succeed, the app still shows the successful results.

If no feeds are enabled for a category, the user sees an empty-state message.

### Newspaper mode

The front-page layout emphasizes:

- the latest lead story as the main package
- a varied editorial arrangement for the next stories
- a more magazine/newspaper-style reading experience

## Intended Audience

The app is suited for users who want:

- a personal curated news desk
- broad topic coverage from selected sources
- a cleaner alternative to visiting many news sites separately

## Current Limitations

- feed quality depends on the configured RSS sources
- some source failures are unavoidable because upstream publishers can change or remove feeds
- article previews depend on what feed content is actually provided
- the app is optimized for curated reading, not full article archiving
