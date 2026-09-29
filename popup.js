const STORAGE_PREFIX = "wa_page_";
const DB_NAME = "local-web-annotator";
const DB_STORE = "handles";
const DIR_HANDLE_KEY = "annotation-directory";
const COLOR_SETTINGS_KEY = "wa_color_settings";
const MAX_CUSTOM_COLORS = 5;
const STANDARD_COLORS = [
  { name: "White", value: "#ffffff", short: "W" },
  { name: "Yellow", value: "#ffeb3b", short: "Y" },
  { name: "Black", value: "#111111", short: "K" },
  { name: "Dark blue", value: "#003f9e", short: "DB" },
  { name: "Light green", value: "#b7f7a8", short: "LG" },
  { name: "Red", value: "#ff1f1f", short: "R" }
];

const FALLBACK_SET_NAME = "Default";
const PRESET_SET_NAMES = [
  "Change Log",
  "Step-by-Step Workflow",
  "Project Overview",
  "Prompt Writing Guidelines",
  "Rubric Writing Guidelines",
  "Rule Classification Guidelines",
  "Difficulty & Iteration",
  "QA: L1 Review",
  "Accounting & Tax",
  "Applied Math",
  "Biology",
  "CARE Mental Health",
  "Chemistry",
  "Data Science",
  "Engineering/CAD",
  "Law",
  "Medicine",
  "Physics/MS/SS/ES",
  "Pure Math"
];

function allDropdownSetNames(pageData) {
  const names = new Set([FALLBACK_SET_NAME, pageData?.activeSetName || FALLBACK_SET_NAME, ...PRESET_SET_NAMES, ...Object.keys(pageData?.sets || {})]);
  return Array.from(names).map(normalizeSetName).filter(Boolean);
}

const $ = (id) => document.getElementById(id);

let activeTab = null;
let currentPayload = null;
let colorSettings = { currentColor: "#ffeb3b", customColors: [] };

function setStatus(text) {
  $("status").textContent = text;
}

function setModeStatus(active) {
  const el = $("modeStatus");
  if (!el) return;
  el.textContent = active
    ? "Highlight mode is ON for this tab. Select text on the page; press Esc to stop."
    : "Highlight mode is OFF.";
}

function normalizeColorValue(color) {
  const raw = String(color || "").trim();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return "#" + raw.slice(1).split("").map(ch => ch + ch).join("").toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  const named = {
    white: "#ffffff",
    yellow: "#ffeb3b",
    black: "#111111",
    "dark blue": "#003f9e",
    "light green": "#b7f7a8",
    red: "#ff1f1f"
  };
  return named[raw.toLowerCase()] || "#ffeb3b";
}

function isDarkColor(hex) {
  const c = normalizeColorValue(hex).slice(1);
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 120;
}

async function loadColorSettings() {
  const result = await chrome.storage.local.get(COLOR_SETTINGS_KEY);
  const incoming = result[COLOR_SETTINGS_KEY] || {};
  colorSettings = {
    currentColor: normalizeColorValue(incoming.currentColor || "#ffeb3b"),
    customColors: Array.isArray(incoming.customColors)
      ? [...new Set(incoming.customColors.map(normalizeColorValue))].slice(0, MAX_CUSTOM_COLORS)
      : []
  };
}

async function saveColorSettings() {
  await chrome.storage.local.set({ [COLOR_SETTINGS_KEY]: colorSettings });
}

async function pushColorToActiveTab() {
  try {
    await sendToActiveTab({ type: "WA_SET_CURRENT_COLOR", color: colorSettings.currentColor });
  } catch {
    // Some pages cannot receive content-script messages. The setting is still saved.
  }
}

function swatchShortLabel(label, color) {
  const match = STANDARD_COLORS.find(c => c.name === label || normalizeColorValue(c.value) === normalizeColorValue(color));
  return match?.short || "C";
}

