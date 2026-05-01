const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
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
};

const apiCache = new Map();
const registry = createEmptyRegistry();

loadDataRegistry();

function createEmptyRegistry() {
  return {
    catalogRecords: [],
    connectors: new Map(),
    packs: [],
    warnings: [],
    stats: {
      filesLoaded: 0,
      filesIgnored: 0,
      catalogRecords: 0,
      connectorCount: 0,
      packCount: 0,
    },
  };
}

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

function resetRegistry() {
  registry.catalogRecords = [];
  registry.connectors = new Map();
  registry.packs = [];
  registry.warnings = [];
  registry.stats = {
    filesLoaded: 0,
    filesIgnored: 0,
    catalogRecords: 0,
    connectorCount: 0,
    packCount: 0,
  };
}

function loadDataRegistry() {
  resetRegistry();

  if (!fs.existsSync(dataDir)) {
    return;
  }

  const files = fs.readdirSync(dataDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  files.forEach((file) => {
    if (file.endsWith(".example.json")) {
      registry.stats.filesIgnored += 1;
      return;
    }

    try {
      const fullPath = path.join(dataDir, file);
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      ingestDataFile(parsed, file);
      registry.stats.filesLoaded += 1;
    } catch (error) {
      registry.warnings.push(`Failed to parse ${file}: ${error.message}`);
    }
  });

  registry.stats.catalogRecords = registry.catalogRecords.length;
  registry.stats.connectorCount = registry.connectors.size;
  registry.stats.packCount = registry.packs.length;
  console.log(`Loaded ${registry.stats.catalogRecords} catalog rows and ${registry.stats.connectorCount} connectors from /data.`);
}

function ingestDataFile(data, sourceFile) {
  if (isHooviPack(data)) {
    ingestHooviPack(data, sourceFile);
    return;
  }

  if (isLegacyCatalog(data)) {
    ingestLegacyCatalog(data, sourceFile);
    return;
  }

  recursiveExtract(data, sourceFile, "generic-json");
}

function isHooviPack(data) {
  return Boolean(
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    (
      data.hoovi_version === 2 ||
      data.hoovi_pack === true ||
      Array.isArray(data.connectors) ||
      data.pack
    )
  );
}

function isLegacyCatalog(data) {
  return Boolean(
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Array.isArray(data.entries)
  );
}

function ingestLegacyCatalog(data, sourceFile) {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  registry.packs.push({
    id: `legacy:${sourceFile}`,
    name: data.project || sourceFile,
    sourceFile,
    type: "legacy-catalog",
    connectorCount: 0,
    catalogRecordCount: entries.length,
    credentialKeys: [],
    notes: "Legacy Hoovi catalog file.",
  });

  entries.forEach((entry) => addCatalogRecord({
    id: entry.id || `legacy-${Math.random().toString(36).slice(2)}`,
    name: entry.name || "Unknown source",
    category: normalizeCategory(entry.category || entry.sub_category || "Catalog"),
    description: entry.description || "Imported from legacy catalog.",
    documentationUrl: entry.documentation_url || entry.base_or_example_url || null,
    url: entry.base_or_example_url || entry.documentation_url || null,
    auth: entry.auth || "Unknown",
    sourceFile,
    sourceType: entry.source_type || "legacy-catalog-entry",
    recommendedForFrontend: entry.recommended_for_frontend,
    recommendedForBackendProxy: entry.recommended_for_backend_proxy,
    keyNote: entry.key_note || null,
    status: entry.status || "legacy",
  }));
}

function ingestHooviPack(data, sourceFile) {
  const pack = data.pack && typeof data.pack === "object" ? data.pack : {};
  const credentials = data.credentials && typeof data.credentials === "object" ? data.credentials : {};
  const packMeta = {
    id: pack.id || sourceFile.replace(/\.json$/i, ""),
    name: pack.name || sourceFile,
    sourceFile,
    type: "data-pack",
    connectorCount: 0,
    catalogRecordCount: 0,
    credentialKeys: Object.keys(credentials),
    notes: pack.description || "Drop-in Hoovi data pack.",
  };

  if (Array.isArray(data.links)) {
    data.links.forEach((entry) => recursiveExtract(entry, sourceFile, "pack-links"));
  }

  if (Array.isArray(data.entries)) {
    data.entries.forEach((entry) => recursiveExtract(entry, sourceFile, "pack-entries"));
  }

  if (Array.isArray(data.connectors)) {
    data.connectors.forEach((connector, index) => {
      const normalized = normalizeConnector(connector, {
        sourceFile,
        packId: packMeta.id,
        packName: packMeta.name,
        credentials,
        index,
      });

      if (!normalized) {
        registry.warnings.push(`Skipped invalid connector #${index} in ${sourceFile}.`);
        return;
      }

      registry.connectors.set(normalized.id, normalized);
      packMeta.connectorCount += 1;
    });
  }

  packMeta.catalogRecordCount = registry.catalogRecords.filter((record) => record.sourceFile === sourceFile).length;
  registry.packs.push(packMeta);
}

function normalizeConnector(input, context) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const request = input.request && typeof input.request === "object" ? input.request : {};
  const response = input.response && typeof input.response === "object" ? input.response : {};
  if (!input.id || !request.url) {
    return null;
  }

  return {
    id: String(input.id),
    name: input.name || input.id,
    source: input.source || input.name || input.id,
    category: normalizeCategory(input.category || "custom"),
    kind: input.kind || "resource",
    description: input.description || "User-defined Hoovi connector.",
    enabled: input.enabled !== false,
    tags: Array.isArray(input.tags) ? input.tags : [],
    auth: normalizeAuth(input.auth),
    request: {
      url: request.url,
      method: request.method || "GET",
      queryParam: request.query_param === false ? null : (request.query_param || "q"),
      queryTemplate: request.query_template || null,
      staticParams: request.static_params && typeof request.static_params === "object" ? request.static_params : {},
      headers: request.headers && typeof request.headers === "object" ? request.headers : {},
    },
    response: {
      itemsPath: response.items_path || "$",
      itemsMode: response.items_mode || "array",
      mappings: response.mappings && typeof response.mappings === "object" ? response.mappings : {},
      templates: response.templates && typeof response.templates === "object" ? response.templates : {},
    },
    credentials: context.credentials,
    sourceFile: context.sourceFile,
    packId: context.packId,
    packName: context.packName,
  };
}

