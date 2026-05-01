const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const rootDir = __dirname;
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

loadEnv(path.join(rootDir, ".env"));

const config = {
  port: Number(process.env.PORT || 3000),
  lastfmApiKey: process.env.LASTFM_API_KEY || "",
  pexelsApiKey: process.env.PEXELS_API_KEY || "",
};

const catalogRecords = [];

function normalizeAndAddEntry(entry, sourceFile) {
  if (!entry) return;

  if (typeof entry === 'string') {
    if (entry.startsWith('http://') || entry.startsWith('https://')) {
      let hostname = "Unknown API";
      try { hostname = new URL(entry).hostname; } catch(e) {}
      
      catalogRecords.push({
        id: `auto-${Math.random().toString(36).slice(2)}`,
        name: hostname,
        url: entry,
        category: "Extracted Link",
        source: sourceFile
      });
    }
    return;
  }

  const url = entry.url || entry.link || entry.api || entry.endpoint;
  let name = entry.name || entry.title || entry.API || entry.id;
  if (!name && url) {
    try { name = new URL(url).hostname; } catch(e) { name = "Unknown API"; }
  }
  
  if (url) {
    catalogRecords.push({
      id: entry.id || `auto-${Math.random().toString(36).slice(2)}`,
      name: name || "Unknown API",
      category: entry.category || entry.type || "Catalog",
      description: entry.description || entry.desc || "Imported from data folder.",
      url: url,
      auth: entry.auth || entry.Auth || "Unknown",
      source: sourceFile
    });
  }
}

function recursiveExtract(data, sourceFile) {
  if (Array.isArray(data)) {
    data.forEach(item => recursiveExtract(item, sourceFile));
  } else if (typeof data === 'object' && data !== null) {
    if (data.url || data.link || data.api || data.API || data.name) {
      normalizeAndAddEntry(data, sourceFile);
    } else {
      Object.values(data).forEach(val => recursiveExtract(val, sourceFile));
    }
  } else if (typeof data === 'string') {
    normalizeAndAddEntry(data, sourceFile);
  }
}

function loadMegaCatalog() {
  const dataDir = path.join(rootDir, 'data');
  const filesToParse = [];

  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        filesToParse.push(path.join(dataDir, file));
      }
    }
  }

  for (const file of filesToParse) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const json = JSON.parse(content);
      const filename = path.basename(file);
      recursiveExtract(json, filename);
    } catch (err) {
      console.error(`Failed to parse ${file}: ${err.message}`);
    }
  }
  console.log(`Loaded ${catalogRecords.length} records into the mega catalog.`);
}

loadMegaCatalog();

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
  });
  res.end(JSON.stringify(payload));
}

function text(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function safeFilePath(requestPath) {
  const rawPath = requestPath === "/" ? "/index.html" : requestPath;
  const resolved = path.normalize(path.join(rootDir, rawPath));
  if (!resolved.startsWith(rootDir)) {
    return null;
  }
  return resolved;
}

const apiCache = new Map();

async function fetchJson(url, options = {}) {
  const key = url.toString() + JSON.stringify(options);
  if (apiCache.has(key)) {
    const cached = apiCache.get(key);
    if (Date.now() - cached.timestamp < 3600000) { // 1 hour cache
      return cached.data;
    }
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Upstream request failed with ${response.status}`);
  }
  const data = await response.json();
  apiCache.set(key, { timestamp: Date.now(), data });
  return data;
}

function pickLastfmImage(images = []) {
  const reversed = [...images].reverse();
  const match = reversed.find((image) => image["#text"]);
  return match ? match["#text"] : null;
}

function buildStatus() {
  const status = {
    ready: true,
    enabledCount: 0,
    missingKeys: [],
    routes: {
      dashboard: true,
      music: Boolean(config.lastfmApiKey),
      video: Boolean(config.pexelsApiKey),
      image: Boolean(config.pexelsApiKey),
      doc: true,
      people: false,
      torrent: false,
    },
    sources: {
      lastfm: {
        status: config.lastfmApiKey ? "on" : "off",
      },
      pexelsPhotos: {
        status: config.pexelsApiKey ? "on" : "off",
      },
      pexelsVideos: {
        status: config.pexelsApiKey ? "on" : "off",
      },
      openLibrary: {
        status: "on",
      },
      github: {
        status: "on",
      },
      npm: {
        status: "on",
      },
      hackerNews: {
        status: "on",
      },
      devto: {
        status: "on",
      },
    },
  };

  if (!config.lastfmApiKey) {
    status.missingKeys.push("LASTFM_API_KEY");
  }

  if (!config.pexelsApiKey) {
    status.missingKeys.push("PEXELS_API_KEY");
  }

  status.enabledCount = Object.values(status.routes).filter(Boolean).length;
  status.ready = status.enabledCount > 0;
  return status;
}

function numberShort(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}m`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }

  return String(value);
}

async function searchGitHubRepos(query) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "8");

  const data = await fetchJson(url.toString(), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Hoovi",
    },
  });

  return (data.items || []).map((repo) => ({
    source: "GitHub",
    kind: "repo",
    title: repo.name,
    subtitle: `${repo.owner?.login || "unknown"} · ${repo.language || "mixed"}`,
    summary: repo.description || "Repository match from GitHub search.",
    metricLabel: "Stars",
    metricValue: numberShort(repo.stargazers_count || 0),
    score: repo.stargazers_count || 0,
    url: repo.html_url,
    tags: [repo.language || "code", "repo", "source"],
  }));
}