function makeSwatch(color, label, selected) {
  const normalized = normalizeColorValue(color);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `colorSwatch${selected ? " selected" : ""}${isDarkColor(normalized) ? " darkText" : ""}`;
  btn.style.setProperty("--swatch-color", normalized);
  btn.style.backgroundColor = normalized;
  btn.title = label;
  btn.dataset.color = normalized;
  btn.setAttribute("aria-label", label);
  btn.textContent = swatchShortLabel(label, normalized);
  return btn;
}

function renderColorControls() {
  const standard = $("standardColors");
  const custom = $("customColors");
  if (!standard || !custom) return;

  const current = normalizeColorValue(colorSettings.currentColor);
  standard.replaceChildren();
  for (const c of STANDARD_COLORS) {
    standard.appendChild(makeSwatch(c.value, c.name, normalizeColorValue(c.value) === current));
  }

  custom.replaceChildren();
  if (!colorSettings.customColors.length) {
    const empty = document.createElement("div");
    empty.className = "emptyCustomColors";
    empty.textContent = "No custom colors saved yet.";
    custom.appendChild(empty);
  } else {
    for (const color of colorSettings.customColors) {
      const wrap = document.createElement("div");
      wrap.className = "customSwatchWrap";
      const swatch = makeSwatch(color, `Custom ${color}`, color === current);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "removeCustomColor";
      remove.textContent = "×";
      remove.title = `Remove ${color}`;
      remove.dataset.removeColor = color;
      wrap.append(swatch, remove);
      custom.appendChild(wrap);
    }
  }

  $("customColorCount").textContent = `${colorSettings.customColors.length}/${MAX_CUSTOM_COLORS}`;
  $("customColorPicker").value = current;
  $("colorStatus").textContent = `Current highlight color: ${current}`;
}

async function selectHighlightColor(color) {
  colorSettings.currentColor = normalizeColorValue(color);
  await saveColorSettings();
  renderColorControls();
  await pushColorToActiveTab();
  setStatus(`New highlights will use ${colorSettings.currentColor}.`);
}

async function addCustomColor() {
  const color = normalizeColorValue($("customColorPicker").value);
  if (colorSettings.customColors.includes(color)) {
    await selectHighlightColor(color);
    setStatus(`${color} is already saved and is now selected.`);
    return;
  }
  if (colorSettings.customColors.length >= MAX_CUSTOM_COLORS) {
    setStatus(`You can save at most ${MAX_CUSTOM_COLORS} custom colors. Remove one first.`);
    return;
  }
  colorSettings.customColors.push(color);
  colorSettings.currentColor = color;
  await saveColorSettings();
  renderColorControls();
  await pushColorToActiveTab();
  setStatus(`Saved custom color ${color}.`);
}

async function removeCustomColor(color) {
  color = normalizeColorValue(color);
  colorSettings.customColors = colorSettings.customColors.filter(c => c !== color);
  if (colorSettings.currentColor === color) colorSettings.currentColor = "#ffeb3b";
  await saveColorSettings();
  renderColorControls();
  await pushColorToActiveTab();
  setStatus(`Removed custom color ${color}.`);
}