function normalizeAuth(auth) {
  if (!auth || typeof auth !== "object") {
    return { type: "none" };
  }

  return {
    type: auth.type || "none",
    name: auth.name || auth.param || auth.header || null,
    prefix: auth.prefix || "",
    value: auth.value || null,
    env: auth.env || null,
    credentialKey: auth.credential_key || null,
  };
}

function normalizeCategory(value) {
  return String(value || "Catalog").trim();
}

function addCatalogRecord(record) {
  registry.catalogRecords.push(record);
}

function recursiveExtract(data, sourceFile, sourceType) {
  if (Array.isArray(data)) {
    data.forEach((item) => recursiveExtract(item, sourceFile, sourceType));
    return;
  }

  if (typeof data === "string") {
    normalizeAndAddEntry(data, sourceFile, sourceType);
    return;
  }

  if (!data || typeof data !== "object") {
    return;
  }

  if (data.url || data.link || data.api || data.API || data.endpoint || data.documentation_url || data.name) {
    normalizeAndAddEntry(data, sourceFile, sourceType);
    return;
  }

  Object.values(data).forEach((value) => recursiveExtract(value, sourceFile, sourceType));
}

function normalizeAndAddEntry(entry, sourceFile, sourceType) {
  if (!entry) {
    return;
  }

  if (typeof entry === "string") {
    if (entry.startsWith("http://") || entry.startsWith("https://")) {
      let hostname = "Unknown API";
      try {
        hostname = new URL(entry).hostname;
      } catch {
        // Ignore URL parse errors.
      }

      addCatalogRecord({
        id: `auto-${Math.random().toString(36).slice(2)}`,
        name: hostname,
        category: "Extracted Link",
        description: "Link extracted from JSON file.",
        documentationUrl: entry,
        url: entry,
        auth: "Unknown",
        sourceFile,
        sourceType,
        recommendedForFrontend: false,
        recommendedForBackendProxy: true,
        keyNote: "Imported from a link-only JSON payload.",
        status: "imported-link",
      });
    }
    return;
  }

  const url = entry.url || entry.link || entry.api || entry.endpoint || entry.documentation_url || entry.base_or_example_url || null;
  let name = entry.name || entry.title || entry.API || entry.id || null;

  if (!name && url) {
    try {
      name = new URL(url).hostname;
    } catch {
      name = "Unknown API";
    }
  }

  if (!url && !name) {
    return;
  }

  addCatalogRecord({
    id: entry.id || `auto-${Math.random().toString(36).slice(2)}`,
    name: name || "Unknown API",
    category: normalizeCategory(entry.category || entry.type || entry.sub_category || "Catalog"),
    description: entry.description || entry.desc || "Imported from data folder.",
    documentationUrl: entry.documentation_url || url,
    url,
    auth: entry.auth || entry.Auth || "Unknown",
    sourceFile,
    sourceType,
    recommendedForFrontend: entry.recommended_for_frontend,
    recommendedForBackendProxy: entry.recommended_for_backend_proxy,
    keyNote: entry.key_note || null,
    status: entry.status || "imported",
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

async function fetchJson(url, options = {}) {
  const cacheKey = url.toString() + JSON.stringify(options);
  const cached = apiCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.data;
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Upstream request failed with ${response.status}`);
  }

  const data = await response.json();
  apiCache.set(cacheKey, { timestamp: Date.now(), data });
  return data;
}

function getByPath(target, pathExpression) {
  if (pathExpression === undefined || pathExpression === null || pathExpression === "") {
    return undefined;
  }

  if (pathExpression === "$") {
    return target;
  }

  const pathParts = String(pathExpression).split(".");
  let current = target;

  for (const part of pathParts) {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      if (/^\d+$/.test(part)) {
        current = current[Number(part)];
        continue;
      }

      current = current.map((item) => item?.[part]).filter((value) => value !== undefined);
      continue;
    }

    current = current[part];
  }

  return current;
}

function toText(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, "").trim();
}

function renderTemplate(template, item) {
  return String(template || "").replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, expression) => {
    return toText(getByPath(item, expression.trim()));
  }).trim();
}

function resolveSecret(auth, connector) {
  if (auth.value) {
    return auth.value;
  }

  if (auth.env && process.env[auth.env]) {
    return process.env[auth.env];
  }

  if (auth.credentialKey && connector.credentials?.[auth.credentialKey]) {
    return connector.credentials[auth.credentialKey];
  }

  return "";
}

async function runGenericConnector(connector, query) {
  if (!connector.enabled) {
    return { connector: connector.id, items: [], skipped: true };
  }

  const url = new URL(connector.request.url);
  if (connector.request.queryParam) {
    const queryValue = connector.request.queryTemplate
      ? connector.request.queryTemplate.replace(/\{\{\s*query\s*\}\}/g, query)
      : query;
    url.searchParams.set(connector.request.queryParam, queryValue);
  }

  Object.entries(connector.request.staticParams).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
      return;
    }

    url.searchParams.set(key, String(value));
  });

  const headers = {};
  Object.entries(connector.request.headers).forEach(([key, value]) => {
    headers[key] = String(value);
  });

  if (connector.auth.type !== "none") {
    const secret = resolveSecret(connector.auth, connector);
    if (!secret) {
      throw new Error(`Missing secret for connector ${connector.id}.`);
    }

    if (connector.auth.type === "query" && connector.auth.name) {
      url.searchParams.set(connector.auth.name, `${connector.auth.prefix}${secret}`);
    }

    if (connector.auth.type === "header" && connector.auth.name) {
      headers[connector.auth.name] = `${connector.auth.prefix}${secret}`;
    }
  }

  const payload = await fetchJson(url.toString(), {
    method: connector.request.method,
    headers,
  });

  const rawItems = extractItems(payload, connector.response.itemsPath, connector.response.itemsMode);
  return {
    connector: connector.id,
    items: rawItems.map((item, index) => applyCategoryPolicy(normalizeConnectorItem(connector, item, index))),
  };
}

function extractItems(payload, itemsPath, itemsMode = "array") {
  const selected = itemsPath === "$" ? payload : getByPath(payload, itemsPath);
  if (itemsMode === "object_values" && selected && typeof selected === "object" && !Array.isArray(selected)) {
    return Object.values(selected);
  }

  if (Array.isArray(selected)) {
    return selected;
  }

  if (selected && typeof selected === "object") {
    return [selected];
  }

  return [];
}

function resolveMapping(mappingSpec, rawItem) {
  if (mappingSpec === undefined || mappingSpec === null) {
    return undefined;
  }

  if (typeof mappingSpec === "string") {
    return getByPath(rawItem, mappingSpec);
  }

  if (typeof mappingSpec === "object") {
    if (mappingSpec.path) {
      const result = getByPath(rawItem, mappingSpec.path);
      if (result !== undefined && result !== null && result !== "") {
        return result;
      }
    }

    if (mappingSpec.template) {
      return renderTemplate(mappingSpec.template, rawItem);
    }

    if (mappingSpec.literal !== undefined) {
      return mappingSpec.literal;
    }
  }

  return undefined;
}

function normalizeConnectorItem(connector, rawItem, index) {
  const mappings = connector.response.mappings;
  const templates = connector.response.templates;

  const id = toText(resolveMapping(mappings.id, rawItem)) || `${connector.id}-${index}`;
  const title = toText(resolveMapping(mappings.title, rawItem)) || `${connector.name} result ${index + 1}`;
  const subtitle = toText(resolveMapping(mappings.subtitle, rawItem)) || connector.category;
  const summaryValue = resolveMapping(mappings.summary, rawItem);
  const metaValue = resolveMapping(mappings.meta, rawItem);
  const dateValue = toText(
    resolveMapping(mappings.release_date, rawItem) ||
    resolveMapping(mappings.published_at, rawItem) ||
    resolveMapping(mappings.date, rawItem) ||
    resolveMapping(mappings.year, rawItem)
  );
  const viewUrl = toText(
    resolveMapping(mappings.external_url, rawItem) ||
    resolveMapping(mappings.view_url, rawItem) ||
    resolveMapping(mappings.url, rawItem) ||
    renderTemplate(templates.external_url, rawItem)
  ) || null;
  const downloadUrl = toText(
    resolveMapping(mappings.download_url, rawItem) ||
    resolveMapping(mappings.downloadUrl, rawItem) ||
    resolveMapping(mappings.file_url, rawItem) ||
    renderTemplate(templates.download_url, rawItem)
  ) || null;
  const thumbnail = toText(resolveMapping(mappings.thumbnail, rawItem)) || null;
  const score = Number(resolveMapping(mappings.score, rawItem) || 0);
  const metricLabel = toText(resolveMapping(mappings.metric_label, rawItem)) || "Score";
  const metricValue = toText(resolveMapping(mappings.metric_value, rawItem)) || (score ? numberShort(score) : "");

  return {
    id,
    type: connector.category.toLowerCase(),
    source: connector.source,
    kind: connector.kind,
    title,
    subtitle,
    summary: stripHtml(summaryValue ? toText(summaryValue) : renderTemplate(templates.summary, rawItem) || connector.description),
    description: stripHtml(summaryValue ? toText(summaryValue) : renderTemplate(templates.summary, rawItem) || connector.description),
    externalUrl: cleanUrl(viewUrl),
    downloadUrl: cleanUrl(downloadUrl),
    previewUrl: null,
    thumbnail,
    meta: stripHtml(metaValue ? toText(metaValue) : renderTemplate(templates.meta, rawItem)),
    releaseDate: dateValue || null,
    releaseYear: extractYear(dateValue || metaValue),
    tags: connector.tags,
    metricLabel,
    metricValue,
    score,
    connectorId: connector.id,
    packId: connector.packId,
  };
}

function cleanUrl(value) {
  const text = toText(value).trim();
  if (!text || text.endsWith("=") || text.includes("{{")) {
    return null;
  }

  return text;
}

function extractYear(value) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function applyCategoryPolicy(item) {
  if (!item) {
    return item;
  }

  const type = String(item.type || "").toLowerCase();
  if ((type === "music" || type === "song" || type === "audio") && item.releaseYear && item.releaseYear < 2005) {
    return { ...item, excludedByPolicy: true };
  }

  if ((type === "movies" || type === "movie" || type === "video" || type === "videos") && item.releaseYear && item.releaseYear < 2000) {
    return { ...item, excludedByPolicy: true };
  }

  return item;
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

function pickLastfmImage(images = []) {
  const reversed = [...images].reverse();
  const match = reversed.find((image) => image["#text"]);
  return match ? match["#text"] : null;
}

async function searchArchiveMedia(query, options) {
  const url = new URL("https://archive.org/advancedsearch.php");
  const archiveQuery = `(${query}) AND mediatype:${options.mediaType} AND year:[${options.yearFrom} TO 9999]`;
  url.searchParams.set("q", archiveQuery);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", "12");
  ["identifier", "title", "description", "year", "creator", "downloads"].forEach((field) => {
    url.searchParams.append("fl[]", field);
  });

  const data = await fetchJson(url.toString());
  const docs = data.response?.docs || [];

  return {
    items: docs.map((doc) => {
      const identifier = doc.identifier;
      const year = extractYear(doc.year);
      return {
        id: identifier,
        type: options.type,
        source: options.source,
        kind: options.kind,
        title: doc.title || identifier,
        subtitle: toText(doc.creator) || options.subtitle,
        thumbnail: identifier ? `https://archive.org/services/img/${encodeURIComponent(identifier)}` : null,
        externalUrl: identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : null,
        downloadUrl: identifier ? `/api/download?source=archive&media=${encodeURIComponent(options.media)}&ia=${encodeURIComponent(identifier)}` : null,
        previewUrl: null,
        releaseDate: year ? String(year) : null,
        releaseYear: year,
        meta: year ? `Year ${year}` : options.subtitle,
        description: stripHtml(toText(doc.description)) || `${options.source} result for "${query}".`,
        score: Number(doc.downloads || 0),
        metricLabel: "Downloads",
        metricValue: numberShort(Number(doc.downloads || 0)),
        tags: [options.mediaType, "downloadable", "public"],
      };
    }).filter((item) => !applyCategoryPolicy(item).excludedByPolicy),
  };
}

