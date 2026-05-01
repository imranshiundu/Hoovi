const state = {
  query: "open source",
  view: document.body.dataset.view || "catalog",
  page: 1,
  pageSize: 12,
  items: [],
  sourceStats: null,
  status: null,
  syncing: false,
};

const elements = {
  modalContent: document.getElementById("modal-content"),
  modalOverlay: document.getElementById("modal-overlay"),
  picksGrid: document.getElementById("picks-grid"),
  picksMeta: document.getElementById("picks-meta"),
  queryBtn: document.getElementById("query-btn"),
  queryInput: document.getElementById("query-input"),
  statusPill: document.getElementById("status-pill"),
  toastStack: document.getElementById("toast-stack"),
  topNav: document.getElementById("top-nav"),
  catalogTitle: document.getElementById("catalog-title"),
  pagePrev: document.getElementById("page-prev"),
  pageNext: document.getElementById("page-next"),
  pageInfo: document.getElementById("page-info"),
  paginationBar: document.getElementById("pagination-bar"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

function showToast(title, copy) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<div class="toast-title">${escapeHtml(title)}</div><div class="toast-copy">${escapeHtml(copy)}</div>`;
  elements.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function setSyncState(syncing) {
  state.syncing = syncing;
  elements.statusPill.textContent = syncing ? "Fetching Data..." : "Ready";
}

function openUrl(url) {
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function downloadResource(url) {
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "";
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function hasUrl(url) {
  return typeof url === "string" && url.trim().length > 0;
}

function renderStatus() {
  if (state.status) {
    const connectorCount = state.status.registry?.connectorCount || 0;
    elements.statusPill.textContent = state.syncing
      ? "Fetching..."
      : `Connected: ${state.status.enabledCount} engines · ${connectorCount} pack connectors`;
  }
}

function renderPicks(items) {
  const stats = state.sourceStats;
  elements.picksMeta.textContent = stats
    ? `${items.length} records · APIs ${stats.total} · Connected ${stats.connected} · Failing ${stats.failing} · Keys ${stats.keys}`
    : `${items.length} live database records found.`;
  
  const start = (state.page - 1) * state.pageSize;
  const pageItems = items.slice(start, start + state.pageSize);
  
  elements.pageInfo.textContent = `Page ${state.page} of ${Math.ceil(items.length / state.pageSize) || 1}`;
  elements.pagePrev.disabled = state.page === 1;
  elements.pageNext.disabled = start + state.pageSize >= items.length;

  elements.picksGrid.innerHTML = pageItems.map((item, index) => {
    const globalIndex = start + index;
    const thumbnailHtml = item.thumbnail ? `<div class="pick-thumb"><img src="${escapeHtml(item.thumbnail)}" alt="Thumbnail" loading="lazy"></div>` : '';
    const openButton = hasUrl(item.externalUrl)
      ? `<button class="mini-btn" type="button" data-action="launch-pick" data-index="${globalIndex}">Open Source</button>`
      : `<button class="mini-btn" type="button" disabled>No Source</button>`;
    const downloadButton = hasUrl(item.downloadUrl)
      ? `<button class="mini-btn primary" type="button" data-action="download-pick" data-index="${globalIndex}">Download</button>`
      : `<button class="mini-btn" type="button" disabled>No File</button>`;
    
    return `
      <article class="pick-card" data-index="${globalIndex}">
        <div class="pick-head">
          <span class="source-chip warm">${escapeHtml(item.source)}</span>
          <span class="pick-score">${escapeHtml(item.meta || "")}</span>
        </div>
        ${thumbnailHtml}
        <div>
          <div class="pick-title">${escapeHtml(item.title)}</div>
          <div class="pick-subtitle">${escapeHtml(item.subtitle)}</div>
        </div>
        <div class="pick-summary">${escapeHtml(item.description || item.summary || "")}</div>
        <div class="pick-actions">
          <button class="mini-btn" type="button" data-action="open-pick" data-index="${globalIndex}">Inspect</button>
          ${openButton}
          ${downloadButton}
        </div>
      </article>
    `;
  }).join("");
}

function renderLoading() {
  const skeletons = Array.from({ length: 8 }, () => `<div class="skeleton"></div>`).join("");
  elements.picksGrid.innerHTML = skeletons;
}

async function fetchStatus() {
  try {
    const response = await fetch("/api/status");
    state.status = await response.json();
    renderStatus();
  } catch (err) {}
}

async function reloadDataRegistry() {
  const response = await fetch("/api/reload-data");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Could not reload /data.");
  }
  return data;
}

async function fetchDashboard(query = state.query) {
  setSyncState(true);
  renderLoading();

  try {
    let endpoint = "";
    if (state.view === "catalog") endpoint = `/api/catalog?q=${encodeURIComponent(query)}`;
    else if (state.view === "movies") endpoint = `/api/movies?q=${encodeURIComponent(query)}`;
    else if (state.view === "anime") endpoint = `/api/anime?q=${encodeURIComponent(query)}`;
    else if (state.view === "music") endpoint = `/api/music?q=${encodeURIComponent(query)}`;
    else if (state.view === "books") endpoint = `/api/doc?q=${encodeURIComponent(query)}`;
    else if (state.view === "code") endpoint = `/api/code?q=${encodeURIComponent(query)}`;
    else if (state.view === "images") endpoint = `/api/image?q=${encodeURIComponent(query)}`;
    else if (state.view === "videos") endpoint = `/api/video?q=${encodeURIComponent(query)}`;
    else if (state.view === "packs") endpoint = `/api/packs?q=${encodeURIComponent(query)}`;

    // Default catch-all
    if (!endpoint) endpoint = `/api/catalog?q=${encodeURIComponent(query)}`;

    const response = await fetch(endpoint);
    const data = await response.json();
    
    if (!response.ok || data.error) {
      throw new Error(data.error || `Server responded with ${response.status}`);
    }
    
    state.items = data.items || [];
    state.sourceStats = data.sourceStats || null;
    elements.catalogTitle.textContent = `${state.view.charAt(0).toUpperCase() + state.view.slice(1)} Results`;
    state.page = 1;
    renderPicks(state.items);
  } catch (error) {
    showToast("Database error", error.message || "Could not load data.");
    elements.picksGrid.innerHTML = '<p style="color:var(--muted)">No data found or an error occurred.</p>';
  } finally {
    setSyncState(false);
    renderStatus();
  }
}

function openModal(index) {
  const item = state.items[index];
  if (!item) return;

  const sourceRow = hasUrl(item.externalUrl)
    ? `<div class="modal-meta-item"><label>Source URL</label> <a href="${escapeHtml(item.externalUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${escapeHtml(item.externalUrl)}</a></div>`
    : `<div class="modal-meta-item"><label>Source URL</label> Not provided by this connector</div>`;
  const downloadRow = hasUrl(item.downloadUrl)
    ? `<div class="modal-meta-item"><label>Download URL</label> <a href="${escapeHtml(item.downloadUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${escapeHtml(item.downloadUrl)}</a></div>`
    : `<div class="modal-meta-item"><label>Download URL</label> No direct file exposed</div>`;
  const openButton = hasUrl(item.externalUrl)
    ? `<button class="mini-btn" type="button" data-action="launch-pick" data-index="${index}">Open Source</button>`
    : "";
  const downloadButton = hasUrl(item.downloadUrl)
    ? `<button class="mini-btn primary" type="button" data-action="download-pick" data-index="${index}">Download File</button>`
    : "";

  elements.modalContent.innerHTML = `
    <button class="modal-close" type="button" data-action="close-modal">×</button>
    <div class="modal-type">${escapeHtml(item.source)}</div>
    <h2 class="modal-title">${escapeHtml(item.title)}</h2>
    <div class="modal-copy">${escapeHtml(item.description || item.summary || "")}</div>
    <div class="modal-meta-grid" style="margin-top:16px;">
      <div class="modal-meta-item"><label>Category</label> ${escapeHtml(item.subtitle)}</div>
      ${sourceRow}
      ${downloadRow}
    </div>
    <div class="modal-actions" style="margin-top:24px;">
      ${openButton}
      ${downloadButton}
    </div>
  `;
  elements.modalOverlay.classList.add("open");
}

function closeModal(event) {
  if (!event || event.target === elements.modalOverlay) {
    elements.modalOverlay.classList.remove("open");
  }
}

function handleAction(action, index, url) {
  if (action === "close-modal") return closeModal();
  if (action === "open-pick") return openModal(index);
  if (action === "launch-pick") {
    const item = state.items[index];
    if (item?.externalUrl) openUrl(item.externalUrl);
    return;
  }
  if (action === "download-pick") {
    const item = state.items[index];
    if (item?.downloadUrl) downloadResource(item.downloadUrl);
    return;
  }
  if (action === "open-url" && url) openUrl(url);
}

function bindEvents() {
  elements.queryBtn.addEventListener("click", () => {
    const nextQuery = elements.queryInput.value.trim();
    if (nextQuery) {
      state.query = nextQuery;
      fetchDashboard(nextQuery);
    }
  });

  elements.queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const nextQuery = elements.queryInput.value.trim();
      if (nextQuery) {
        state.query = nextQuery;
        fetchDashboard(nextQuery);
      }
    }
  });

  elements.pagePrev.addEventListener("click", () => {
    if (state.page > 1) {
      state.page--;
      renderPicks(state.items);
    }
  });

  elements.pageNext.addEventListener("click", () => {
    if (state.page * state.pageSize < state.items.length) {
      state.page++;
      renderPicks(state.items);
    }
  });



  elements.statusPill.addEventListener("click", async () => {
    try {
      setSyncState(true);
      await reloadDataRegistry();
      await fetchStatus();
      await fetchDashboard(state.query);
      showToast("Data registry reloaded", "Hoovi rescanned /data and refreshed the live connector registry.");
    } catch (error) {
      showToast("Reload failed", error.message || "Could not reload /data.");
    } finally {
      setSyncState(false);
      renderStatus();
    }
  });

  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action], .action-open");
    if (!target) return;
    if (target.classList.contains("action-open")) {
      openUrl(target.dataset.url);
      return;
    }
    handleAction(target.dataset.action, Number(target.dataset.index), target.dataset.url);
  });

  elements.modalOverlay.addEventListener("click", (event) => {
    if (event.target === elements.modalOverlay) closeModal(event);
  });
}

async function init() {
  elements.queryInput.value = state.query;
  bindEvents();
  await fetchStatus();
  await fetchDashboard(state.query);
}

init();