function safeFileName(s) {
  return (s || "page")
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function pageFileName(pageData) {
  const host = (() => {
    try { return new URL(pageData.canonicalUrl || pageData.url).hostname; }
    catch { return "unknown-site"; }
  })();
  return `${safeFileName(host)}_${pageData.pageId || "page"}.json`;
}

function pageFolderName(pageData) {
  return pageFileName(pageData).replace(/\.json$/i, "");
}

function setFileName(setName) {
  return `${safeFileName(setName || "Default")}.json`;
}

function normalizeSetName(name) {
  return String(name || "Default").replace(/\s+/g, " ").trim() || "Default";
}

function normalizePageSets(pageData) {
  if (!pageData || typeof pageData !== "object") return pageData;
  const active = normalizeSetName(pageData.activeSetName || "Default");
  if (!pageData.sets || typeof pageData.sets !== "object" || Array.isArray(pageData.sets)) {
    pageData.sets = {
      [active]: {
        name: active,
        createdAt: pageData.createdAt || new Date().toISOString(),
        updatedAt: pageData.updatedAt || new Date().toISOString(),
        annotations: Array.isArray(pageData.annotations) ? pageData.annotations : [],
        stickers: Array.isArray(pageData.stickers) ? pageData.stickers : [],
        drawings: Array.isArray(pageData.drawings) ? pageData.drawings : []
      }
    };
    pageData.activeSetName = active;
  }
  for (const [rawName, set] of Object.entries(pageData.sets)) {
    const name = normalizeSetName(set?.name || rawName);
    set.name = name;
    if (!Array.isArray(set.annotations)) set.annotations = [];
    if (!Array.isArray(set.stickers)) set.stickers = [];
    if (!Array.isArray(set.drawings)) set.drawings = [];
  }
  return pageData;
}

function pageDataForSingleSet(pageData, setName) {
  pageData = normalizePageSets(JSON.parse(JSON.stringify(pageData)));
  setName = normalizeSetName(setName);
  const set = pageData.sets?.[setName] || { name: setName, annotations: [], stickers: [], drawings: [] };
  const out = {
    ...pageData,
    activeSetName: setName,
    annotations: set.annotations || [],
    stickers: set.stickers || [],
    drawings: set.drawings || [],
    sets: { [setName]: set },
    splitSetFile: true
  };
  return out;
}

function mergeSetPageData(base, setPage) {
  base = normalizePageSets(base);
  setPage = normalizePageSets(setPage);
  const setName = normalizeSetName(setPage.activeSetName || Object.keys(setPage.sets || {})[0] || "Default");
  const set = setPage.sets?.[setName] || {
    name: setName,
    annotations: Array.isArray(setPage.annotations) ? setPage.annotations : [],
    stickers: Array.isArray(setPage.stickers) ? setPage.stickers : [],
    drawings: Array.isArray(setPage.drawings) ? setPage.drawings : []
  };
  base.sets[setName] = set;
  if (!base.activeSetName) base.activeSetName = setName;
  if (base.activeSetName === setName) {
    base.annotations = set.annotations || [];
    base.stickers = set.stickers || [];
    base.drawings = set.drawings || [];
  }
  return base;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendToActiveTab(message) {
  activeTab = activeTab || await getActiveTab();
  if (!activeTab?.id) throw new Error("No active tab found.");
  return await chrome.tabs.sendMessage(activeTab.id, message);
}

async function refreshPageData() {
  try {
    activeTab = await getActiveTab();
    currentPayload = await sendToActiveTab({ type: "WA_GET_PAGE_DATA" });
    if (!currentPayload?.ok) throw new Error(currentPayload?.error || "Could not read annotations from this page.");
    const pageData = currentPayload.pageData;
    const annotations = pageData?.annotations || [];
    const stickers = pageData?.stickers || [];
    const issues = [...annotations, ...stickers].filter(a => a.status === "modified" || a.status === "unresolved").length;
    const setCount = pageData?.sets && typeof pageData.sets === "object" ? Object.keys(pageData.sets).length : 1;
    const activeSet = currentPayload.activeSetName || pageData?.activeSetName || "Default";
    $("pageInfo").textContent = `Set: ${activeSet}. ${annotations.length} highlight annotation(s), ${stickers.length} graphic comment(s), ${issues} issue(s). ${setCount} saved set(s) on ${pageData?.title || activeTab.title || "this page"}.`;
    setModeStatus(Boolean(currentPayload.highlightMode));
    const tb = $("toolbarStatus");
    if (tb) tb.textContent = currentPayload.toolbarVisible ? "Toolbar is visible on the page." : "Toolbar is hidden.";
    setStatus("Ready.");
  } catch (err) {
    setStatus("This page cannot be annotated. Open a normal website tab and try again.");
    $("pageInfo").textContent = String(err.message || err);
    setModeStatus(false);
  }
  updateFolderStatus();
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename,
    saveAs: true,
    conflictAction: "uniquify"
  }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function verifyPermission(handle, mode = "readwrite") {
  if (!handle) return false;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

async function getStoredDirectoryHandle(mode = "readwrite") {
  const handle = await idbGet(DIR_HANDLE_KEY);
  if (!handle) return null;
  const ok = await verifyPermission(handle, mode);
  return ok ? handle : null;
}

async function writeJsonToWebAnnotationsFolder(handle, filename, data) {
  const root = await handle.getDirectoryHandle("WebAnnotations", { create: true });
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

async function readJsonFromWebAnnotationsFolder(handle, filename) {
  const root = await handle.getDirectoryHandle("WebAnnotations", { create: false });
  const fileHandle = await root.getFileHandle(filename, { create: false });
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

async function writeSetJsonFilesToSelectedFolder(handle, pageData) {
  pageData = normalizePageSets(JSON.parse(JSON.stringify(pageData)));
  const written = [];
  for (const setName of allDropdownSetNames(pageData)) {
    const fileName = setFileName(setName);
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(pageDataForSingleSet(pageData, setName), null, 2));
    await writable.close();
    written.push(fileName);
  }
  return written;
}

async function readSetJsonFilesFromSelectedFolder(handle, pageData) {
  let merged = normalizePageSets({
    version: pageData.version || 1,
    pageId: pageData.pageId,
    url: pageData.url,
    canonicalUrl: pageData.canonicalUrl,
    title: pageData.title,
    activeSetName: pageData.activeSetName || "Default",
    annotations: [], stickers: [], drawings: [], sets: {}
  });
  let count = 0;
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== "file" || !/\.json$/i.test(name)) continue;
    // Skip all-pages export files; those are backups, not set files.
    if (/local-web-annotator-all/i.test(name)) continue;
    const file = await entry.getFile();
    const setPage = JSON.parse(await file.text());
    merged = mergeSetPageData(merged, setPage);
    count += 1;
  }
  if (!count) throw new Error("No set JSON files were found directly in the selected folder.");
  return merged;
}

async function writePageSetsToLegacyFolder(handle, pageData) {
  pageData = normalizePageSets(JSON.parse(JSON.stringify(pageData)));
  const root = await handle.getDirectoryHandle("WebAnnotations", { create: true });
  const folder = await root.getDirectoryHandle(pageFolderName(pageData), { create: true });
  const written = [];
  for (const setName of allDropdownSetNames(pageData)) {
    const fileName = setFileName(setName);
    const fileHandle = await folder.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(pageDataForSingleSet(pageData, setName), null, 2));
    await writable.close();
    written.push(fileName);
  }
  return written;
}

async function readPageSetsFromLegacyFolder(handle, pageData) {
  const root = await handle.getDirectoryHandle("WebAnnotations", { create: false });
  const folder = await root.getDirectoryHandle(pageFolderName(pageData), { create: false });
  let merged = normalizePageSets({
    version: pageData.version || 1,
    pageId: pageData.pageId,
    url: pageData.url,
    canonicalUrl: pageData.canonicalUrl,
    title: pageData.title,
    activeSetName: pageData.activeSetName || "Default",
    annotations: [], stickers: [], drawings: [], sets: {}
  });
  let count = 0;
  for await (const [name, entry] of folder.entries()) {
    if (entry.kind !== "file" || !/\.json$/i.test(name)) continue;
    const file = await entry.getFile();
    const setPage = JSON.parse(await file.text());
    merged = mergeSetPageData(merged, setPage);
    count += 1;
  }
  if (!count) throw new Error("No legacy set JSON files were found for this page.");
  return merged;
}

async function updateFolderStatus() {
  const available = "showDirectoryPicker" in window;
  if (!available) {
    $("folderStatus").textContent = "Folder sync is not available in this browser. Use Save page JSON / Load page JSON instead.";
    return;
  }
  const handle = await idbGet(DIR_HANDLE_KEY).catch(() => null);
  $("folderStatus").textContent = handle ? `Folder selected: ${handle.name}` : "No folder selected.";
}

async function setHighlightMode(active) {
  const response = await sendToActiveTab({ type: "WA_SET_HIGHLIGHT_MODE", active });
  if (!response?.ok) throw new Error(response?.error || "Could not change highlight mode.");
  setModeStatus(Boolean(response.highlightMode));
  setStatus(active ? "Highlight mode started. Go back to the page and select text." : "Highlight mode stopped.");
}

async function showToolbar(quiet = false) {
  const response = await sendToActiveTab({ type: "WA_SHOW_TOOLBAR" });
  if (!response?.ok) throw new Error(response?.error || "Could not show toolbar.");
  const el = $("toolbarStatus");
  if (el) el.textContent = "Toolbar is visible on the page.";
  if (!quiet) setStatus("SF toolbar shown on the page.");
}

async function hideToolbar() {
  const response = await sendToActiveTab({ type: "WA_HIDE_TOOLBAR" });
  if (!response?.ok) throw new Error(response?.error || "Could not hide toolbar.");
  const el = $("toolbarStatus");
  if (el) el.textContent = "Toolbar is hidden.";
  setStatus("SF toolbar hidden.");
}

async function exportCurrent() {
  await refreshPageData();
  const pageData = currentPayload?.pageData;
  if (!pageData) return;
  downloadJson(`WebAnnotations/${pageFileName(pageData)}`, pageData);
  setStatus("Saved current page JSON.");
}

async function importCurrentFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!Array.isArray(data.annotations) && !(data.sets && typeof data.sets === "object")) throw new Error("This JSON does not look like an annotation page file.");
  if (!Array.isArray(data.stickers)) data.stickers = [];
  const response = await sendToActiveTab({ type: "WA_SET_PAGE_DATA", pageData: data });
  if (!response?.ok) throw new Error(response?.error || "Could not load annotation file.");
  setStatus("Loaded page JSON into current page.");
  await refreshPageData();
}