async function searchCommonsImages(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "12");
  url.searchParams.set("gsrsearch", query);
  url.searchParams.set("prop", "imageinfo|info");
  url.searchParams.set("iiprop", "url|mime|size|extmetadata");
  url.searchParams.set("inprop", "url");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const data = await fetchJson(url.toString());
  const pages = Object.values(data.query?.pages || {});

  return {
    items: pages.map((page) => {
      const imageInfo = page.imageinfo?.[0] || {};
      const description = imageInfo.extmetadata?.ImageDescription?.value || page.title;
      return {
        id: String(page.pageid || page.title),
        type: "image",
        source: "Wikimedia Commons",
        kind: "image",
        title: page.title?.replace(/^File:/, "") || "Commons image",
        subtitle: imageInfo.mime || "public image",
        thumbnail: imageInfo.url || null,
        externalUrl: page.fullurl || null,
        downloadUrl: imageInfo.url || null,
        previewUrl: imageInfo.url || null,
        meta: imageInfo.width && imageInfo.height ? `${imageInfo.width}x${imageInfo.height}` : "Image file",
        description: stripHtml(description),
        tags: ["image", "downloadable", "public"],
      };
    }).filter((item) => item.downloadUrl),
  };
}

async function searchGitHubRepos(query) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "12");

  const data = await fetchJson(url.toString(), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Hoovi",
    },
  });

  return (data.items || []).map((repo) => ({
    id: String(repo.id),
    type: "code",
    source: "GitHub",
    kind: "repo",
    title: repo.name,
    subtitle: `${repo.owner?.login || "unknown"} · ${repo.language || "mixed"}`,
    summary: repo.description || "Repository match from GitHub search.",
    description: repo.description || "Repository match from GitHub search.",
    externalUrl: repo.html_url,
    downloadUrl: `https://github.com/${repo.full_name}/archive/refs/heads/${repo.default_branch || "main"}.zip`,
    previewUrl: null,
    thumbnail: null,
    meta: `Stars ${numberShort(repo.stargazers_count || 0)}`,
    metricLabel: "Stars",
    metricValue: numberShort(repo.stargazers_count || 0),
    score: repo.stargazers_count || 0,
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

async function searchMusic(query) {
  return searchArchiveMedia(query, {
    mediaType: "audio",
    media: "audio",
    type: "music",
    kind: "song",
    source: "Internet Archive Audio",
    subtitle: "public audio",
    yearFrom: 2005,
  });
}

async function searchImages(query) {
  return searchCommonsImages(query);
}

function pickPexelsVideoFile(files = []) {
  if (!Array.isArray(files) || !files.length) {
    return null;
  }

  const mp4Files = files.filter((file) => file.file_type === "video/mp4");
  const sorted = mp4Files.sort((left, right) => (left.width || 0) - (right.width || 0));
  return sorted[0] || files[0];
}

async function searchVideos(query) {
  return searchArchiveMedia(query, {
    mediaType: "movies",
    media: "video",
    type: "video",
    kind: "video",
    source: "Internet Archive Video",
    subtitle: "public video",
    yearFrom: 2000,
  });
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
      const archiveId = Array.isArray(doc.ia) ? doc.ia[0] : null;

      return {
        id: doc.key || `${doc.title}-${doc.first_publish_year || "unknown"}`,
        type: "doc",
        source: "Open Library",
        title: doc.title,
        subtitle: Array.isArray(doc.author_name) ? doc.author_name.join(", ") : "Unknown author",
        thumbnail: coverUrl,
        externalUrl: workPath,
        downloadUrl: archiveId ? `/api/download?source=openlibrary&ia=${encodeURIComponent(archiveId)}` : null,
        previewUrl: null,
        meta: doc.first_publish_year ? `First published ${doc.first_publish_year}` : "Book record",
        description: `Open Library work record with ${doc.edition_count || 0} edition${doc.edition_count === 1 ? "" : "s"}.`,
      };
    }),
  };
}

