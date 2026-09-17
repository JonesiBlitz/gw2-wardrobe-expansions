(function () {
  "use strict";

  const DATA = window.GW2_WARDROBE_DATA;
  const PAGE_SIZE = 240;

  const RARITY_VAR = {
    Junk: "--rarity-junk",
    Basic: "--rarity-basic",
    Fine: "--rarity-fine",
    Masterwork: "--rarity-masterwork",
    Rare: "--rarity-rare",
    Exotic: "--rarity-exotic",
    Ascended: "--rarity-ascended",
    Legendary: "--rarity-legendary",
  };

  const SOURCE_CLASS = {
    "wiki-category": "source-wiki-category",
    "date-inferred": "source-date-inferred",
    unknown: "source-unknown",
  };

  const state = {
    windowKey: DATA.windows[0].key,
    search: "",
    type: "",
    source: "",
    visible: PAGE_SIZE,
  };

  const els = {
    tabs: document.getElementById("tabs"),
    windowMeta: document.getElementById("windowMeta"),
    search: document.getElementById("search"),
    typeFilter: document.getElementById("typeFilter"),
    sourceFilter: document.getElementById("sourceFilter"),
    resultCount: document.getElementById("resultCount"),
    grid: document.getElementById("grid"),
    loadMoreWrap: document.getElementById("loadMoreWrap"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    totalSkins: document.getElementById("totalSkins"),
    totalWindows: document.getElementById("totalWindows"),
    themeToggle: document.getElementById("themeToggle"),
  };

  function currentWindow() {
    return DATA.windows.find((w) => w.key === state.windowKey) ?? DATA.windows[0];
  }

  function wikiUrl(name) {
    return "https://wiki.guildwars2.com/wiki/" + encodeURIComponent(name.replace(/ /g, "_"));
  }

  function fmtDate(iso) {
    if (!iso) return null;
    return iso.slice(0, 10);
  }

  function fmtRange(w) {
    if (!w.from && !w.to) return "No date range (skins the wiki gave us no way to date)";
    const from = w.from ?? "–";
    const to = w.to ?? "present";
    return `${from} → ${to}`;
  }

  function renderTabs() {
    els.tabs.innerHTML = "";
    for (const w of DATA.windows) {
      const btn = document.createElement("button");
      btn.className = "tab" + (w.key === state.windowKey ? " active" : "");
      btn.innerHTML = `${w.label} <span class="count">${w.count.toLocaleString()}</span>`;
      btn.addEventListener("click", () => {
        state.windowKey = w.key;
        state.visible = PAGE_SIZE;
        render();
      });
      els.tabs.appendChild(btn);
    }
  }

  function matchesFilters(skin) {
    if (state.type && skin.type !== state.type) return false;
    if (state.source && skin.source !== state.source) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!skin.name.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function renderTypeOptions(win) {
    const types = [...new Set(win.skins.map((s) => s.type))].sort();
    const current = state.type;
    els.typeFilter.innerHTML = '<option value="">All types</option>';
    for (const t of types) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      els.typeFilter.appendChild(opt);
    }
    els.typeFilter.value = types.includes(current) ? current : "";
    if (!types.includes(current)) state.type = "";
  }

  function card(skin) {
    const div = document.createElement("div");
    div.className = "card";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = skin.icon || "";
    img.alt = "";
    if (!skin.icon) img.style.visibility = "hidden";
    div.appendChild(img);

    const body = document.createElement("div");
    body.className = "body";

    const a = document.createElement("a");
    a.className = "name";
    a.href = wikiUrl(skin.name);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = skin.name;
    a.title = skin.name;
    body.appendChild(a);

    const meta = document.createElement("div");
    meta.className = "meta";

    const rarityDot = document.createElement("span");
    rarityDot.className = "rarity-dot";
    rarityDot.style.background = `var(${RARITY_VAR[skin.rarity] || "--rarity-basic"})`;
    rarityDot.title = skin.rarity;
    meta.appendChild(rarityDot);

    const typePill = document.createElement("span");
    typePill.className = "pill";
    typePill.textContent = skin.weight_class ? `${skin.type} · ${skin.weight_class}` : skin.type;
    meta.appendChild(typePill);

    const sourceBadge = document.createElement("span");
    sourceBadge.className = "source-badge " + (SOURCE_CLASS[skin.source] || "source-unknown");
    const seen = fmtDate(skin.wikiFirstSeen);
    sourceBadge.textContent = seen ? `wiki: ${seen}` : skin.source === "wiki-category" ? "expansion content" : "undated";
    sourceBadge.title = skin.sourceLabel;
    meta.appendChild(sourceBadge);

    body.appendChild(meta);
    div.appendChild(body);
    return div;
  }

  function render() {
    const win = currentWindow();
    renderTabs();
    renderTypeOptions(win);
    els.windowMeta.textContent = fmtRange(win);

    const filtered = win.skins.filter(matchesFilters);
    els.resultCount.textContent = `${filtered.length.toLocaleString()} of ${win.count.toLocaleString()} shown`;

    els.grid.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No skins match these filters.";
      els.grid.appendChild(empty);
      els.loadMoreWrap.style.display = "none";
      return;
    }

    const slice = filtered.slice(0, state.visible);
    const frag = document.createDocumentFragment();
    for (const skin of slice) frag.appendChild(card(skin));
    els.grid.appendChild(frag);

    if (filtered.length > state.visible) {
      els.loadMoreWrap.style.display = "block";
      els.loadMoreBtn.textContent = `Load more (${(filtered.length - state.visible).toLocaleString()} remaining)`;
    } else {
      els.loadMoreWrap.style.display = "none";
    }
  }

  els.search.addEventListener("input", () => {
    state.search = els.search.value.trim();
    state.visible = PAGE_SIZE;
    render();
  });
  els.typeFilter.addEventListener("change", () => {
    state.type = els.typeFilter.value;
    state.visible = PAGE_SIZE;
    render();
  });
  els.sourceFilter.addEventListener("change", () => {
    state.source = els.sourceFilter.value;
    state.visible = PAGE_SIZE;
    render();
  });
  els.loadMoreBtn.addEventListener("click", () => {
    state.visible += PAGE_SIZE;
    render();
  });

  function applyStoredTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem("gw2-wardrobe-theme");
    } catch (e) {}
    if (stored === "dark" || stored === "light") {
      document.documentElement.setAttribute("data-theme", stored);
      els.themeToggle.textContent = stored === "dark" ? "☀️ Light" : "🌙 Dark";
    }
  }

  els.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = current ? current === "dark" : prefersDark;
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    els.themeToggle.textContent = next === "dark" ? "☀️ Light" : "🌙 Dark";
    try {
      localStorage.setItem("gw2-wardrobe-theme", next);
    } catch (e) {}
  });

  els.totalSkins.textContent = DATA.totalSkins.toLocaleString();
  els.totalWindows.textContent = DATA.windows.length;

  applyStoredTheme();
  render();
})();