async function chooseFolder() {
  if (!("showDirectoryPicker" in window)) {
    setStatus("Folder sync is not supported in this browser. Use JSON export/import.");
    return;
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbSet(DIR_HANDLE_KEY, handle);
  setStatus(`Folder selected: ${handle.name}`);
  await updateFolderStatus();
}

async function saveToFolder() {
  await refreshPageData();
  let pageData = currentPayload?.pageData;
  if (!pageData) return;
  pageData = normalizePageSets(pageData);
  const handle = await getStoredDirectoryHandle("readwrite");
  if (!handle) {
    setStatus("Choose a folder first.");
    return;
  }
  // New direct-folder layout: one Save-page-style JSON file per annotation set directly in the selected folder.
  const written = await writeSetJsonFilesToSelectedFolder(handle, pageData);
  setStatus(`Saved ${written.length} set file(s) directly in selected folder: ${written.slice(0, 6).join(", ")}${written.length > 6 ? ", ..." : ""}`);
}

async function loadFromFolder() {
  await refreshPageData();
  const pageData = currentPayload?.pageData;
  if (!pageData) return;
  const handle = await getStoredDirectoryHandle("readwrite");
  if (!handle) {
    setStatus("Choose a folder first.");
    return;
  }
  let data = null;
  let source = "direct selected folder";
  try {
    // Preferred v0.4.7 layout: set files live directly in the selected folder.
    data = await readSetJsonFilesFromSelectedFolder(handle, pageData);
  } catch (directErr) {
    try {
      // Backward-compatible v0.4.6 layout: WebAnnotations/<page-file-name-without-json>/*.json
      data = await readPageSetsFromLegacyFolder(handle, pageData);
      source = `legacy WebAnnotations/${pageFolderName(pageData)}/`;
    } catch (legacySplitErr) {
      // Older fallback: WebAnnotations/<page-file-name>.json
      data = await readJsonFromWebAnnotationsFolder(handle, pageFileName(pageData));
      source = `legacy WebAnnotations/${pageFileName(pageData)}`;
    }
  }
  const response = await sendToActiveTab({ type: "WA_SET_PAGE_DATA", pageData: data });
  if (!response?.ok) throw new Error(response?.error || "Could not load annotation file.");
  const setCount = data?.sets && typeof data.sets === "object" ? Object.keys(data.sets).length : 1;
  setStatus(`Loaded ${setCount} annotation set(s) from ${source}.`);
  await refreshPageData();
}

async function exportAll() {
  const all = await chrome.storage.local.get(null);
  const pages = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(STORAGE_PREFIX)));
  downloadJson("WebAnnotations/local-web-annotator-all.json", {
    exportedAt: new Date().toISOString(),
    app: "Local Web Annotator",
    version: 1,
    pages
  });
  setStatus(`Exported ${Object.keys(pages).length} stored page file(s).`);
}

