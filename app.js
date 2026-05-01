const state = {
  query: "open source ai",
  mode: "personal",
  view: "dashboard",
  page: 1,
  pageSize: 12,
  items: [],
  dashboard: null,
  status: null,
  syncing: false,
};

const elements = {
  aiBriefing: document.getElementById("ai-briefing"),
  feedList: document.getElementById("feed-list"),
  heroSummary: document.getElementById("hero-summary"),
  heroTitle: document.getElementById("hero-title"),
  modePill: document.getElementById("mode-pill"),
  modalContent: document.getElementById("modal-content"),
  modalOverlay: document.getElementById("modal-overlay"),
  notesList: document.getElementById("notes-list"),
  overviewMiniGrid: document.getElementById("overview-mini-grid"),
  picksGrid: document.getElementById("picks-grid"),
  picksMeta: document.getElementById("picks-meta"),
  pulseChart: document.getElementById("pulse-chart"),
  queryBtn: document.getElementById("query-btn"),
  queryInput: document.getElementById("query-input"),
  quickLinksList: document.getElementById("quick-links-list"),
  savedStateList: document.getElementById("saved-state-list"),
  sourceHealthList: document.getElementById("source-health-list"),
  statusPill: document.getElementById("status-pill"),
  summaryStrip: document.getElementById("summary-strip"),
  syncBtn: document.getElementById("sync-btn"),
  toastStack: document.getElementById("toast-stack"),
  topMoversList: document.getElementById("top-movers-list"),
  coverageChart: document.getElementById("coverage-chart"),
  topNav: document.getElementById("top-nav"),
  catalogTitle: document.getElementById("catalog-title"),
  pagePrev: document.getElementById("page-prev"),
  pageNext: document.getElementById("page-next"),
  pageInfo: document.getElementById("page-info"),
  paginationBar: document.getElementById("pagination-bar"),
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return map[char];
  });
}

