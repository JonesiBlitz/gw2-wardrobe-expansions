(function () {
  "use strict";

  const DATA = window.GW2_WARDROBE_DATA;
  const PAGE_SIZE = 240;
  const GW2_API = "https://api.guildwars2.com/v2";
  const API_KEY_STORAGE = "gw2-wardrobe-api-key";

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
    event: "source-event",
  };

  const ACQ_LABEL = {
    vendor: "Festival vendor",
    "trick-or-treat": "Trick-or-Treat bag",
    chest: "Courtly Weapon Chest",
    achievement: "Achievement chest",
    "achievement-past": "Past achievement chest",
    "prize-bag": "Halloween Prize Bag",
    "mystic-forge": "Mystic Forge",
    collection: "Mad Armory collection",
    drop: "Halloween drop",
  };

  function vendorTitle(v) {
    const place = [v.area, v.zone].filter(Boolean).join(", ");
    const where = place ? ` (${place})` : "";
    const what = v.item ? ` as ${v.item}` : "";
    const limit = v.limit ? `, limit ${v.limit}` : "";
    return `Sold by ${v.name}${where}${what} for ${v.cost}${limit} - only while ${v.festival || "the festival"} is running`;
  }

  const state = {
    windowKey: DATA.windows[0].key,
    search: "",
    type: "",
    source: "",
    unlock: "all",
    acq: "",
    visible: PAGE_SIZE,
    unlockedIds: null, // null = no wardrobe synced; else Set<number> of skin ids
    unlockedMinis: null, // Set<number> of mini ids, or null if unavailable
    unlockedNovelties: null, // Set<number> of novelty ids, or null if unavailable
  };

  // true/false once the relevant unlock list is known, null if it isn't.
  function isUnlocked(item) {
    const set =
      item.kind === "mini" ? state.unlockedMinis : item.kind === "novelty" ? state.unlockedNovelties : state.unlockedIds;
    return set ? set.has(item.id) : null;
  }

  const els = {
    tabs: document.getElementById("tabs"),
    festivalTabs: document.getElementById("festivalTabs"),
    windowMeta: document.getElementById("windowMeta"),
    search: document.getElementById("search"),
    typeFilter: document.getElementById("typeFilter"),
    sourceFilter: document.getElementById("sourceFilter"),
    unlockFilter: document.getElementById("unlockFilter"),
    acqFilter: document.getElementById("acqFilter"),
    unlockHintBtn: document.getElementById("unlockHintBtn"),
    resultCount: document.getElementById("resultCount"),
    grid: document.getElementById("grid"),
    loadMoreWrap: document.getElementById("loadMoreWrap"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    totalSkins: document.getElementById("totalSkins"),
    totalWindows: document.getElementById("totalWindows"),
    themeToggle: document.getElementById("themeToggle"),
    wardrobeSyncLine: document.getElementById("wardrobeSyncLine"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    settingsClose: document.getElementById("settingsClose"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    apiKeyToggle: document.getElementById("apiKeyToggle"),
    apiKeyStatus: document.getElementById("apiKeyStatus"),
    apiKeySave: document.getElementById("apiKeySave"),
    apiKeyRefresh: document.getElementById("apiKeyRefresh"),
    apiKeyClear: document.getElementById("apiKeyClear"),
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
    if (w.note) return w.note;
    if (!w.from && !w.to) return "No date range (skins the wiki gave us no way to date)";
    const from = w.from ?? "–";
    const to = w.to ?? "present";
    return `${from} → ${to}`;
  }

  function renderTabs() {
    els.tabs.innerHTML = "";
    els.festivalTabs.innerHTML = "";
    const hasFestivals = DATA.windows.some((w) => w.group === "festival");
    if (hasFestivals) {
      const label = document.createElement("span");
      label.className = "tabs-label";
      label.textContent = "Festivals";
      els.festivalTabs.appendChild(label);
    }
    for (const w of DATA.windows) {
      const btn = document.createElement("button");
      btn.className = "tab" + (w.key === state.windowKey ? " active" : "");
      btn.innerHTML = `${w.label} <span class="count">${w.count.toLocaleString()}</span>`;
      btn.addEventListener("click", () => {
        state.windowKey = w.key;
        state.visible = PAGE_SIZE;
        render();
      });
      (w.group === "festival" ? els.festivalTabs : els.tabs).appendChild(btn);
    }
  }

  // Acquisition filter only lists the sources that actually occur in this tab.
  function renderAcqOptions(win) {
    const present = new Set(win.skins.flatMap((s) => s.acq || []));
    const keys = Object.keys(ACQ_LABEL).filter((k) => present.has(k));
    els.acqFilter.innerHTML = '<option value="">Any acquisition</option>';
    for (const k of keys) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = ACQ_LABEL[k];
      els.acqFilter.appendChild(opt);
    }
    if (!keys.includes(state.acq)) state.acq = "";
    els.acqFilter.value = state.acq;
  }

  function matchesFilters(skin) {
    if (state.type && skin.type !== state.type) return false;
    if (state.source && skin.source !== state.source) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!skin.name.toLowerCase().includes(q)) return false;
    }
    if (state.acq && !(skin.acq && skin.acq.includes(state.acq))) return false;
    if (state.unlock !== "all") {
      const unlocked = isUnlocked(skin);
      if (unlocked !== null) {
        if (state.unlock === "unlocked" && !unlocked) return false;
        if (state.unlock === "locked" && unlocked) return false;
      }
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
    sourceBadge.textContent = seen
      ? `wiki: ${seen}`
      : skin.source === "wiki-category"
        ? "expansion content"
        : skin.source === "event"
          ? "festival"
          : "undated";
    sourceBadge.title = skin.sourceLabel;
    meta.appendChild(sourceBadge);

    for (const key of skin.acq || []) {
      const pill = document.createElement("span");
      pill.className = "pill" + (key === "vendor" ? " pill-vendor" : "");
      pill.textContent = ACQ_LABEL[key] || key;
      if (key === "vendor" && skin.vendor) pill.title = vendorTitle(skin.vendor);
      meta.appendChild(pill);
    }

    const unlocked = isUnlocked(skin);
    if (unlocked !== null) {
      div.classList.toggle("is-locked", !unlocked);
      const unlockBadge = document.createElement("span");
      unlockBadge.className = "unlock-badge " + (unlocked ? "unlocked" : "locked");
      unlockBadge.textContent = unlocked ? "✓ unlocked" : "🔒 locked";
      meta.appendChild(unlockBadge);
    }

    body.appendChild(meta);
    div.appendChild(body);
    return div;
  }

  function render() {
    const win = currentWindow();
    renderTabs();
    renderTypeOptions(win);
    renderAcqOptions(win);
    els.windowMeta.textContent = fmtRange(win);

    const hasWardrobe = !!state.unlockedIds;
    els.unlockFilter.style.display = hasWardrobe ? "" : "none";
    els.unlockHintBtn.style.display = hasWardrobe ? "none" : "";
    els.sourceFilter.style.display = win.event ? "none" : "";
    els.acqFilter.style.display = win.event && els.acqFilter.options.length > 1 ? "" : "none";
    if (win.event && state.source) {
      state.source = "";
      els.sourceFilter.value = "";
    }
    if (!win.event && state.acq) {
      state.acq = "";
      els.acqFilter.value = "";
    }

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
  els.acqFilter.addEventListener("change", () => {
    state.acq = els.acqFilter.value;
    state.visible = PAGE_SIZE;
    render();
  });
  els.unlockFilter.addEventListener("change", () => {
    state.unlock = els.unlockFilter.value;
    state.visible = PAGE_SIZE;
    render();
  });
  els.unlockHintBtn.addEventListener("click", () => openSettings());
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

  // ── Settings: API key & wardrobe sync ────────────────────────────────

  function getStoredKey() {
    try {
      return localStorage.getItem(API_KEY_STORAGE) || "";
    } catch (e) {
      return "";
    }
  }

  function setStoredKey(key) {
    try {
      if (key) localStorage.setItem(API_KEY_STORAGE, key);
      else localStorage.removeItem(API_KEY_STORAGE);
    } catch (e) {}
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && body.text) msg = body.text;
      } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }

  function setStatus(message, kind) {
    els.apiKeyStatus.textContent = message;
    els.apiKeyStatus.className = "modal-status" + (kind ? " " + kind : "");
  }

  function updateKeyButtons(hasKey) {
    els.apiKeyRefresh.style.display = hasKey ? "" : "none";
    els.apiKeyClear.style.display = hasKey ? "" : "none";
  }

  async function syncWardrobe(key, { silent } = {}) {
    if (!silent) setStatus("Fetching your unlocked wardrobe…", "pending");
    try {
      const tokenQs = `access_token=${encodeURIComponent(key)}`;
      const [skinIds, account, miniIds, noveltyIds] = await Promise.all([
        fetchJson(`${GW2_API}/account/skins?${tokenQs}`),
        fetchJson(`${GW2_API}/account?${tokenQs}`).catch(() => null),
        fetchJson(`${GW2_API}/account/minis?${tokenQs}`).catch(() => null),
        fetchJson(`${GW2_API}/account/novelties?${tokenQs}`).catch(() => null),
      ]);
      state.unlockedIds = new Set(skinIds);
      state.unlockedMinis = miniIds ? new Set(miniIds) : null;
      state.unlockedNovelties = noveltyIds ? new Set(noveltyIds) : null;
      state.visible = PAGE_SIZE;

      const who = account && account.name ? ` as ${account.name}` : "";
      const counts =
        `${skinIds.length.toLocaleString()} skins` +
        (miniIds ? `, ${miniIds.length.toLocaleString()} minis` : "") +
        (noveltyIds ? `, ${noveltyIds.length.toLocaleString()} novelties` : "");
      setStatus(`✓ Synced${who} — ${counts} unlocked.`, "success");
      els.wardrobeSyncLine.style.display = "";
      els.wardrobeSyncLine.textContent = `🔑 Wardrobe synced${who}: ${counts} unlocked.`;
      updateKeyButtons(true);
      render();
      return true;
    } catch (err) {
      state.unlockedIds = null;
      state.unlockedMinis = null;
      state.unlockedNovelties = null;
      setStatus(`Couldn't sync: ${err.message || err}`, "error");
      els.wardrobeSyncLine.style.display = "none";
      render();
      return false;
    }
  }

  function openSettings() {
    els.settingsOverlay.classList.add("open");
    els.apiKeyInput.focus();
  }
  function closeSettings() {
    els.settingsOverlay.classList.remove("open");
  }

  els.settingsBtn.addEventListener("click", openSettings);
  els.settingsClose.addEventListener("click", closeSettings);
  els.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === els.settingsOverlay) closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && els.settingsOverlay.classList.contains("open")) closeSettings();
  });

  els.apiKeyToggle.addEventListener("click", () => {
    els.apiKeyInput.type = els.apiKeyInput.type === "password" ? "text" : "password";
  });

  els.apiKeySave.addEventListener("click", async () => {
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      setStatus("Enter an API key first.", "error");
      return;
    }
    setStoredKey(key);
    updateKeyButtons(true);
    await syncWardrobe(key);
  });

  els.apiKeyRefresh.addEventListener("click", async () => {
    const key = getStoredKey();
    if (key) await syncWardrobe(key);
  });

  els.apiKeyClear.addEventListener("click", () => {
    setStoredKey("");
    els.apiKeyInput.value = "";
    state.unlockedIds = null;
    state.unlockedMinis = null;
    state.unlockedNovelties = null;
    state.unlock = "all";
    els.unlockFilter.value = "all";
    updateKeyButtons(false);
    setStatus("Key removed.", "");
    els.wardrobeSyncLine.style.display = "none";
    render();
  });

  async function initWardrobeSync() {
    const key = getStoredKey();
    if (!key) return;
    els.apiKeyInput.value = key;
    updateKeyButtons(true);
    await syncWardrobe(key, { silent: true });
  }

  els.totalSkins.textContent = DATA.totalSkins.toLocaleString();
  els.totalWindows.textContent = DATA.windows.filter((w) => !w.event).length;

  applyStoredTheme();
  render();
  initWardrobeSync();
})();
