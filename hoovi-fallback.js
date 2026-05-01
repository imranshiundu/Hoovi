(() => {
  const originalFetch = window.fetch.bind(window);
  const publicApiPaths = new Set(["/api/status", "/api/reload-data", "/api/image", "/api/video"]);

  function isHooviApiRequest(resource) {
    const raw = typeof resource === "string" ? resource : resource?.url;
    if (!raw) return false;
    try {
      const url = new URL(raw, window.location.origin);
      return url.origin === window.location.origin && publicApiPaths.has(url.pathname);
    } catch {
      return false;
    }
  }

  function asJsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300"
      }
    });
  }

  function getRequestUrl(resource) {
    return new URL(typeof resource === "string" ? resource : resource.url, window.location.origin);
  }

  function stripHtml(value) {
    const node = document.createElement("div");
    node.innerHTML = String(value || "");
    return (node.textContent || node.innerText || "").trim();
  }

  function numberShort(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return "0";
    if (numeric >= 1000000) return `${(numeric / 1000000).toFixed(1)}m`;
    if (numeric >= 1000) return `${(numeric / 1000).toFixed(1)}k`;
    return String(Math.round(numeric));
  }

  function extractYear(value) {
    const match = String(value || "").match(/\b(18|19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  }

  function sourceStats(total, connected, failing = 0) {
    return { total, connected, failing, keys: 0 };
  }

  async function fetchJson(url) {
    const response = await originalFetch(url, {
      headers: { "accept": "application/json" }
    });
    if (!response.ok) throw new Error(`Public source failed with ${response.status}`);
    return response.json();
  }

  async function searchCommonsImages(query) {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("generator", "search");
    url.searchParams.set("gsrnamespace", "6");
    url.searchParams.set("gsrlimit", "24");
    url.searchParams.set("gsrsearch", query || "open source");
    url.searchParams.set("prop", "imageinfo|info");
    url.searchParams.set("iiprop", "url|mime|size|extmetadata");
    url.searchParams.set("inprop", "url");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");

    const data = await fetchJson(url);
    const pages = Object.values(data.query?.pages || {});
    return pages.map((page) => {
      const info = page.imageinfo?.[0] || {};
      const description = info.extmetadata?.ImageDescription?.value || page.title || "Wikimedia Commons image";
      return {
        id: String(page.pageid || page.title),
        type: "image",
        source: "Wikimedia Commons",
        kind: "image",
        title: String(page.title || "Commons image").replace(/^File:/, ""),
        subtitle: info.mime || "public image",
        thumbnail: info.url || null,
        externalUrl: page.fullurl || null,
        downloadUrl: info.url || null,
        previewUrl: info.url || null,
        meta: info.width && info.height ? `${info.width}x${info.height}` : "Image file",
        description: stripHtml(description),
        score: Number(info.size || 0),
        metricLabel: "Size",
        metricValue: numberShort(info.size || 0),
        tags: ["image", "downloadable", "public", "no-key"]
      };
    }).filter((item) => item.downloadUrl);
  }

  async function searchArchiveVideos(query) {
    const url = new URL("https://archive.org/advancedsearch.php");
    url.searchParams.set("q", `(${query || "open source"}) AND mediatype:movies AND year:[2000 TO 9999]`);
    url.searchParams.set("output", "json");
    url.searchParams.set("rows", "24");
    ["identifier", "title", "description", "year", "creator", "downloads", "mediatype"].forEach((field) => {
      url.searchParams.append("fl[]", field);
    });

    const data = await fetchJson(url);
    const docs = data.response?.docs || [];
    return docs.map((doc) => {
      const identifier = doc.identifier;
      const year = extractYear(doc.year);
      return {
        id: identifier,
        type: "video",
        source: "Internet Archive Moving Image",
        kind: "video",
        title: doc.title || identifier,
        subtitle: Array.isArray(doc.creator) ? doc.creator.join(", ") : (doc.creator || "public video"),
        thumbnail: identifier ? `https://archive.org/services/img/${encodeURIComponent(identifier)}` : null,
        externalUrl: identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : null,
        downloadUrl: identifier ? `https://archive.org/download/${encodeURIComponent(identifier)}` : null,
        previewUrl: null,
        releaseDate: year ? String(year) : null,
        releaseYear: year,
        meta: year ? `Year ${year}` : "Public video",
        description: stripHtml(doc.description) || `Internet Archive video result for "${query}".`,
        score: Number(doc.downloads || 0),
        metricLabel: "Downloads",
        metricValue: numberShort(doc.downloads || 0),
        tags: ["video", "downloadable", "public", "no-key"]
      };
    }).filter((item) => item.id);
  }

  async function fallbackResponse(resource) {
    const url = getRequestUrl(resource);
    const query = url.searchParams.get("q") || "open source";

    if (url.pathname === "/api/status") {
      return asJsonResponse({
        ok: true,
        mode: "browser-no-key-fallback",
        enabledCount: 2,
        registry: { connectorCount: 2, packCount: 0, catalogRecords: 2 },
        warnings: ["Backend API was not available, so Hoovi is using no-key public browser sources."]
      });
    }

    if (url.pathname === "/api/reload-data") {
      return asJsonResponse({ ok: true, mode: "browser-no-key-fallback", reloaded: false });
    }

    if (url.pathname === "/api/image") {
      const items = await searchCommonsImages(query);
      return asJsonResponse({ items, sourceStats: sourceStats(1, items.length ? 1 : 0) });
    }

    if (url.pathname === "/api/video") {
      const items = await searchArchiveVideos(query);
      return asJsonResponse({ items, sourceStats: sourceStats(1, items.length ? 1 : 0) });
    }

    return asJsonResponse({ items: [], sourceStats: sourceStats(0, 0, 1) }, 404);
  }

  window.fetch = async function hooviFetch(resource, options) {
    if (!isHooviApiRequest(resource)) {
      return originalFetch(resource, options);
    }

    try {
      const response = await originalFetch(resource, options);
      const contentType = response.headers.get("content-type") || "";
      if (response.ok && contentType.includes("application/json")) {
        return response;
      }
    } catch {
      // Static hosts such as Netlify may not have /api routes. Fall through to public sources.
    }

    return fallbackResponse(resource);
  };
})();