function showToast(title, copy) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-copy">${escapeHtml(copy)}</div>
  `;
  elements.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function setSyncState(syncing) {
  state.syncing = syncing;
  elements.statusPill.textContent = syncing ? "Syncing..." : "Auto-sync on";
  elements.syncBtn.disabled = syncing;
  elements.syncBtn.textContent = syncing ? "Syncing..." : "Sync Now";
}

function openUrl(url) {
  if (!url) {
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderStatus() {
  if (!state.status) {
    return;
  }

  elements.statusPill.textContent = state.syncing ? "Syncing..." : `${state.status.enabledCount} live sources`;
}

function renderSavedState(items) {
  elements.savedStateList.innerHTML = items.map((item) => `
    <div class="stack-item">
      <div class="stack-item-head">
        <div class="stack-item-title">${escapeHtml(item.label)}</div>
        <div class="stack-item-title">${escapeHtml(item.value)}</div>
      </div>
    </div>
  `).join("");
}

function renderTopMovers(items) {
  elements.topMoversList.innerHTML = items.map((item) => `
    <button class="stack-item action-open" type="button" data-url="${escapeHtml(item.url)}">
      <div class="stack-item-head">
        <div class="stack-item-title">${escapeHtml(item.title)}</div>
        <div class="stack-item-meta">${escapeHtml(item.score)}</div>
      </div>
      <div class="stack-item-meta">${escapeHtml(item.meta)}</div>
    </button>
  `).join("");
}

function renderSourceHealth(items) {
  elements.sourceHealthList.innerHTML = items.map((item) => `
    <div class="stack-item">
      <div class="stack-item-title">${escapeHtml(item.name)}</div>
      <div class="stack-item-meta">
        <span class="status-text ${escapeHtml(item.statusClass)}">${escapeHtml(item.statusText)}</span>
        · ${escapeHtml(item.meta)}
      </div>
    </div>
  `).join("");
}

function renderMiniGrid(items) {
  elements.overviewMiniGrid.innerHTML = items.map((item) => `
    <div class="mini-card">
      <div class="mini-card-label">${escapeHtml(item.label)}</div>
      <div class="mini-card-value">${escapeHtml(item.value)}</div>
    </div>
  `).join("");
}

function renderSummaryStrip(items) {
  elements.summaryStrip.innerHTML = items.map((item) => `
    <div class="summary-card">
      <div class="summary-card-value">${escapeHtml(item.value)}</div>
      <div class="summary-card-label">${escapeHtml(item.label)}</div>
    </div>
  `).join("");
}

function renderPicks(items) {
  elements.picksMeta.textContent = `${state.items.length} live items found.`;
  
  const start = (state.page - 1) * state.pageSize;
  const pageItems = items.slice(start, start + state.pageSize);
  
  elements.pageInfo.textContent = `Page ${state.page} of ${Math.ceil(items.length / state.pageSize) || 1}`;
  elements.pagePrev.disabled = state.page === 1;
  elements.pageNext.disabled = start + state.pageSize >= items.length;

  elements.picksGrid.innerHTML = pageItems.map((item, index) => {
    const globalIndex = start + index;
    const thumbnailHtml = item.thumbnail ? `<div class="pick-thumb"><img src="${escapeHtml(item.thumbnail)}" alt="Thumbnail" loading="lazy"></div>` : '';
    
    return `
      <article class="pick-card" data-index="${globalIndex}">
        <div class="pick-head">
          <span class="source-chip warm">${escapeHtml(item.source)}</span>
          <span class="pick-score">${escapeHtml(item.metricLabel || "Rank")}: ${escapeHtml(item.metricValue || globalIndex + 1)}</span>
        </div>
        ${thumbnailHtml}
        <div>
          <div class="pick-title">${escapeHtml(item.title)}</div>
          <div class="pick-subtitle">${escapeHtml(item.subtitle)}</div>
        </div>
        <div class="pick-summary">${escapeHtml(item.description || item.summary)}</div>
        <div>
          <div class="tag-row">
            ${(item.tags || []).map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="pick-actions">
            <button class="mini-btn" type="button" data-action="save-pick" data-index="${globalIndex}">Save</button>
            <button class="mini-btn" type="button" data-action="open-pick" data-index="${globalIndex}">Inspect</button>
            <button class="mini-btn primary" type="button" data-action="launch-pick" data-index="${globalIndex}">Open</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderCoverage(items) {
  const max = Math.max(...items.map((item) => item.count), 1);
  elements.coverageChart.innerHTML = items.map((item) => `
    <div class="chart-col">
      <div class="chart-bar" style="height:${Math.max(24, (item.count / max) * 120)}px"></div>
      <div class="chart-bar-value">${escapeHtml(item.count)}</div>
      <div class="chart-bar-label">${escapeHtml(item.label)}</div>
    </div>
  `).join("");
}

function renderPulse(values) {
  const width = 420;
  const height = 170;
  const padding = 10;
  const max = Math.max(...values, 1);
  const xStep = values.length > 1 ? (width - padding * 2) / (values.length - 1) : width;

  const points = values.map((value, index) => {
    const x = padding + (index * xStep);
    const y = height - padding - ((value / max) * (height - padding * 2));
    return `${x},${y}`;
  });

  const line = points.join(" ");
  const fill = [`${padding},${height - padding}`, ...points, `${width - padding},${height - padding}`].join(" ");

  elements.pulseChart.innerHTML = `
    <polygon class="pulse-fill" points="${fill}"></polygon>
    <polyline class="pulse-line" points="${line}"></polyline>
  `;
}

function renderFeed(items) {
  elements.feedList.innerHTML = items.map((item) => `
    <button class="feed-item action-open" type="button" data-url="${escapeHtml(item.url)}">
      <div class="feed-item-head">
        <div class="feed-item-title">${escapeHtml(item.title)}</div>
        <span class="source-chip">${escapeHtml(item.source)}</span>
      </div>
      <div class="feed-item-meta">${escapeHtml(item.meta)}</div>
      <div class="feed-item-copy">${escapeHtml(item.copy)}</div>
    </button>
  `).join("");
}

function renderQuickLinks(items) {
  elements.quickLinksList.innerHTML = items.map((item) => `
    <button class="quick-link action-open" type="button" data-url="${escapeHtml(item.url)}">
      <span class="quick-link-title">${escapeHtml(item.label)}</span>
      <span class="quick-link-meta">${escapeHtml(item.meta)}</span>
    </button>
  `).join("");
}

function renderNotes(items) {
  elements.notesList.innerHTML = items.map((item) => `
    <div class="note-card">
      <div class="note-title">${escapeHtml(item.title)}</div>
      <div class="note-copy">${escapeHtml(item.body)}</div>
    </div>
  `).join("");
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) {
    return;
  }

  elements.heroTitle.textContent = data.hero.title;
  elements.heroSummary.textContent = data.hero.summary;
  elements.aiBriefing.textContent = data.briefing;
  elements.modePill.textContent = `Mode: ${data.mode}`;
  elements.queryInput.value = data.query;

  renderSavedState(data.savedState);
  renderTopMovers(data.topMovers);
  renderSourceHealth(data.sourceHealth);
  renderMiniGrid(data.overviewMini);
  renderSummaryStrip(data.summary);
  renderPicks(data.picks);
  renderCoverage(data.coverage);
  renderPulse(data.activity);
  renderFeed(data.feed);
  renderQuickLinks(data.quickLinks);
  renderNotes(data.notes);
}

function renderLoading() {
  const skeletons = Array.from({ length: 4 }, () => `<div class="skeleton"></div>`).join("");
  elements.picksGrid.innerHTML = skeletons;
  elements.summaryStrip.innerHTML = skeletons;
  elements.feedList.innerHTML = skeletons;
  elements.savedStateList.innerHTML = skeletons;
  elements.topMoversList.innerHTML = skeletons;
  elements.sourceHealthList.innerHTML = skeletons;
  elements.coverageChart.innerHTML = skeletons;
  elements.quickLinksList.innerHTML = skeletons;
  elements.notesList.innerHTML = skeletons;
}

async function fetchStatus() {
  const response = await fetch("/api/status");
  state.status = await response.json();
  renderStatus();
}