async function searchNpmPackages(query) {
  const url = new URL("https://registry.npmjs.org/-/v1/search");
  url.searchParams.set("text", query);
  url.searchParams.set("size", "8");

  const data = await fetchJson(url.toString());
  return (data.objects || []).map((entry) => ({
    source: "npm",
    kind: "package",
    title: entry.package?.name || "unknown-package",
    subtitle: `${entry.package?.publisher?.username || "community"} · npm`,
    summary: entry.package?.description || "Package match from npm search.",
    metricLabel: "Score",
    metricValue: `${Math.round((entry.score?.final || 0) * 1000)}`,
    score: entry.score?.final || 0,
    url: entry.package?.links?.npm || entry.package?.links?.repository || "",
    tags: ["package", "javascript", "registry"],
  }));
}

async function searchHackerNews(query) {
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("hitsPerPage", "8");

  const data = await fetchJson(url.toString());
  return (data.hits || []).map((hit) => ({
    source: "Hacker News",
    kind: "discussion",
    title: hit.title || hit.story_title || "HN thread",
    subtitle: `${hit.author || "unknown"} · score ${hit.points || 0}`,
    summary: hit._highlightResult?.comment_text?.value
      ? stripHtml(hit._highlightResult.comment_text.value)
      : "Discussion thread from Hacker News search.",
    metricLabel: "Trend",
    metricValue: `${hit.points || 0}`,
    score: hit.points || 0,
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    tags: ["discussion", "signal", "news"],
  }));
}

async function fetchDevToArticles() {
  const url = new URL("https://dev.to/api/articles");
  url.searchParams.set("per_page", "8");
  url.searchParams.set("top", "7");

  const data = await fetchJson(url.toString());
  return (data || []).map((article) => ({
    source: "Dev.to",
    kind: "article",
    title: article.title,
    subtitle: `${article.user?.name || "author"} · ${article.reading_time_minutes || 0} min read`,
    summary: article.description || "Developer article from Dev.to.",
    metricLabel: "Reactions",
    metricValue: `${article.positive_reactions_count || 0}`,
    score: article.positive_reactions_count || 0,
    url: article.url,
    tags: ["article", article.type_of || "post", "dev"],
  }));
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, "").trim();
}

async function searchMusic(query) {
  if (!config.lastfmApiKey) {
    return { error: "LASTFM_API_KEY is not configured.", statusCode: 503 };
  }

  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "track.search");
  url.searchParams.set("track", query);
  url.searchParams.set("api_key", config.lastfmApiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "12");

  const data = await fetchJson(url.toString());
  const tracks = Array.isArray(data.results?.trackmatches?.track)
    ? data.results.trackmatches.track
    : [];

  return {
    items: tracks.map((track, index) => ({
      id: `${track.mbid || track.url || track.name}-${index}`,
      type: "music",
      source: "Last.fm",
      title: track.name,
      subtitle: track.artist,
      thumbnail: pickLastfmImage(track.image),
      externalUrl: track.url || null,
      downloadUrl: null,
      previewUrl: null,
      meta: track.listeners ? `${track.listeners} listeners` : "Track metadata",
      description: `Track match surfaced from Last.fm search for "${query}".`,
    })),
  };
}

