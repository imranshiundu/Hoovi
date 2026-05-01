# HooviDB — Universal Free Data Mesh

HooviDB is a browser-first public data explorer. It connects one clean frontend to legal, free, open data sources across media, code, books, knowledge graphs, archives, and public API catalogs.

This project is **not** a leaked API-key dump. Real provider keys must never be committed or exposed in browser JavaScript. Hoovi prefers no-key sources first, then optional backend/private credentials only when a provider requires them.

## What Hoovi does now

- Searches public images from **Wikimedia Commons**.
- Searches public video records from **Internet Archive Moving Image**.
- Supports a Node backend API when deployed on a server/Vercel-style runtime.
- Still works on static hosts such as Netlify for images/videos through `hoovi-fallback.js`.
- Reads `/data/*.json` packs as a growing source registry.
- Keeps secrets out of the frontend.

## Current pages

- `/` — catalog view
- `/movies.html` — movie/show/media discovery
- `/anime.html` — anime metadata
- `/music.html` — public audio/media discovery
- `/books.html` — book/document discovery
- `/code.html` — code/package/developer sources
- `/images.html` — no-key Wikimedia Commons image search
- `/videos.html` — no-key Internet Archive video search
- `/packs.html` — local Hoovi data packs

## Architecture

```txt
HooviDB Frontend
        ↓
Browser no-key fallback for static hosting
        ↓
Optional HooviDB backend API
        ↓
Resolvers / Open APIs / Dumps / Public catalogs
        ↓
Normalized Hoovi records
```

The frontend uses the same card renderer for all sources. Every result is normalized into:

```json
{
  "id": "source-id",
  "type": "image | video | code | book | catalog",
  "source": "Wikimedia Commons",
  "kind": "image",
  "title": "Result title",
  "subtitle": "Short metadata",
  "description": "Readable summary",
  "thumbnail": "https://...",
  "externalUrl": "https://...",
  "downloadUrl": "https://...",
  "meta": "Source metric"
}
```

## Why the app may look broken on Netlify

The original frontend calls routes like:

```txt
/api/status
/api/image
/api/video
/api/catalog
```

Those routes work only when the Node backend is running. A static Netlify deployment can serve the HTML/CSS/JS but may not run `server.js`, so searches can silently fail.

To fix the most visible failure without touching the UI, Hoovi now loads:

```html
<script src="hoovi-fallback.js"></script>
<script src="app.js"></script>
```

on `images.html` and `videos.html`.

`hoovi-fallback.js` intercepts missing `/api/image`, `/api/video`, `/api/status`, and `/api/reload-data` requests and falls back to no-key browser-safe public sources:

- Images: Wikimedia Commons Action API using `origin=*`.
- Videos: Internet Archive Advanced Search API using JSON output.

## Running locally

```bash
npm start
```

Then open:

```txt
http://localhost:3000
```

To syntax-check the current JavaScript:

```bash
npm run check
```

## Data packs

Hoovi supports `/data` as an executable source registry, not just a static catalog.

Supported file styles:

- legacy mega-catalog JSON like `data/hoovidb.json`
- plain JSON files full of links or API objects
- Hoovi data packs with connectors and link lists
- private Hoovi data packs with credentials when a provider requires a key

Use:

```txt
data/*.json           shareable public packs
data/*.private.json   local-only packs with credentials
```

`data/*.private.json` should stay ignored by git.

### Example connector pack

See `data/hoovi.pack.example.json`.

```json
{
  "hoovi_version": 2,
  "pack": {
    "id": "my-pack",
    "name": "My Pack"
  },
  "connectors": [
    {
      "id": "example-search",
      "name": "Example Search",
      "source": "Example API",
      "category": "custom",
      "request": {
        "url": "https://example.com/search",
        "query_param": "q"
      },
      "response": {
        "items_path": "results",
        "mappings": {
          "title": "name",
          "external_url": "url",
          "download_url": "file_url"
        }
      }
    }
  ]
}
```

If a connector needs a key, put the real credential only in an ignored private pack or backend environment variable. Do not commit real keys or fake placeholder keys.

## Useful backend routes

When `server.js` is running:

- `/api/status` — registry counts and warnings
- `/api/registry` — loaded packs and connectors
- `/api/reload-data` — rescan `/data` without restarting
- `/api/connector?id=<connector-id>&q=<query>` — run one connector
- `/api/packs?q=<query>` — run enabled `/data` connectors
- `/api/download?...` — resolve supported provider downloads

## Source policy

Allowed:

- no-key public APIs
- RSS/Atom feeds
- SPARQL endpoints
- public JSON feeds
- public metadata APIs
- official bulk dumps
- open-data catalogs
- public domain / openly licensed media repositories

Not allowed:

- leaked API keys
- scraped private data
- paywalled data bypasses
- user tokens in frontend code
- committed `.env` secrets

## Current public sources

- **Wikimedia Commons** for images and media files.
- **Internet Archive** for public video/audio/archive records.
- **Open Library** for books and book metadata.
- **GitHub REST API** for public code/repository data.
- **Jikan** for no-key anime metadata.
- **TVMaze** for no-key show metadata.

Hoovi should grow by adding more legal source connectors, not by collecting exposed secrets.