async function clearCurrent() {
  await refreshPageData();
  const pageData = currentPayload?.pageData;
  if (!pageData) return;
  const activeSet = currentPayload.activeSetName || pageData.activeSetName || "Default";
  if (!confirm(`Clear all highlights and graphic comments in annotation set "${activeSet}"?`)) return;
  normalizePageSets(pageData);
  pageData.annotations = [];
  pageData.stickers = [];
  pageData.drawings = [];
  if (pageData.sets?.[activeSet]) {
    pageData.sets[activeSet].annotations = [];
    pageData.sets[activeSet].stickers = [];
    pageData.sets[activeSet].drawings = [];
  }
  const response = await sendToActiveTab({ type: "WA_SET_PAGE_DATA", pageData });
  if (!response?.ok) throw new Error(response?.error || "Could not clear annotations.");
  setStatus("Cleared current page annotations.");
  await refreshPageData();
}

function wire(id, fn) {
  $(id).addEventListener("click", async () => {
    try { await fn(); }
    catch (err) { setStatus(`Error: ${err.message || err}`); }
  });
}

wire("showToolbar", () => showToolbar(false));
wire("hideToolbar", hideToolbar);
wire("startHighlight", () => setHighlightMode(true));
wire("stopHighlight", () => setHighlightMode(false));
wire("exportCurrent", exportCurrent);
wire("importCurrent", () => $("fileInput").click());
wire("chooseFolder", chooseFolder);
wire("saveFolder", saveToFolder);
wire("loadFolder", loadFromFolder);
wire("forgetFolder", async () => {
  await idbDelete(DIR_HANDLE_KEY);
  setStatus("Forgot selected folder.");
  await updateFolderStatus();
});
wire("exportAll", exportAll);
wire("clearCurrent", clearCurrent);

$("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try { await importCurrentFromFile(file); }
  catch (err) { setStatus(`Error: ${err.message || err}`); }
  finally { e.target.value = ""; }
});

$("standardColors").addEventListener("click", async (e) => {
  const swatch = e.target.closest("[data-color]");
  if (!swatch) return;
  try { await selectHighlightColor(swatch.dataset.color); }
  catch (err) { setStatus(`Error: ${err.message || err}`); }
});

$("customColors").addEventListener("click", async (e) => {
  const remove = e.target.closest("[data-remove-color]");
  const swatch = e.target.closest("[data-color]");
  try {
    if (remove) await removeCustomColor(remove.dataset.removeColor);
    else if (swatch) await selectHighlightColor(swatch.dataset.color);
  } catch (err) {
    setStatus(`Error: ${err.message || err}`);
  }
});

wire("addCustomColor", addCustomColor);

(async function initPopup() {
  await loadColorSettings();
  renderColorControls();
  await pushColorToActiveTab();
  await showToolbar(true).catch(() => {});
  await refreshPageData();
})().catch((err) => setStatus(`Error: ${err.message || err}`));