async function searchPackConnectors(query, categories = null) {
  const wantedCategories = Array.isArray(categories)
    ? new Set(categories.map((category) => String(category).toLowerCase()))
    : null;
  const connectors = Array.from(registry.connectors.values()).filter((connector) => {
    if (!connector.enabled) {
      return false;
    }

    if (!wantedCategories) {
      return true;
    }

    return wantedCategories.has(String(connector.category).toLowerCase());
  });
  const settled = await Promise.allSettled(connectors.map((connector) => runGenericConnector(connector, query)));
  const items = [];
  const warnings = [];

  settled.forEach((result, index) => {
    const connector = connectors[index];
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      warnings.push(...(result.value.warnings || []));
    } else {
      warnings.push(`${connector.id}: ${result.reason?.message || "failed"}`);
    }
  });

  return {
    items: items.filter((item) => !item.excludedByPolicy),
    warnings,
    providers: settled.map((result, index) => {
      const connector = connectors[index];
      return {
        id: connector.id,
        category: connector.category,
        keyed: connector.auth.type !== "none",
        connected: result.status === "fulfilled",
      };
    }),
  };
}

async function safeNativePayload(id, searcher, query) {
  try {
    const payload = await searcher(query);
    if (payload?.error) {
      return {
        items: [],
        warnings: [payload.error],
        providers: [{ id, keyed: false, connected: false }],
      };
    }

    return {
      items: (payload?.items || []).filter((item) => !item.excludedByPolicy),
      warnings: payload?.warnings || [],
      providers: [{ id, keyed: false, connected: true }],
    };
  } catch (error) {
    return {
      items: [],
      warnings: [error.message || "Native provider failed."],
      providers: [{ id, keyed: false, connected: false }],
    };
  }
}