function pickPexelsVideoFile(files = []) {
  if (!Array.isArray(files) || !files.length) {
    return null;
  }

  const mp4Files = files.filter((file) => file.file_type === "video/mp4");
  const sorted = mp4Files.sort((left, right) => (left.width || 0) - (right.width || 0));
  return sorted[0] || files[0];
}

async function searchImages(query) {
  if (!config.pexelsApiKey) {
    return { error: "PEXELS_API_KEY is not configured.", statusCode: 503 };
  }

  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "12");
  url.searchParams.set("orientation", "landscape");

  const data = await fetchJson(url.toString(), {
    headers: {
      Authorization: config.pexelsApiKey,
    },
  });

  return {
    items: (data.photos || []).map((photo) => ({
      id: String(photo.id),
      type: "image",
      source: "Pexels",
      title: photo.alt || `Pexels photo ${photo.id}`,
      subtitle: photo.photographer,
      thumbnail: photo.src?.large || photo.src?.medium || photo.src?.small || null,
      externalUrl: photo.url || null,
      downloadUrl: photo.src?.original || photo.src?.large || null,
      previewUrl: null,
      meta: `${photo.width}×${photo.height}`,
      description: `Photo by ${photo.photographer} on Pexels.`,
    })),
  };
}

async function searchVideos(query) {
  if (!config.pexelsApiKey) {
    return { error: "PEXELS_API_KEY is not configured.", statusCode: 503 };
  }

  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "10");

  const data = await fetchJson(url.toString(), {
    headers: {
      Authorization: config.pexelsApiKey,
    },
  });

  return {
    items: (data.videos || []).map((video) => {
      const file = pickPexelsVideoFile(video.video_files);

      return {
        id: String(video.id),
        type: "video",
        source: "Pexels",
        title: `Pexels video ${video.id}`,
        subtitle: video.user?.name || "Pexels creator",
        thumbnail: video.image || null,
        externalUrl: video.url || null,
        downloadUrl: file?.link || null,
        previewUrl: file?.link || null,
        meta: `${formatDuration(video.duration)} · ${file?.width || video.width || "?"}w`,
        description: `Stock video clip served by Pexels for the query "${query}".`,
      };
    }),
  };
}

async function searchDocs(query) {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");

  const data = await fetchJson(url.toString());
  const docs = Array.isArray(data.docs) ? data.docs : [];

  return {
    items: docs.map((doc) => {
      const coverUrl = doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        : null;
      const workPath = doc.key ? `https://openlibrary.org${doc.key}` : null;

      return {
        id: doc.key || `${doc.title}-${doc.first_publish_year || "unknown"}`,
        type: "doc",
        source: "Open Library",
        title: doc.title,
        subtitle: Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "Unknown author",
        thumbnail: coverUrl,
        externalUrl: workPath,
        downloadUrl: workPath,
        previewUrl: null,
        meta: doc.first_publish_year ? `First published ${doc.first_publish_year}` : "Book record",
        description: `Open Library work record with ${doc.edition_count || 0} edition${doc.edition_count === 1 ? "" : "s"}.`,
      };
    }),
  };
}

function uniqueByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.source}:${item.title}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function searchMovies(query) {
  const url = new URL("https://api.tvmaze.com/search/shows");
  url.searchParams.set("q", query);
  const data = await fetchJson(url.toString()).catch(() => []);
  return {
    items: data.map((entry) => {
      const show = entry.show;
      return {
        id: String(show.id),
        type: "movie",
        source: "TVMaze",
        title: show.name,
        subtitle: show.genres?.join(", ") || "TV Show",
        thumbnail: show.image?.medium || show.image?.original || null,
        externalUrl: show.url,
        downloadUrl: null,
        previewUrl: null,
        meta: show.premiered ? `Premiered ${show.premiered}` : "Show metadata",
        description: stripHtml(show.summary) || `TV Show match from TVMaze.`,
      };
    }),
  };
}