async function fetchDashboard(query = state.query) {
  setSyncState(true);
  renderLoading();

  try {
    let endpoint = "";
    if (state.view === "dashboard") endpoint = `/api/dashboard?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(state.mode)}`;
    else if (state.view === "catalog") endpoint = `/api/catalog?q=${encodeURIComponent(query)}`;
    else if (state.view === "movies") endpoint = `/api/movies?q=${encodeURIComponent(query)}`;
    else if (state.view === "anime") endpoint = `/api/anime?q=${encodeURIComponent(query)}`;
    else if (state.view === "music") endpoint = `/api/music_deezer?q=${encodeURIComponent(query)}`;
    else if (state.view === "books") endpoint = `/api/doc?q=${encodeURIComponent(query)}`;
    else if (state.view === "code") endpoint = `/api/code?q=${encodeURIComponent(query)}`;
    else if (state.view === "images") endpoint = `/api/image?q=${encodeURIComponent(query)}`;
    else if (state.view === "videos") endpoint = `/api/video?q=${encodeURIComponent(query)}`;

    const response = await fetch(endpoint);
    const data = await response.json();
    
    if (!response.ok || data.error) {
      throw new Error(data.error || `Server responded with ${response.status}`);
    }
    
    if (state.view === "dashboard") {
      state.dashboard = data;
      state.query = data.query;
      state.items = data.picks || [];
      renderDashboard();
    } else {
      state.items = data.items || [];
      elements.catalogTitle.textContent = `${state.view.charAt(0).toUpperCase() + state.view.slice(1)} Results`;
      renderPicks(state.items);
      elements.summaryStrip.innerHTML = "";
      elements.feedList.innerHTML = "";
    }
  } catch (error) {
    showToast("Dashboard error", error.message || "Could not load data.");
  } finally {
    setSyncState(false);
    renderStatus();
  }
}

function openModal(index) {
  const item = state.dashboard?.picks?.[index];
  if (!item) {
    return;
  }

  elements.modalContent.innerHTML = `
    <button class="modal-close" type="button" data-action="close-modal">×</button>
    <div class="modal-type">${escapeHtml(item.source)} · ${escapeHtml(item.kind)}</div>
    <h2 class="modal-title">${escapeHtml(item.title)}</h2>
    <div class="modal-copy">${escapeHtml(item.summary)}</div>
    <div class="modal-meta-grid">
      <div class="modal-meta-item"><label>Subtitle</label>${escapeHtml(item.subtitle)}</div>
      <div class="modal-meta-item"><label>Score</label>${escapeHtml(item.metricLabel)}: ${escapeHtml(item.metricValue)}</div>
      <div class="modal-meta-item"><label>Tags</label>${escapeHtml(item.tags.join(", "))}</div>
      <div class="modal-meta-item"><label>Source URL</label>${escapeHtml(item.url)}</div>
    </div>
    <div class="modal-actions">
      <button class="mini-btn primary" type="button" data-action="launch-pick" data-index="${index}">Open Source</button>
      <button class="mini-btn" type="button" data-action="save-pick" data-index="${index}">Save To Watchlist</button>
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
  if (action === "close-modal") {
    closeModal();
    return;
  }

  if (action === "open-pick") {
    openModal(index);
    return;
  }

  if (action === "launch-pick") {
    const item = state.dashboard?.picks?.[index];
    if (item?.url) {
      openUrl(item.url);
    }
    return;
  }

  if (action === "save-pick") {
    const item = state.dashboard?.picks?.[index];
    showToast("Saved locally", item ? item.title : "Item");
    return;
  }

  if (action === "open-url" && url) {
    openUrl(url);
  }
}

function bindEvents() {
  elements.queryBtn.addEventListener("click", () => {
    const nextQuery = elements.queryInput.value.trim();
    if (nextQuery) {
      fetchDashboard(nextQuery);
    }
  });

  elements.queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const nextQuery = elements.queryInput.value.trim();
      if (nextQuery) {
        fetchDashboard(nextQuery);
      }
    }
  });

  elements.syncBtn.addEventListener("click", () => fetchDashboard(state.query));

  elements.modePill.addEventListener("click", () => {
    state.mode = state.mode === "personal" ? "public" : "personal";
    fetchDashboard(state.query);
    showToast("Dashboard mode", `Switched to ${state.mode}.`);
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

  elements.topNav.addEventListener("click", (event) => {
    const target = event.target.closest(".nav-pill");
    if (!target) return;
    
    document.querySelectorAll(".nav-pill").forEach(btn => btn.classList.remove("active"));
    target.classList.add("active");
    
    state.view = target.dataset.view;
    state.page = 1;
    fetchDashboard(state.query);
  });

  document.body.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action], .action-open");
    if (!target) {
      return;
    }

    if (target.classList.contains("action-open")) {
      openUrl(target.dataset.url);
      return;
    }

    handleAction(target.dataset.action, Number(target.dataset.index), target.dataset.url);
  });

  elements.modalOverlay.addEventListener("click", (event) => {
    if (event.target === elements.modalOverlay) {
      closeModal(event);
    }
  });
}

async function init() {
  bindEvents();
  await fetchStatus();
  await fetchDashboard(state.query);
}

init();