function mergePayloads(...payloads) {
  const items = [];
  const warnings = [];
  const providers = [];

  payloads.forEach((payload) => {
    items.push(...(payload?.items || []));
    warnings.push(...(payload?.warnings || []));
    providers.push(...(payload?.providers || []));
  });

  return {
    schema: {
      version: "hoovi.normalized.v1",
      fields: ["id", "type", "source", "kind", "title", "subtitle", "description", "externalUrl", "downloadUrl", "thumbnail", "releaseYear", "tags"],
      policies: {
        musicYearFrom: 2005,
        movieYearFrom: 2000,
      },
    },
    items: uniqueByTitle(items),
    warnings,
    sourceStats: {
      total: providers.length,
      connected: providers.filter((provider) => provider.connected).length,
      failing: providers.filter((provider) => !provider.connected).length,
      keys: providers.filter((provider) => provider.keyed).length,
    },
  };
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
        releaseDate: show.premiered || null,
        releaseYear: extractYear(show.premiered),
        meta: show.premiered ? `Premiered ${show.premiered}` : "Show metadata",
        description: stripHtml(show.summary) || "TV show match from TVMaze.",
      };
    }).filter((item) => !applyCategoryPolicy(item).excludedByPolicy),
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
      description: anime.synopsis || "Anime match from Jikan.",
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