async function searchAnime(query) {
  const url = new URL("https://api.jikan.moe/v4/anime");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");
  const data = await fetchJson(url.toString()).catch(() => ({ data: [] }));
  return {
    items: (data.data || []).map((anime) => ({
      id: String(anime.mal_id),
      type: "anime",
      source: "Jikan",
      title: anime.title,
      subtitle: anime.type || "Anime",
      thumbnail: anime.images?.webp?.image_url || anime.images?.jpg?.image_url || null,
      externalUrl: anime.url,
      downloadUrl: null,
      previewUrl: null,
      meta: `Score: ${anime.score || "N/A"}`,
      description: anime.synopsis || `Anime match from Jikan.`,
    })),
  };
}

async function searchDeezer(query) {
  const url = new URL("https://api.deezer.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "12");
  const data = await fetchJson(url.toString()).catch(() => ({ data: [] }));
  return {
    items: (data.data || []).map((track) => ({
      id: String(track.id),
      type: "music",
      source: "Deezer",
      title: track.title,
      subtitle: track.artist?.name || "Unknown Artist",
      thumbnail: track.album?.cover_medium || track.album?.cover_small || null,
      externalUrl: track.link,
      downloadUrl: null,
      previewUrl: track.preview || null,
      meta: formatDuration(track.duration),
      description: `Track from album "${track.album?.title || "Unknown"}".`,
    })),
  };
}

function buildDashboardPayload({ query, mode, github, npm, hackerNews, devto, docs }) {
  const all = uniqueByTitle([...github, ...npm, ...hackerNews, ...devto, ...docs]);
  const ranked = [...all].sort((left, right) => (right.score || 0) - (left.score || 0));
  const picks = ranked.slice(0, 4);
  const coverage = [
    { label: "npm", count: npm.length },
    { label: "GitHub", count: github.length },
    { label: "Hacker News", count: hackerNews.length },
    { label: "Dev.to", count: devto.length },
  ];

  const activity = coverage.map((item) => item.count + 2);
  while (activity.length < 7) {
    activity.push(Math.max(2, activity[activity.length - 1] - 1));
  }

  const topMovers = ranked.slice(0, 5).map((item) => ({
    title: item.title,
    score: `${item.metricLabel} ${item.metricValue}`,
    meta: `${item.source} · ${item.subtitle}`,
    url: item.url,
  }));

  const sourceHealth = [
    { name: "GitHub", statusText: `OK · ${github.length} rows`, statusClass: "ok", meta: "public search live" },
    { name: "Hacker News", statusText: `OK · ${hackerNews.length} rows`, statusClass: "ok", meta: "algolia search live" },
    { name: "Dev.to", statusText: `OK · ${devto.length} rows`, statusClass: "ok", meta: "editorial feed live" },
    { name: "Open Library", statusText: `OK · ${docs.length} rows`, statusClass: "ok", meta: "catalog live" },
  ];

  const feed = uniqueByTitle([
    ...github.slice(0, 3),
    ...npm.slice(0, 3),
    ...hackerNews.slice(0, 3),
    ...devto.slice(0, 3),
  ]).slice(0, 10).map((item) => ({
    source: item.source,
    title: item.title,
    meta: item.subtitle,
    copy: item.summary,
    url: item.url,
  }));

  return {
    mode,
    query,
    hero: {
      title: "Discovery command center.",
      summary: `Keep ${query} discovery, scoring, source health, and watchlist signals in one compact view.`,
    },
    savedState: [
      { label: "Saved Rows", value: String(Math.min(9, picks.length + 1)) },
      { label: "Queued", value: String(feed.length > 4 ? 2 : 0) },
      { label: "Watchlist Hits", value: String(topMovers.length > 2 ? 3 : 0) },
      { label: "High Value", value: String(Math.min(6, picks.length + 1)) },
    ],
    topMovers,
    sourceHealth,
    overviewMini: [
      { label: "Runtime", value: "hybrid browser + node" },
      { label: "Last Sync", value: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) },
      { label: "Automation", value: "public-source sweep" },
      { label: "AI Status", value: mode === "personal" ? "private synthesis on" : "public curation on" },
    ],
    briefing: `${all.length} live items across ${coverage.length} active sources. ${docs.length} catalog rows cached. Strongest signal: ${topMovers[0]?.title || "none yet"}.`,
    summary: [
      { label: "Live Items", value: String(all.length) },
      { label: "Catalog Rows", value: String(docs.length) },
      { label: "Sources", value: String(coverage.length) },
      { label: "AI Notes", value: String(picks.length + 6) },
      { label: "New Arrivals", value: String(devto.length) },
    ],
    picks,
    coverage,
    activity,
    feed,
    quickLinks: [
      { label: "Browse Library", meta: "cards", url: docs[0]?.url || "https://openlibrary.org" },
      { label: "Open Recents", meta: "stream", url: feed[0]?.url || "https://github.com" },
      { label: "Review Log", meta: "audit", url: topMovers[0]?.url || "https://news.ycombinator.com" },
      { label: "Edit Settings", meta: "watchlist", url: "https://www.npmjs.com" },
    ],
    notes: [
      { title: "Compact Mode", body: "This layout is optimized for private daily use: tighter spacing, persistent signals, and fast rescans." },
      { title: "Personal First", body: "Because you are not planning to market it, a personal dashboard keeps the UI focused on your workflows instead of onboarding others." },
    ],
  };
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "—";
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

async function searchCatalog(query) {
  const q = query.toLowerCase();
  const results = catalogRecords.filter(record => 
    (record.name && record.name.toLowerCase().includes(q)) || 
    (record.description && record.description.toLowerCase().includes(q)) ||
    (record.category && record.category.toLowerCase().includes(q))
  ).slice(0, 100);

  return {
    items: results.map(record => ({
      id: record.id,
      type: "catalog",
      source: record.source,
      title: record.name,
      subtitle: record.category,
      thumbnail: null,
      externalUrl: record.url,
      downloadUrl: null,
      previewUrl: null,
      meta: `Auth: ${record.auth}`,
      description: record.description,
    }))
  };
}

async function handleApi(req, res, url) {
  const query = url.searchParams.get("q")?.trim();
  const mode = url.searchParams.get("mode")?.trim() || "personal";

  if (url.pathname === "/api/status") {
    json(res, 200, buildStatus());
    return true;
  }

  if (url.pathname === "/api/dashboard") {
    const dashboardQuery = query || "open source ai";
    const [github, npm, hackerNews, devto, docsPayload] = await Promise.all([
      searchGitHubRepos(dashboardQuery).catch(() => []),
      searchNpmPackages(dashboardQuery).catch(() => []),
      searchHackerNews(dashboardQuery).catch(() => []),
      fetchDevToArticles().catch(() => []),
      searchDocs(dashboardQuery).catch(() => ({ items: [] })),
    ]);
    const docs = docsPayload.items || [];

    json(res, 200, buildDashboardPayload({
      query: dashboardQuery,
      mode,
      github,
      npm,
      hackerNews,
      devto,
      docs,
    }));
    return true;
  }

  if (!query && url.pathname !== "/api/status") {
    json(res, 400, { error: "Missing required query parameter `q`." });
    return true;
  }

  try {
    if (url.pathname === "/api/music") {
      const payload = await searchMusic(query);
      if (payload.error) {
        json(res, payload.statusCode, { error: payload.error });
      } else {
        json(res, 200, payload);
      }
      return true;
    }

    if (url.pathname === "/api/image") {
      const payload = await searchImages(query);
      if (payload.error) {
        json(res, payload.statusCode, { error: payload.error });
      } else {
        json(res, 200, payload);
      }
      return true;
    }

    if (url.pathname === "/api/video") {
      const payload = await searchVideos(query);
      if (payload.error) {
        json(res, payload.statusCode, { error: payload.error });
      } else {
        json(res, 200, payload);
      }
      return true;
    }

    if (url.pathname === "/api/catalog") {
      json(res, 200, await searchCatalog(query), true);
      return true;
    }

    if (url.pathname === "/api/doc") {
      json(res, 200, await searchDocs(query), true);
      return true;
    }

    if (url.pathname === "/api/movies") {
      json(res, 200, await searchMovies(query));
      return true;
    }

    if (url.pathname === "/api/anime") {
      json(res, 200, await searchAnime(query));
      return true;
    }

    if (url.pathname === "/api/music_deezer") {
      json(res, 200, await searchDeezer(query));
      return true;
    }
  } catch (error) {
    json(res, 502, { error: error.message || "Upstream request failed." });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method !== "GET") {
    text(res, 405, "Method not allowed");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (!handled) {
      json(res, 404, { error: "API route not found." });
    }
    return;
  }

  const filePath = safeFilePath(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    text(res, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": mimeTypes[extension] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(config.port, () => {
  console.log(`Hoovi running at http://localhost:${config.port}`);
});