function buildStatus() {
  const status = {
    ready: true,
    enabledCount: 0,
    missingKeys: [],
    routes: {
      dashboard: true,
      registry: true,
      connector: true,
      reloadData: true,
      packs: true,
      music: true,
      video: true,
      image: true,
      doc: true,
      catalog: true,
      code: true,
      movies: true,
      anime: true,
      musicDeezer: true,
    },
    sources: {
      keyedProviders: { status: "load from /data private packs" },
      openLibrary: { status: "on" },
      github: { status: "on" },
      npm: { status: "on" },
      hackerNews: { status: "on" },
      devto: { status: "on" },
    },
    registry: {
      packCount: registry.packs.length,
      connectorCount: registry.connectors.size,
      catalogRecords: registry.catalogRecords.length,
      warnings: registry.warnings,
    },
    sourceStats: buildRegistrySourceStats(),
  };

  status.enabledCount = Object.values(status.routes).filter(Boolean).length;
  status.ready = status.enabledCount > 0;
  return status;
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
    briefing: `${all.length} live items across ${coverage.length} active sources. ${docs.length} catalog rows cached. ${registry.connectors.size} custom connectors are ready from /data.`,
    summary: [
      { label: "Live Items", value: String(all.length) },
      { label: "Catalog Rows", value: String(docs.length) },
      { label: "Sources", value: String(coverage.length) },
      { label: "AI Notes", value: String(picks.length + 6) },
      { label: "Pack Connectors", value: String(registry.connectors.size) },
    ],
    picks,
    coverage,
    activity,
    feed,
    quickLinks: [
      { label: "Browse Library", meta: "cards", url: docs[0]?.url || "https://openlibrary.org" },
      { label: "Open Recents", meta: "stream", url: feed[0]?.url || "https://github.com" },
      { label: "Open Registry", meta: "packs", url: "/api/registry" },
      { label: "Edit Settings", meta: "watchlist", url: "https://www.npmjs.com" },
    ],
    notes: [
      { title: "Data Packs", body: "Drop JSON files into /data and reload the registry without changing application code." },
      { title: "Private Packs", body: "Use data/*.private.json for local keys you do not want committed to GitHub." },
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
  const results = registry.catalogRecords.filter((record) => (
    (record.name && record.name.toLowerCase().includes(q)) ||
    (record.description && record.description.toLowerCase().includes(q)) ||
    (record.category && record.category.toLowerCase().includes(q))
  )).slice(0, 100);

  return {
    items: results.map((record) => ({
      id: record.id,
      type: "catalog",
      source: record.sourceFile,
      title: record.name,
      subtitle: record.category,
      thumbnail: null,
      externalUrl: record.url || record.documentationUrl || null,
      downloadUrl: null,
      previewUrl: null,
      meta: `Auth: ${record.auth}`,
      description: record.description,
    })),
  };
}

function buildRegistryPayload() {
  return {
    stats: registry.stats,
    warnings: registry.warnings,
    packs: registry.packs,
    connectors: Array.from(registry.connectors.values()).map((connector) => ({
      id: connector.id,
      name: connector.name,
      source: connector.source,
      category: connector.category,
      kind: connector.kind,
      enabled: connector.enabled,
      packId: connector.packId,
      packName: connector.packName,
      sourceFile: connector.sourceFile,
      authType: connector.auth.type,
      requestUrl: connector.request.url,
      queryParam: connector.request.queryParam,
      tags: connector.tags,
    })),
  };
}

function buildRegistrySourceStats() {
  const connectors = Array.from(registry.connectors.values());
  const credentialCount = registry.packs.reduce((total, pack) => total + (pack.credentialKeys?.length || 0), 0);
  const categoryCounts = connectors.reduce((acc, connector) => {
    const key = String(connector.category || "custom").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    total: connectors.length,
    connected: connectors.filter((connector) => connector.enabled).length,
    failing: connectors.filter((connector) => !connector.enabled).length,
    keys: credentialCount,
    categories: categoryCounts,
  };
}

function chooseArchiveFile(files = [], media = "document") {
  const usable = files.filter((file) => file?.name && !file.name.endsWith("_meta.xml"));
  const fileText = (file) => `${file.format || ""} ${file.name || ""}`;
  const priorityMap = {
    audio: [
      (file) => /mp3|vbr mp3/i.test(fileText(file)) || /\.mp3$/i.test(file.name),
      (file) => /ogg|vorbis/i.test(fileText(file)) || /\.ogg$/i.test(file.name),
      (file) => /flac/i.test(fileText(file)) || /\.flac$/i.test(file.name),
      (file) => /m4a/i.test(fileText(file)) || /\.m4a$/i.test(file.name),
    ],
    video: [
      (file) => /h\.?264|mpeg4|mp4/i.test(fileText(file)) || /\.mp4$/i.test(file.name),
      (file) => /webm/i.test(fileText(file)) || /\.webm$/i.test(file.name),
      (file) => /ogv|ogg video/i.test(fileText(file)) || /\.ogv$/i.test(file.name),
    ],
    document: [
      (file) => /epub/i.test(fileText(file)),
      (file) => /pdf/i.test(fileText(file)),
      (file) => /text/i.test(fileText(file)) || /\.txt$/i.test(file.name),
      (file) => /djvu/i.test(fileText(file)),
    ],
  };
  const priorities = priorityMap[media] || priorityMap.document;

  for (const match of priorities) {
    const found = usable.find(match);
    if (found) {
      return found;
    }
  }

  return usable[0] || null;
}

async function handleDownload(res, url) {
  const directUrl = url.searchParams.get("url");
  const source = url.searchParams.get("source");

  if (directUrl) {
    const parsed = new URL(directUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      json(res, 400, { error: "Only http(s) downloads are supported." });
      return;
    }

    res.writeHead(302, { Location: parsed.toString() });
    res.end();
    return;
  }

  if (source === "openlibrary" || source === "archive") {
    const ia = url.searchParams.get("ia");
    if (!ia) {
      json(res, 400, { error: "Missing Internet Archive identifier." });
      return;
    }

    const media = source === "archive" ? (url.searchParams.get("media") || "document") : "document";
    const metadata = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(ia)}`);
    const file = chooseArchiveFile(metadata.files || [], media);
    if (!file) {
      json(res, 404, { error: "No downloadable file found for this archive record." });
      return;
    }

    const fileUrl = `https://archive.org/download/${encodeURIComponent(ia)}/${encodeURIComponent(file.name)}`;
    res.writeHead(302, { Location: fileUrl });
    res.end();
    return;
  }

  json(res, 400, { error: "Unsupported download request." });
}

async function handleApi(req, res, url) {
  const query = url.searchParams.get("q")?.trim();
  const mode = url.searchParams.get("mode")?.trim() || "personal";

  if (url.pathname === "/api/status") {
    json(res, 200, buildStatus());
    return true;
  }

  if (url.pathname === "/api/reload-data") {
    loadDataRegistry();
    json(res, 200, {
      ok: true,
      message: "Reloaded /data registry.",
      registry: buildRegistryPayload(),
    });
    return true;
  }

  if (url.pathname === "/api/download") {
    try {
      await handleDownload(res, url);
    } catch (error) {
      json(res, 502, { error: error.message || "Download resolution failed." });
    }
    return true;
  }

  if (url.pathname === "/api/registry") {
    json(res, 200, buildRegistryPayload());
    return true;
  }

  if (url.pathname === "/api/connector") {
    const connectorId = url.searchParams.get("id")?.trim();
    if (!connectorId) {
      json(res, 400, { error: "Missing required query parameter `id`." });
      return true;
    }

    const connector = registry.connectors.get(connectorId);
    if (!connector) {
      json(res, 404, { error: `Unknown connector: ${connectorId}` });
      return true;
    }

    try {
      json(res, 200, await runGenericConnector(connector, query || ""));
    } catch (error) {
      json(res, 502, { error: error.message || "Connector execution failed." });
    }
    return true;
  }

  if (url.pathname === "/api/packs") {
    json(res, 200, mergePayloads(await searchPackConnectors(query || "")));
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

  if (!query && !["/api/status", "/api/reload-data", "/api/registry"].includes(url.pathname)) {
    json(res, 400, { error: "Missing required query parameter `q`." });
    return true;
  }

  try {
    if (url.pathname === "/api/music") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("archive-audio-native", searchMusic, query),
        searchPackConnectors(query, ["music"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
      return true;
    }

    if (url.pathname === "/api/image") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("wikimedia-commons-native", searchImages, query),
        searchPackConnectors(query, ["image", "images"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
      return true;
    }

    if (url.pathname === "/api/video") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("archive-video-native", searchVideos, query),
        searchPackConnectors(query, ["video", "videos"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
      return true;
    }

    if (url.pathname === "/api/catalog") {
      const payload = await searchCatalog(query);
      json(res, 200, mergePayloads({
        ...payload,
        providers: [{ id: "hoovi-catalog", keyed: false, connected: true }],
      }));
      return true;
    }

    if (url.pathname === "/api/doc") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("openlibrary-native", searchDocs, query),
        searchPackConnectors(query, ["doc", "docs", "book", "books", "document", "documents"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
      return true;
    }

    if (url.pathname === "/api/code") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("github-native", async (value) => ({ items: await searchGitHubRepos(value) }), query),
        searchPackConnectors(query, ["code", "developer", "software"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
      return true;
    }

    if (url.pathname === "/api/movies") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("tvmaze-native", searchMovies, query),
        searchPackConnectors(query, ["movie", "movies", "tv"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
      return true;
    }

    if (url.pathname === "/api/anime") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("jikan-native", searchAnime, query),
        searchPackConnectors(query, ["anime"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
      return true;
    }

    if (url.pathname === "/api/music_deezer") {
      const [nativePayload, packPayload] = await Promise.all([
        safeNativePayload("archive-audio-native", searchMusic, query),
        searchPackConnectors(query, ["music"]),
      ]);
      json(res, 200, mergePayloads(nativePayload, packPayload));
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
