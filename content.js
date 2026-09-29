(() => {
  "use strict";

  const UI_ATTR = "data-wa-ui";
  const HIGHLIGHT_CLASS = "wa-highlight";
  const STORAGE_PREFIX = "wa_page_";
  const CONTEXT_CHARS = 300;
  const COLOR_SETTINGS_KEY = "wa_color_settings";
  const TOOLBAR_SETTINGS_KEY = "wa_toolbar_settings";
  const MAX_CUSTOM_COLORS = 5;
  const DEFAULT_HIGHLIGHT_COLOR = "#ffeb3b";
  // Standard colors for v0.3.7. Additional colors can be saved as custom colors.
  const NAMED_COLORS = {
    white: "#ffffff",
    yellow: "#ffeb3b",
    black: "#111111",
    "dark blue": "#003f9e",
    "light green": "#b7f7a8",
    red: "#ff1f1f"
  };

  const STICKER_SHAPES = {
    check: { label: "Check mark", symbol: "✓" },
    cross: { label: "Cross", symbol: "✕" },
    question: { label: "Question mark", symbol: "?" },
    comment: { label: "Comment bubble", symbol: "💬" },
    arrow_up: { label: "Arrow up", symbol: "↑" },
    arrow_down: { label: "Arrow down", symbol: "↓" },
    arrow_left: { label: "Arrow left", symbol: "←" },
    arrow_right: { label: "Arrow right", symbol: "→" },
    arrow_left_up: { label: "Arrow left-up", symbol: "↖" },
    arrow_right_up: { label: "Arrow right-up", symbol: "↗" },
    arrow_left_down: { label: "Arrow left-down", symbol: "↙" },
    arrow_right_down: { label: "Arrow right-down", symbol: "↘" }
  };

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

  let pageData = null;
  let pageSetsInitialized = false;
  let runtimeById = new Map();
  let selectionButton = null;
  let commentBox = null;
  let commentBoxDragging = null;
  let panel = null;
  let statusPill = null;
  let isRendering = false;
  let saveTimer = null;
  let candidateCycleById = new Map();
  let panelFastScrollState = null;
  let mutationTimer = null;
  let lastRenderAt = 0;
  let highlightMode = false;
  let highlightModeBadge = null;
  let lastAutoHighlightAt = 0;
  let overlayLayer = null;
  let overlayUpdateTimer = null;
  let currentHighlightColor = DEFAULT_HIGHLIGHT_COLOR;
  let customHighlightColors = [];
  let toolbar = null;
  let toolbarSettings = { left: null, top: null };
  let toolbarSaveTimer = null;
  let toolbarDragging = null;
  let drawingMode = false;
  let drawingLayer = null;
  let drawingCanvas = null;
  let drawingCtx = null;
  let activeStroke = null;
  let drawingRaf = null;
  let pencilWidth = 3; // legacy value; pencil UI is disabled in v0.3.7.
  let lastSelectionSnapshot = null;
  let currentStickerShape = "check";
  let stickerDragging = null;
  let lastStickerDragAt = 0;
  let suppressStickerClickUntil = 0;
  let suppressStickerClickId = null;
  const STICKER_DRAG_THRESHOLD_PX = 5;
  const suppressedResizeCursorElements = new Map();

  function canonicalUrl() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href || window.location.href;
    const url = new URL(canonical, window.location.href);
    url.hash = "";
    for (const p of Array.from(url.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid)/i.test(p)) url.searchParams.delete(p);
    }
    return url.toString();
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function pageIdFor(url) {
    return hashString(url);
  }

  function storageKey() {
    return STORAGE_PREFIX + pageData.pageId;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function chromeGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function chromeSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  function normalizeWhitespace(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function normalizeColorValue(color) {
    const raw = String(color || "").trim();
    if (!raw) return DEFAULT_HIGHLIGHT_COLOR;
    const lower = raw.toLowerCase();
    if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      return "#" + raw.slice(1).split("").map(ch => ch + ch).join("").toLowerCase();
    }
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    return DEFAULT_HIGHLIGHT_COLOR;
  }

  function hexToRgb(hex) {
    hex = normalizeColorValue(hex).slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  function colorToRgba(color, alpha = 0.46) {
    const { r, g, b } = hexToRgb(color);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function borderColorFor(color) {
    return colorToRgba(color, 0.92);
  }

  function isDarkColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 120;
  }

  function standardColorEntries() {
    return Object.entries(NAMED_COLORS).map(([name, value]) => ({
      name: name.replace(/\b\w/g, ch => ch.toUpperCase()),
      value
    }));
  }

  function swatchShortLabel(label, value) {
    const key = String(label || "").trim().toLowerCase();
    const map = {
      white: "W",
      yellow: "Y",
      black: "K",
      "dark blue": "DB",
      "light green": "LG",
      red: "R"
    };
    if (map[key]) return map[key];
    const normalized = normalizeColorValue(value);
    const entry = Object.entries(NAMED_COLORS).find(([, v]) => normalizeColorValue(v) === normalized);
    return entry ? map[entry[0]] : "C";
  }

  function colorSwatchHtml({ value, name }, selected, action = "select-color") {
    const color = normalizeColorValue(value);
    const label = name || color;
    const short = swatchShortLabel(label, color);
    return `<button type="button" class="wa-color-swatch${selected ? " selected" : ""}${isDarkColor(color) ? " dark" : ""}" data-action="${action}" data-tb-action="${action}" data-color="${color}" title="${label}" aria-label="${label}" style="--wa-color:${color}; background-color:${color}"><span class="wa-swatch-label">${short}</span></button>`;
  }

  function annotationColorChoicesHtml(selectedColor) {
    const selected = normalizeColorValue(selectedColor);
    const standard = standardColorEntries()
      .map(c => colorSwatchHtml(c, normalizeColorValue(c.value) === selected, "ann-color"))
      .join("");
    const custom = customHighlightColors
      .map(c => colorSwatchHtml({ value: c, name: `Custom ${c}` }, normalizeColorValue(c) === selected, "ann-color"))
      .join("");
    return `<div class="wa-color-section">
      <div class="wa-color-section-title">Highlight color</div>
      <div class="wa-color-grid">${standard}${custom}</div>
    </div>`;
  }

  async function loadColorSettings() {
    const result = await chromeGet(COLOR_SETTINGS_KEY);
    const settings = result[COLOR_SETTINGS_KEY] || {};
    currentHighlightColor = normalizeColorValue(settings.currentColor || DEFAULT_HIGHLIGHT_COLOR);
    customHighlightColors = Array.isArray(settings.customColors)
      ? [...new Set(settings.customColors.map(normalizeColorValue))].slice(0, MAX_CUSTOM_COLORS)
      : [];
  }

  async function saveColorSettings() {
    await chromeSet({
      [COLOR_SETTINGS_KEY]: {
        currentColor: normalizeColorValue(currentHighlightColor),
        customColors: customHighlightColors.map(normalizeColorValue).slice(0, MAX_CUSTOM_COLORS)
      }
    });
  }

  async function setCurrentHighlightColor(color) {
    currentHighlightColor = normalizeColorValue(color);
    await saveColorSettings();
    renderToolbar();
  }

  function truncate(s, n = 160) {
    s = s || "";
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function safeFileName(s) {
    return (s || "page")
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "page";
  }

  function currentPageExportFileName() {
    const url = pageData?.canonicalUrl || canonicalUrl();
    return `annotations_${safeFileName(url)}_${pageData?.pageId || pageIdFor(url)}.json`;
  }


  function normalizeSetName(name) {
    return normalizeWhitespace(String(name || "")) || FALLBACK_SET_NAME;
  }

  function emptyAnnotationSet(name = FALLBACK_SET_NAME) {
    return {
      name: normalizeSetName(name),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      annotations: [],
      stickers: [],
      drawings: []
    };
  }

  function normalizeAnnotationSet(set, name) {
    const out = (set && typeof set === "object" && !Array.isArray(set)) ? set : {};
    out.name = normalizeSetName(out.name || name);
    if (!Array.isArray(out.annotations)) out.annotations = [];
    if (!Array.isArray(out.stickers)) out.stickers = [];
    if (!Array.isArray(out.drawings)) out.drawings = [];
    if (!out.createdAt) out.createdAt = nowIso();
    if (!out.updatedAt) out.updatedAt = nowIso();
    return out;
  }

  function ensurePageSets() {
    if (!pageData) return;
    const shouldLoadActiveSet = !pageSetsInitialized;

    const hadSets = pageData.sets && typeof pageData.sets === "object" && !Array.isArray(pageData.sets);
    if (!hadSets) {
      const initialName = normalizeSetName(pageData.activeSetName || FALLBACK_SET_NAME);
      pageData.sets = {
        [initialName]: normalizeAnnotationSet({
          name: initialName,
          createdAt: pageData.createdAt || nowIso(),
          updatedAt: pageData.updatedAt || nowIso(),
          annotations: Array.isArray(pageData.annotations) ? pageData.annotations : [],
          stickers: Array.isArray(pageData.stickers) ? pageData.stickers : [],
          drawings: Array.isArray(pageData.drawings) ? pageData.drawings : []
        }, initialName)
      };
      pageData.activeSetName = initialName;
    } else {
      const normalized = {};
      for (const [rawName, rawSet] of Object.entries(pageData.sets)) {
        const name = normalizeSetName(rawSet?.name || rawName);
        normalized[name] = normalizeAnnotationSet(rawSet, name);
      }
      pageData.sets = normalized;
      pageData.activeSetName = normalizeSetName(pageData.activeSetName || Object.keys(pageData.sets)[0] || FALLBACK_SET_NAME);
      if (!pageData.sets[pageData.activeSetName]) {
        pageData.sets[pageData.activeSetName] = emptyAnnotationSet(pageData.activeSetName);
      }
    }

    if (shouldLoadActiveSet) loadActiveSetToRoot();
    pageSetsInitialized = true;
  }

  function getActiveSetName() {
    ensurePageSets();
    return normalizeSetName(pageData?.activeSetName || FALLBACK_SET_NAME);
  }

  function getActiveSet() {
    ensurePageSets();
    const name = getActiveSetName();
    if (!pageData.sets[name]) pageData.sets[name] = emptyAnnotationSet(name);
    return pageData.sets[name];
  }

  function syncRootToActiveSet() {
    if (!pageData) return;
    if (!pageData.sets || typeof pageData.sets !== "object" || Array.isArray(pageData.sets)) {
      const name = normalizeSetName(pageData.activeSetName || FALLBACK_SET_NAME);
      pageData.sets = { [name]: emptyAnnotationSet(name) };
      pageData.activeSetName = name;
    }
    const name = normalizeSetName(pageData.activeSetName || FALLBACK_SET_NAME);
    const set = pageData.sets[name] || (pageData.sets[name] = emptyAnnotationSet(name));
    set.name = name;
    set.annotations = Array.isArray(pageData.annotations) ? pageData.annotations : [];
    set.stickers = Array.isArray(pageData.stickers) ? pageData.stickers : [];
    set.drawings = Array.isArray(pageData.drawings) ? pageData.drawings : [];
    set.updatedAt = nowIso();
  }

  function loadActiveSetToRoot() {
    if (!pageData) return;
    if (!pageData.sets || typeof pageData.sets !== "object" || Array.isArray(pageData.sets)) return;
    const name = normalizeSetName(pageData.activeSetName || Object.keys(pageData.sets)[0] || FALLBACK_SET_NAME);
    pageData.activeSetName = name;
    const set = pageData.sets[name] || (pageData.sets[name] = emptyAnnotationSet(name));
    normalizeAnnotationSet(set, name);
    pageData.annotations = set.annotations;
    pageData.stickers = set.stickers;
    pageData.drawings = set.drawings;
  }

  function orderedAnnotationSetNames() {
    if (!pageData) return [FALLBACK_SET_NAME, ...PRESET_SET_NAMES];
    if (!pageData.sets || typeof pageData.sets !== "object" || Array.isArray(pageData.sets)) ensurePageSets();
    const names = new Set([FALLBACK_SET_NAME, getActiveSetName(), ...PRESET_SET_NAMES, ...Object.keys(pageData.sets || {})]);
    return Array.from(names).filter(Boolean);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function annotationSetOptionsHtml() {
    const active = getActiveSetName();
    return orderedAnnotationSetNames().map(name => {
      const selected = name === active ? " selected" : "";
      const exists = pageData?.sets && pageData.sets[name] ? "" : " (empty preset)";
      return `<option value="${escapeHtml(name)}"${selected}>${escapeHtml(name + exists)}</option>`;
    }).join("");
  }

  async function switchAnnotationSet(name) {
    if (!pageData) return;
    name = normalizeSetName(name);
    syncRootToActiveSet();
    if (!pageData.sets[name]) pageData.sets[name] = emptyAnnotationSet(name);
    pageData.activeSetName = name;
    loadActiveSetToRoot();
    closeCommentBox();
    await renderAnnotations();
    scheduleSave();
    renderToolbar();
  }

  async function createAnnotationSet() {
    const raw = prompt("Name the new annotation set:", "");
    if (raw == null) return;
    const name = normalizeSetName(raw);
    if (!name) return;
    syncRootToActiveSet();
    if (!pageData.sets[name]) pageData.sets[name] = emptyAnnotationSet(name);
    await switchAnnotationSet(name);
  }

  async function renameActiveAnnotationSet() {
    const oldName = getActiveSetName();
    const raw = prompt("Rename current annotation set:", oldName);
    if (raw == null) return;
    const newName = normalizeSetName(raw);
    if (!newName || newName === oldName) return;
    syncRootToActiveSet();
    if (pageData.sets[newName]) {
      alert(`An annotation set named "${newName}" already exists. Switch to it or choose another name.`);
      return;
    }
    pageData.sets[newName] = pageData.sets[oldName] || emptyAnnotationSet(newName);
    pageData.sets[newName].name = newName;
    delete pageData.sets[oldName];
    pageData.activeSetName = newName;
    loadActiveSetToRoot();
    await renderAnnotations();
    scheduleSave();
    renderToolbar();
  }

  async function deleteActiveAnnotationSet() {
    const name = getActiveSetName();
    const set = getActiveSet();
    const count = (set.annotations?.length || 0) + (set.stickers?.length || 0) + (set.drawings?.length || 0);
    const message = count
      ? `Delete annotation set "${name}" and its ${count} item(s)?`
      : `Delete empty annotation set "${name}"?`;
    if (!confirm(message)) return;
    delete pageData.sets[name];
    const remaining = Object.keys(pageData.sets || {});
    const next = remaining[0] || FALLBACK_SET_NAME;
    if (!pageData.sets[next]) pageData.sets[next] = emptyAnnotationSet(next);
    pageData.activeSetName = next;
    loadActiveSetToRoot();
    closeCommentBox();
    await renderAnnotations();
    scheduleSave();
    renderToolbar();
  }

  function isExtensionUiNode(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(el?.closest?.(`[${UI_ATTR}="true"]`));
  }

  function eventTouchesExtensionUi(e) {
    return isExtensionUiNode(e.target) || isExtensionUiNode(e.relatedTarget);
  }

  function shieldEvent(e, { prevent = false } = {}) {
    if (prevent && e.cancelable) e.preventDefault();
    e.stopImmediatePropagation?.();
    e.stopPropagation?.();
  }

  function isEditableExtensionTarget(target) {
    const el = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    return Boolean(el?.closest?.(`[${UI_ATTR}="true"] textarea, [${UI_ATTR}="true"] input, [${UI_ATTR}="true"] select, [${UI_ATTR}="true"] [contenteditable="true"]`));
  }

  function isSkippableElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.closest?.(`[${UI_ATTR}="true"]`)) return true;
    const tag = el.tagName?.toLowerCase();
    if (["script", "style", "noscript", "textarea", "input", "select", "option", "svg", "canvas", "iframe"].includes(tag)) return true;
    const cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return true;
    return false;
  }

  function getVisibleTextNodes(root = document.body) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        let el = parent;
        while (el && el !== document.documentElement) {
          if (isSkippableElement(el)) return NodeFilter.FILTER_REJECT;
          el = el.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function buildTextModel() {
    const nodes = getVisibleTextNodes();
    const entries = [];
    const nodeMap = new Map();
    let text = "";
    for (const node of nodes) {
      const start = text.length;
      const value = node.nodeValue;
      text += value;
      const entry = { node, start, end: text.length, length: value.length };
      entries.push(entry);
      nodeMap.set(node, entry);
    }
    return { text, entries, nodeMap, textHash: hashString(text) };
  }

  function entryForOffset(model, offset) {
    if (!model || !Array.isArray(model.entries)) return null;
    for (const entry of model.entries) {
      if (offset >= entry.start && offset <= entry.end) return entry;
    }
    return model.entries[model.entries.length - 1] || null;
  }

  function isHeadingLikeElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName || "";
    if (/^H[1-6]$/i.test(tag)) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "heading") return true;
    return false;
  }

  function visibleElementText(el, max = 180) {
    if (!el) return "";
    const text = normalizeWhitespace(el.innerText || el.textContent || "");
    return text.slice(0, max);
  }

  function lastHeadingInside(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return null;
    if (isHeadingLikeElement(root) && visibleElementText(root)) return root;
    const headings = Array.from(root.querySelectorAll?.('h1,h2,h3,h4,h5,h6,[role="heading"]') || [])
      .filter(h => visibleElementText(h));
    return headings[headings.length - 1] || null;
  }

  function nearestHeadingTrailForElement(el) {
    const trail = [];
    let cur = el?.nodeType === Node.ELEMENT_NODE ? el : el?.parentElement;
    let depth = 0;
    while (cur && cur !== document.documentElement && depth < 12) {
      if (isHeadingLikeElement(cur)) {
        const t = visibleElementText(cur);
        if (t) trail.push(t);
      }
      let sib = cur.previousElementSibling;
      while (sib) {
        const h = lastHeadingInside(sib);
        const t = visibleElementText(h);
        if (t) {
          trail.push(t);
          break;
        }
        sib = sib.previousElementSibling;
      }
      cur = cur.parentElement;
      depth += 1;
    }
    const out = [];
    for (const t of trail.reverse()) {
      if (t && !out.includes(t)) out.push(t);
    }
    return out.slice(-6);
  }

  function sectionContextForOffsets(model, start, end) {
    const entry = entryForOffset(model, start);
    const el = entry?.node?.parentElement || null;
    const headingTrail = nearestHeadingTrailForElement(el);
    const nearestHeading = headingTrail[headingTrail.length - 1] || "";
    let containerText = "";
    let container = el?.closest?.('p,li,td,th,blockquote,section,article,main,div') || el;
    if (container) containerText = normalizeWhitespace(container.innerText || container.textContent || "").slice(0, 1000);
    return {
      activeSetName: getActiveSetName(),
      nearestHeading,
      headingTrail,
      containerHash: containerText ? hashString(containerText) : ""
    };
  }


  function getTextNodeIndexAmongSiblings(textNode) {
    const parent = textNode.parentNode;
    if (!parent) return 1;
    let index = 1;
    for (const child of parent.childNodes) {
      if (child === textNode) return index;
      if (child.nodeType === Node.TEXT_NODE) index++;
    }
    return index;
  }

  function getElementXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    const parts = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.documentElement) {
      let index = 1;
      let sib = el.previousElementSibling;
      while (sib) {
        if (sib.tagName === el.tagName) index++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${el.tagName.toLowerCase()}[${index}]`);
      el = el.parentElement;
    }
    return "/html/" + parts.join("/");
  }

  function getTextXPath(textNode) {
    const parentXPath = getElementXPath(textNode.parentElement);
    return `${parentXPath}/text()[${getTextNodeIndexAmongSiblings(textNode)}]`;
  }

  function rangeBoundaryToGlobal(container, offset, model, isStart) {
    if (container.nodeType === Node.TEXT_NODE) {
      const entry = model.nodeMap.get(container);
      if (entry) return entry.start + offset;
    }

    // Fallback for element boundaries. Most normal text selections produce text-node boundaries,
    // but browser behavior can vary when selection starts/ends around inline elements.
    const range = document.createRange();
    try {
      range.setStart(container, offset);
      range.collapse(true);
    } catch {
      return null;
    }

    let best = null;
    for (const entry of model.entries) {
      const nr = document.createRange();
      nr.selectNodeContents(entry.node);
      const beforeOrAtNodeStart = range.compareBoundaryPoints(Range.START_TO_START, nr) <= 0;
      const afterOrAtNodeEnd = range.compareBoundaryPoints(Range.START_TO_END, nr) >= 0;
      nr.detach?.();
      if (beforeOrAtNodeStart) {
        best = entry.start;
        break;
      }
      if (!afterOrAtNodeEnd) {
        best = entry.start;
        break;
      }
      best = entry.end;
    }
    range.detach?.();
    return best;
  }

  function selectionToOffsets(model) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (isExtensionUiNode(range.startContainer) || isExtensionUiNode(range.endContainer)) return null;

    let start = rangeBoundaryToGlobal(range.startContainer, range.startOffset, model, true);
    let end = rangeBoundaryToGlobal(range.endContainer, range.endOffset, model, false);
    if (start != null && end != null && end < start) [start, end] = [end, start];

    if (start == null || end == null || start === end) {
      const selected = normalizeWhitespace(sel.toString());
      if (!selected) return null;
      const pos = findSingleApproximateSelection(model.text, selected);
      if (!pos) return null;
      start = pos.start;
      end = pos.end;
    }

    return { start, end, range };
  }

  function findSingleApproximateSelection(pageText, selectedNormalized) {
    const normalizedPage = pageText.replace(/\s+/g, " ");
    const idx = normalizedPage.indexOf(selectedNormalized);
    if (idx < 0 || normalizedPage.indexOf(selectedNormalized, idx + 1) >= 0) return null;
    // The normalized index is not necessarily a raw index. Use it only as a rough fallback.
    const rawIdx = pageText.indexOf(selectedNormalized);
    if (rawIdx >= 0) return { start: rawIdx, end: rawIdx + selectedNormalized.length };
    return null;
  }

  function makeAnnotationFromSelection(color = currentHighlightColor) {
    const model = buildTextModel();
    const offsets = selectionToOffsets(model);
    if (!offsets) return null;
    const start = Math.max(0, offsets.start);
    const end = Math.min(model.text.length, offsets.end);
    if (end <= start) return null;

    const exact = model.text.slice(start, end);
    if (!normalizeWhitespace(exact)) return null;

    const range = offsets.range;
    const startNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer : null;
    const endNode = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer : null;

    return {
      id: `ann_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: "highlight",
      color,
      comment: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "attached",
      selector: {
        exact,
        prefix: model.text.slice(Math.max(0, start - CONTEXT_CHARS), start),
        suffix: model.text.slice(end, Math.min(model.text.length, end + CONTEXT_CHARS)),
        start,
        end,
        xpathStart: startNode ? getTextXPath(startNode) : "",
        xpathEnd: endNode ? getTextXPath(endNode) : "",
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        sectionContext: sectionContextForOffsets(model, start, end)
      },
      pageState: {
        title: document.title,
        textHash: model.textHash,
        savedAt: nowIso()
      }
    };
  }


  function getAnchorRectForOffsets(start, end, model) {
    const range = rangeForOffsets(start, end, model);
    if (!range) return null;
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
    const rect = rects[0] || range.getBoundingClientRect?.();
    if (!rect) {
      range.detach?.();
      return null;
    }
    const out = {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      right: rect.right + window.scrollX,
      bottom: rect.bottom + window.scrollY,
      width: rect.width,
      height: rect.height,
      viewport: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    };
    range.detach?.();
    return out;
  }

  function rememberCurrentSelection() {
    if (!pageData) return null;
    const ann = makeAnnotationFromSelection(currentHighlightColor);
    if (!ann) return null;
    const model = buildTextModel();
    const rect = getAnchorRectForOffsets(ann.selector.start, ann.selector.end, model);
    lastSelectionSnapshot = {
      selector: JSON.parse(JSON.stringify(ann.selector)),
      pageState: JSON.parse(JSON.stringify(ann.pageState || {})),
      rect,
      savedAt: nowIso()
    };
    return lastSelectionSnapshot;
  }

  function stickerShapeInfo(shape) {
    return STICKER_SHAPES[shape] || STICKER_SHAPES.comment;
  }

  function stickerOptionsHtml() {
    return Object.entries(STICKER_SHAPES).map(([shape, info]) =>
      `<option value="${shape}"${shape === currentStickerShape ? " selected" : ""}>${info.symbol} ${info.label}</option>`
    ).join("");
  }

  async function createStickerFromCurrentSelection(shape) {
    if (!pageData) return;
    if (!STICKER_SHAPES[shape]) shape = "comment";

    let anchor = makeAnnotationFromSelection(currentHighlightColor);
    let rect = null;
    const model = buildTextModel();

    if (anchor) {
      rect = getAnchorRectForOffsets(anchor.selector.start, anchor.selector.end, model);
    } else if (lastSelectionSnapshot?.selector) {
      anchor = {
        selector: JSON.parse(JSON.stringify(lastSelectionSnapshot.selector)),
        pageState: JSON.parse(JSON.stringify(lastSelectionSnapshot.pageState || {}))
      };
      rect = getAnchorRectForOffsets(anchor.selector.start, anchor.selector.end, model) || lastSelectionSnapshot.rect;
    }

    if (!anchor?.selector || !rect) {
      alert("Select the word or text first, then click a graphic sticky-note shape.");
      return;
    }

    const baseX = rect.left;
    const baseY = rect.top;
    const x = Math.round(baseX + Math.max(22, rect.width + 8));
    const y = Math.round(baseY - 6);
    const sticker = {
      id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: "sticker",
      shape,
      color: normalizeColorValue(currentHighlightColor),
      comment: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "attached",
      selector: anchor.selector,
      pageState: anchor.pageState || { title: document.title, textHash: model.textHash, savedAt: nowIso() },
      position: {
        x,
        y,
        dx: Math.round((x - baseX) * 10) / 10,
        dy: Math.round((y - baseY) * 10) / 10
      }
    };

    if (!Array.isArray(pageData.stickers)) pageData.stickers = [];
    pageData.stickers.push(sticker);
    window.getSelection()?.removeAllRanges();
    await renderAnnotations();
    scheduleSave();
    const el = firstStickerVisual(sticker.id);
    if (el) showStickerCommentBox(sticker, el.getBoundingClientRect());
  }

  function resolveSticker(sticker, model) {
    const runtime = resolveAnnotation(sticker, model);
    const pos = sticker.position || {};
    if (runtime.status === "attached" || runtime.status === "modified") {
      const rect = getAnchorRectForOffsets(runtime.start, runtime.end, model);
      if (rect) {
        const dx = Number.isFinite(pos.dx) ? pos.dx : Math.max(22, rect.width + 8);
        const dy = Number.isFinite(pos.dy) ? pos.dy : -6;
        return {
          ...runtime,
          anchorRect: rect,
          x: rect.left + dx,
          y: rect.top + dy,
          dx,
          dy
        };
      }
    }
    return {
      ...runtime,
      x: Number.isFinite(pos.x) ? pos.x : 24,
      y: Number.isFinite(pos.y) ? pos.y : 120,
      dx: Number.isFinite(pos.dx) ? pos.dx : 0,
      dy: Number.isFinite(pos.dy) ? pos.dy : 0
    };
  }

  function renderStickers(model) {
    const stickers = Array.isArray(pageData?.stickers) ? pageData.stickers : [];
    if (!stickers.length) return;
    const layer = ensureOverlayLayer();
    for (const sticker of stickers) {
      const runtime = resolveSticker(sticker, model);
      runtimeById.set(sticker.id, runtime);
      sticker.status = runtime.status;
      sticker.confidence = runtime.confidence;
      const info = stickerShapeInfo(sticker.shape);
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute(UI_ATTR, "true");
      el.className = `wa-sticker wa-sticker-${String(sticker.shape || "comment").replace(/[^a-z0-9_-]/gi, "")}`;
      el.dataset.waStickerId = sticker.id;
      el.dataset.waStatus = runtime.status || "attached";
      el.title = sticker.comment?.trim() ? sticker.comment.trim() : `${info.label}: click to add a comment; drag to move`;
      el.textContent = info.symbol;
      const c = normalizeColorValue(sticker.color || currentHighlightColor);
      el.style.color = c;
      el.style.borderColor = borderColorFor(c);
      el.style.left = `${Math.round(runtime.x || 0)}px`;
      el.style.top = `${Math.round(runtime.y || 0)}px`;
      if (runtime.status === "unresolved") el.classList.add("unresolved");
      if (sticker.comment?.trim()) el.classList.add("has-comment");
      layer.appendChild(el);
    }
  }

  function firstStickerVisual(id) {
    return document.querySelector(`.wa-sticker[data-wa-sticker-id="${CSS.escape(id)}"]`);
  }

  function startStickerDrag(e, el) {
    if (e.button != null && e.button !== 0) return;
    const id = el?.dataset?.waStickerId;
    const sticker = pageData?.stickers?.find(s => s.id === id);
    if (!sticker) return;

    // Start from the sticker's *current visual position*. For anchored stickers,
    // the saved position is primarily dx/dy relative to the anchor text, so using
    // pos.x/pos.y as the drag origin can make the sticker snap back during long
    // drags. The element's actual rect is the only reliable drag origin.
    const rect = el.getBoundingClientRect();
    const runtime = runtimeById.get(id);
    const startX = rect.left + window.scrollX;
    const startY = rect.top + window.scrollY;

    // If a previous drag got stuck because the page swallowed pointerup, end it
    // before starting a new drag.
    endStickerDrag({ save: true, suppressClick: true });

    stickerDragging = {
      id,
      el,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX,
      startY,
      lastX: startX,
      lastY: startY,
      anchorLeft: runtime?.anchorRect?.left,
      anchorTop: runtime?.anchorRect?.top,
      moved: false
    };

    el.classList.add("dragging");
    try { el.setPointerCapture?.(e.pointerId); } catch {}
    window.addEventListener("pointermove", onStickerPointerMove, true);
    window.addEventListener("pointerup", onStickerPointerUp, true);
    window.addEventListener("pointercancel", onStickerPointerCancel, true);
    window.addEventListener("mouseup", onStickerMouseUpFallback, true);
    window.addEventListener("touchend", onStickerMouseUpFallback, true);
    shieldEvent(e, { prevent: true });
  }

  function updateStickerPositionFromDrag(e) {
    if (!stickerDragging) return false;
    const drag = stickerDragging;
    if (e.pointerId != null && drag.pointerId != null && e.pointerId !== drag.pointerId) return true;
    const sticker = pageData?.stickers?.find(s => s.id === drag.id);
    if (!sticker) return false;

    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    if (Math.hypot(dxClient, dyClient) >= STICKER_DRAG_THRESHOLD_PX) drag.moved = true;

    const x = Math.round(drag.startX + dxClient);
    const y = Math.round(drag.startY + dyClient);
    drag.lastX = x;
    drag.lastY = y;

    const pos = sticker.position || (sticker.position = {});
    pos.x = x;
    pos.y = y;

    // Keep anchored offsets up to date during the drag. This prevents a render
    // caused by mutation/scroll/selection events from redrawing the sticker at
    // its old dx/dy while the user is moving it.
    if (Number.isFinite(drag.anchorLeft) && Number.isFinite(drag.anchorTop)) {
      pos.dx = Math.round((x - drag.anchorLeft) * 10) / 10;
      pos.dy = Math.round((y - drag.anchorTop) * 10) / 10;
    }

    drag.el.style.left = `${x}px`;
    drag.el.style.top = `${y}px`;
    drag.el.style.right = "auto";
    drag.el.style.bottom = "auto";
    return true;
  }

  function onStickerPointerMove(e) {
    if (!stickerDragging) return;
    updateStickerPositionFromDrag(e);
    shieldEvent(e, { prevent: true });
  }

  function endStickerDrag(opts = {}) {
    if (!stickerDragging) return;
    const drag = stickerDragging;
    stickerDragging = null;
    window.removeEventListener("pointermove", onStickerPointerMove, true);
    window.removeEventListener("pointerup", onStickerPointerUp, true);
    window.removeEventListener("pointercancel", onStickerPointerCancel, true);
    window.removeEventListener("mouseup", onStickerMouseUpFallback, true);
    window.removeEventListener("touchend", onStickerMouseUpFallback, true);
    drag.el?.classList?.remove("dragging");
    try {
      if (drag.pointerId != null) drag.el?.releasePointerCapture?.(drag.pointerId);
    } catch {}

    const sticker = pageData?.stickers?.find(s => s.id === drag.id);
    if (sticker && opts.save !== false) {
      const pos = sticker.position || (sticker.position = {});
      pos.x = Number.isFinite(drag.lastX) ? drag.lastX : pos.x;
      pos.y = Number.isFinite(drag.lastY) ? drag.lastY : pos.y;
      if (Number.isFinite(drag.anchorLeft) && Number.isFinite(drag.anchorTop)) {
        pos.dx = Math.round((pos.x - drag.anchorLeft) * 10) / 10;
        pos.dy = Math.round((pos.y - drag.anchorTop) * 10) / 10;
      }
      sticker.updatedAt = nowIso();
      scheduleSave();
    }

    if (drag.moved || opts.suppressClick) {
      lastStickerDragAt = Date.now();
      suppressStickerClickUntil = Date.now() + 600;
      suppressStickerClickId = drag.id;
    }
  }

  function onStickerPointerUp(e) {
    if (!stickerDragging) return;
    updateStickerPositionFromDrag(e);
    const moved = stickerDragging.moved;
    endStickerDrag({ save: true, suppressClick: moved });
    shieldEvent(e, { prevent: true });
  }

  function onStickerPointerCancel(e) {
    endStickerDrag({ save: true, suppressClick: true });
    shieldEvent(e, { prevent: true });
  }

  function onStickerMouseUpFallback(e) {
    if (!stickerDragging) return;
    // Mouse/touch fallback for sites that swallow pointerup. If clientX/Y exist,
    // update once more before ending the drag.
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) updateStickerPositionFromDrag(e);
    const moved = stickerDragging.moved;
    endStickerDrag({ save: true, suppressClick: moved });
    shieldEvent(e, { prevent: true });
  }

  function unwrapAllHighlights() {
    const spans = Array.from(document.querySelectorAll(`span.${HIGHLIGHT_CLASS}[data-wa-id]`));
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize?.();
    }
  }

  function wrapTextNodeSegment(node, localStart, localEnd, ann, runtime) {
    if (!node || localStart >= localEnd || localStart < 0 || localEnd > node.nodeValue.length) return;
    let selected = node;
    if (localEnd < selected.nodeValue.length) selected.splitText(localEnd);
    if (localStart > 0) selected = selected.splitText(localStart);

    const span = document.createElement("span");
    span.className = HIGHLIGHT_CLASS;
    if (ann.comment?.trim()) span.classList.add("wa-has-comment");
    if (runtime?.status === "modified") span.classList.add("wa-fuzzy");
    span.dataset.waId = ann.id;
    span.dataset.waStatus = runtime?.status || ann.status || "attached";
    span.title = ann.comment?.trim() ? ann.comment.trim() : "Click to add a comment";
    selected.parentNode.insertBefore(span, selected);
    span.appendChild(selected);
  }

  function applyHighlightByOffsets(ann, start, end, model, runtime) {
    const segments = [];
    for (const entry of model.entries) {
      const s = Math.max(start, entry.start);
      const e = Math.min(end, entry.end);
      if (s < e) {
        segments.push({
          node: entry.node,
          localStart: s - entry.start,
          localEnd: e - entry.start,
          globalStart: s
        });
      }
    }
    segments.sort((a, b) => b.globalStart - a.globalStart);
    for (const seg of segments) wrapTextNodeSegment(seg.node, seg.localStart, seg.localEnd, ann, runtime);
  }

  function ensureOverlayLayer() {
    if (overlayLayer && overlayLayer.isConnected) return overlayLayer;
    overlayLayer = document.createElement("div");
    overlayLayer.setAttribute(UI_ATTR, "true");
    overlayLayer.className = "wa-overlay-layer";
    document.documentElement.appendChild(overlayLayer);
    return overlayLayer;
  }

  function clearOverlayLayer() {
    if (overlayLayer) overlayLayer.replaceChildren();
  }

  function boundaryForOffset(offset, model, preferEnd = false) {
    if (!model.entries.length) return null;
    offset = Math.max(0, Math.min(model.text.length, offset));

    for (const entry of model.entries) {
      if (offset > entry.start && offset < entry.end) {
        return { node: entry.node, offset: offset - entry.start };
      }
      if (offset === entry.start && !preferEnd) {
        return { node: entry.node, offset: 0 };
      }
      if (offset === entry.end) {
        return { node: entry.node, offset: entry.length };
      }
    }

    const last = model.entries[model.entries.length - 1];
    return { node: last.node, offset: last.length };
  }

  function rangeForOffsets(start, end, model) {
    const s = boundaryForOffset(start, model, false);
    const e = boundaryForOffset(end, model, true);
    if (!s || !e) return null;
    const range = document.createRange();
    try {
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
      return range;
    } catch {
      range.detach?.();
      return null;
    }
  }

  function applyHighlightOverlayByOffsets(ann, start, end, model, runtime) {
    const range = rangeForOffsets(start, end, model);
    if (!range) return;
    const layer = ensureOverlayLayer();
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
    for (const rect of rects) {
      const div = document.createElement("div");
      div.setAttribute(UI_ATTR, "true");
      div.className = "wa-highlight-overlay";
      if (ann.comment?.trim()) div.classList.add("wa-has-comment");
      if (runtime?.status === "modified") div.classList.add("wa-fuzzy");
      div.dataset.waId = ann.id;
      div.dataset.waStatus = runtime?.status || ann.status || "attached";
      div.title = ann.comment?.trim() ? ann.comment.trim() : "Click to add a comment";
      const highlightColor = normalizeColorValue(ann.color);
      div.style.background = colorToRgba(highlightColor, ann.comment?.trim() ? 0.56 : 0.46);
      if (ann.comment?.trim()) div.style.borderBottomColor = borderColorFor(highlightColor);
      // getClientRects() returns viewport coordinates. Convert to document/page
      // coordinates so absolute overlay rectangles scroll naturally with the text.
      div.style.left = `${rect.left + window.scrollX}px`;
      div.style.top = `${rect.top + window.scrollY}px`;
      div.style.width = `${rect.width}px`;
      div.style.height = `${rect.height}px`;
      layer.appendChild(div);
    }
    range.detach?.();
  }

  function scheduleOverlayRefresh() {
    if (!pageData?.annotations?.length && !pageData?.stickers?.length) return;
    clearTimeout(overlayUpdateTimer);
    overlayUpdateTimer = setTimeout(() => {
      if (!isRendering) renderAnnotations();
    }, 120);
  }

  function documentSize() {
    const doc = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(doc.scrollWidth, doc.clientWidth, body?.scrollWidth || 0, body?.clientWidth || 0, window.innerWidth),
      height: Math.max(doc.scrollHeight, doc.clientHeight, body?.scrollHeight || 0, body?.clientHeight || 0, window.innerHeight)
    };
  }

  function ensureDrawingLayer() {
    if (drawingLayer && drawingLayer.isConnected && drawingCanvas && drawingCanvas.isConnected) return drawingLayer;
    drawingLayer = document.createElement("div");
    drawingLayer.setAttribute(UI_ATTR, "true");
    drawingLayer.className = "wa-drawing-layer";
    drawingCanvas = document.createElement("canvas");
    drawingCanvas.setAttribute(UI_ATTR, "true");
    drawingCanvas.className = "wa-drawing-canvas";
    drawingLayer.appendChild(drawingCanvas);
    document.documentElement.appendChild(drawingLayer);
    drawingCtx = drawingCanvas.getContext("2d");
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchmove", "touchend"]) {
      drawingCanvas.addEventListener(type, (e) => shieldEvent(e, { prevent: drawingMode }), true);
    }
    resizeDrawingCanvas(true);
    updateDrawingLayerInteractivity();
    return drawingLayer;
  }

  function resizeDrawingCanvas(force = false) {
    if (!drawingCanvas || !drawingCtx) return;
    const { width, height } = documentSize();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const targetW = Math.ceil(width * dpr);
    const targetH = Math.ceil(height * dpr);
    if (force || drawingCanvas.width !== targetW || drawingCanvas.height !== targetH) {
      drawingCanvas.width = targetW;
      drawingCanvas.height = targetH;
      drawingCanvas.style.width = `${width}px`;
      drawingCanvas.style.height = `${height}px`;
      drawingCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderDrawingsNow();
    }
  }

  function drawingPointFromEvent(e) {
    return {
      x: Math.round((e.clientX + window.scrollX) * 10) / 10,
      y: Math.round((e.clientY + window.scrollY) * 10) / 10
    };
  }

  function drawStroke(ctx, stroke) {
    const pts = Array.isArray(stroke.points) ? stroke.points : [];
    if (!pts.length) return;
    ctx.save();
    ctx.strokeStyle = normalizeColorValue(stroke.color || currentHighlightColor);
    ctx.lineWidth = Number.isFinite(stroke.width) ? stroke.width : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) {
      ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
    } else {
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function renderDrawingsNow() {
    ensureDrawingLayer();
    if (!drawingCtx || !drawingCanvas) return;
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    const drawings = Array.isArray(pageData?.drawings) ? pageData.drawings : [];
    for (const stroke of drawings) drawStroke(drawingCtx, stroke);
  }

  function renderDrawings() {
    ensureDrawingLayer();
    resizeDrawingCanvas(false);
    if (drawingRaf) cancelAnimationFrame(drawingRaf);
    drawingRaf = requestAnimationFrame(() => {
      drawingRaf = null;
      renderDrawingsNow();
    });
  }

  function updateDrawingLayerInteractivity() {
    ensureDrawingLayer();
    drawingLayer.classList.toggle("active", drawingMode);
    drawingCanvas.style.pointerEvents = drawingMode ? "auto" : "none";
  }

  function setDrawingMode(active) {
    drawingMode = Boolean(active);
    if (drawingMode) {
      setHighlightMode(false);
      ensureToolbar();
      ensureDrawingLayer();
      resizeDrawingCanvas(false);
      activeStroke = null;
    }
    updateDrawingLayerInteractivity();
    updateAnnotatorActiveState();
    renderToolbar();
  }

  function handleDrawingPointerEvent(e) {
    if (!drawingMode) return false;
    if (!["pointerdown", "pointermove", "pointerup", "pointercancel"].includes(e.type)) return false;
    const targetEl = e.target?.nodeType === Node.ELEMENT_NODE ? e.target : e.target?.parentElement;
    const isDrawingTarget = Boolean(targetEl?.closest?.(".wa-drawing-layer"));
    if (!isDrawingTarget && isExtensionUiNode(e.target)) return false;
    if (!isDrawingTarget && e.type === "pointerdown") return false;
    ensureDrawingLayer();
    if (e.type === "pointerdown") {
      if (e.button != null && e.button !== 0) return true;
      if (!Array.isArray(pageData.drawings)) pageData.drawings = [];
      activeStroke = {
        id: `draw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        type: "pencil",
        color: normalizeColorValue(currentHighlightColor),
        width: Number.isFinite(pencilWidth) ? pencilWidth : 3,
        points: [drawingPointFromEvent(e)],
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      pageData.drawings.push(activeStroke);
      drawingCanvas.setPointerCapture?.(e.pointerId);
      renderDrawings();
      return true;
    }
    if (e.type === "pointermove") {
      if (!activeStroke) return true;
      const pt = drawingPointFromEvent(e);
      const pts = activeStroke.points;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 1.5) {
        pts.push(pt);
        activeStroke.updatedAt = nowIso();
        renderDrawings();
      }
      return true;
    }
    if (e.type === "pointerup" || e.type === "pointercancel") {
      if (activeStroke) {
        activeStroke.updatedAt = nowIso();
        activeStroke = null;
        scheduleSave();
        renderDrawings();
      }
      drawingCanvas.releasePointerCapture?.(e.pointerId);
      return true;
    }
    return false;
  }

  async function undoLastDrawing() {
    if (!Array.isArray(pageData?.drawings) || !pageData.drawings.length) return;
    pageData.drawings.pop();
    activeStroke = null;
    renderDrawings();
    scheduleSave();
  }

  function isToolbarVisible() {
    return Boolean(toolbar && toolbar.isConnected);
  }

  function isAnnotatorActive() {
    return highlightMode || drawingMode || isToolbarVisible() || Boolean(commentBox) || Boolean(panel);
  }

  function updateAnnotatorActiveState() {
    const active = isAnnotatorActive();
    document.documentElement.classList.toggle("wa-annotator-active", active);
    if (!active) restoreSuppressedResizeCursors();
  }

  function restoreSuppressedResizeCursors() {
    for (const [el, oldCursor] of suppressedResizeCursorElements.entries()) {
      try {
        if (oldCursor == null) el.style.removeProperty("cursor");
        else el.style.cursor = oldCursor;
        el.removeAttribute("data-wa-resize-suppressed");
      } catch {}
    }
    suppressedResizeCursorElements.clear();
  }

  function cursorLooksLikeResize(cursor) {
    return /(^|[-_\s])(resize|ew-resize|e-resize|w-resize|col-resize|nesw-resize|nwse-resize|grab)([-_\s]|$)/i.test(cursor || "");
  }

  function findResizeHandleElement(target) {
    let el = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    let depth = 0;
    while (el && el !== document.documentElement && depth < 6) {
      if (isExtensionUiNode(el)) return null;
      const cs = window.getComputedStyle(el);
      const marker = `${el.className || ""} ${el.id || ""} ${el.getAttribute?.("role") || ""} ${el.getAttribute?.("aria-label") || ""}`;
      if (cursorLooksLikeResize(cs.cursor) || /resize|resizer|splitter|drag-handle|drawer-handle|gutter/i.test(marker)) return el;
      el = el.parentElement;
      depth += 1;
    }
    return null;
  }

  function suppressResizeCursor(el) {
    if (!el || suppressedResizeCursorElements.has(el)) return;
    suppressedResizeCursorElements.set(el, el.style.cursor || null);
    el.style.cursor = "default";
    el.setAttribute("data-wa-resize-suppressed", "true");
  }

  function maybeSuppressResizeInteraction(e) {
    if (!isAnnotatorActive()) return false;
    const el = findResizeHandleElement(e.target);
    if (!el) return false;
    suppressResizeCursor(el);
    return true;
  }


  function contextScore(modelText, pos, ann, model = null) {
    let score = 0;
    const exact = ann.selector.exact || "";
    const prefix = ann.selector.prefix || "";
    const suffix = ann.selector.suffix || "";
    if (prefix) {
      const nearbyPrefix = modelText.slice(Math.max(0, pos - prefix.length - 140), pos);
      if (nearbyPrefix.endsWith(prefix)) score += 2;
      else if (normalizeWhitespace(nearbyPrefix).endsWith(normalizeWhitespace(prefix).slice(-140))) score += 1;
    }
    if (suffix) {
      const nearbySuffix = modelText.slice(pos + exact.length, pos + exact.length + suffix.length + 140);
      if (nearbySuffix.startsWith(suffix)) score += 2;
      else if (normalizeWhitespace(nearbySuffix).startsWith(normalizeWhitespace(suffix).slice(0, 140))) score += 1;
    }
    const savedHeading = normalizeWhitespace(ann.selector?.sectionContext?.nearestHeading || ann.sectionContext?.nearestHeading || "").toLowerCase();
    if (savedHeading && model) {
      const currentHeading = normalizeWhitespace(sectionContextForOffsets(model, pos, Math.min(model.text.length, pos + exact.length)).nearestHeading || "").toLowerCase();
      if (currentHeading && currentHeading === savedHeading) score += 2.5;
      else if (currentHeading && (currentHeading.includes(savedHeading) || savedHeading.includes(currentHeading))) score += 1.2;
    }
    const oldStart = ann.selector.start;
    if (typeof oldStart === "number") {
      const distance = Math.abs(pos - oldStart);
      score += Math.max(0, 1 - distance / Math.max(5000, modelText.length));
    }
    return score;
  }

  function findAllOccurrences(haystack, needle) {
    const positions = [];
    if (!needle) return positions;
    let idx = haystack.indexOf(needle);
    while (idx >= 0) {
      positions.push(idx);
      idx = haystack.indexOf(needle, idx + Math.max(1, needle.length));
    }
    return positions;
  }

  function levenshteinRatio(a, b) {
    a = a || "";
    b = b || "";
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    if (a.length > 700 || b.length > 700) return 0;
    const prev = new Array(b.length + 1);
    const curr = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    const dist = prev[b.length];
    return 1 - dist / maxLen;
  }

  function bestFuzzyMatch(modelText, ann) {
    const exact = ann.selector.exact || "";
    const exactNorm = normalizeWhitespace(exact).toLowerCase();
    if (exactNorm.length < 16 || exactNorm.length > 700) return null;

    const lower = modelText.toLowerCase();
    const words = exactNorm.split(/\s+/).filter(Boolean);
    const candidatePhrases = [];
    if (words.length >= 5) {
      candidatePhrases.push(words.slice(0, 5).join(" "));
      candidatePhrases.push(words.slice(Math.max(0, Math.floor(words.length / 2) - 2), Math.floor(words.length / 2) + 3).join(" "));
      candidatePhrases.push(words.slice(-5).join(" "));
    }
    const longestWords = [...new Set(words.filter(w => w.length >= 7))].sort((a, b) => b.length - a.length).slice(0, 4);
    candidatePhrases.push(...longestWords);

    const candidates = new Set();
    for (const phrase of candidatePhrases) {
      if (!phrase || phrase.length < 7) continue;
      let idx = lower.indexOf(phrase.toLowerCase());
      let count = 0;
      while (idx >= 0 && count < 80) {
        const exactLower = exact.toLowerCase();
        const phraseInExact = exactLower.indexOf(phrase.toLowerCase());
        const estimatedStart = Math.max(0, idx - Math.max(0, phraseInExact));
        candidates.add(estimatedStart);
        idx = lower.indexOf(phrase.toLowerCase(), idx + phrase.length);
        count++;
      }
    }

    let best = null;
    const exactLen = exact.length;
    for (const start of candidates) {
      for (const delta of [-40, -20, 0, 20, 40]) {
        const len = Math.max(8, exactLen + delta);
        const end = Math.min(modelText.length, start + len);
        const candidateText = modelText.slice(start, end);
        const ratio = levenshteinRatio(normalizeWhitespace(candidateText).toLowerCase(), exactNorm);
        const cScore = contextScore(modelText, start, ann) / 5;
        const score = ratio * 0.85 + cScore * 0.15;
        if (!best || score > best.confidence) {
          best = { start, end, confidence: score, currentText: candidateText };
        }
      }
    }
    if (best && best.confidence >= 0.68) return best;
    return null;
  }

  function candidateListForAnnotation(ann, model, maxCandidates = 8) {
    const exact = ann.selector?.exact || "";
    const out = [];
    const seen = new Set();
    function add(start, end, confidence, reason, currentText) {
      if (start == null || end == null || start < 0 || end <= start || start >= model.text.length) return;
      start = Math.max(0, start);
      end = Math.min(model.text.length, end);
      const key = `${start}:${end}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ start, end, confidence, reason, currentText: currentText ?? model.text.slice(start, end) });
    }

    for (const pos of findAllOccurrences(model.text, exact)) {
      const score = contextScore(model.text, pos, ann, model);
      add(pos, pos + exact.length, 0.74 + Math.min(0.22, score / 20), "exact-candidate", exact);
    }
    if (exact) {
      for (const pos of findAllOccurrences(model.text.toLowerCase(), exact.toLowerCase())) {
        const score = contextScore(model.text, pos, ann, model);
        add(pos, pos + exact.length, 0.62 + Math.min(0.18, score / 20), "case-candidate", model.text.slice(pos, pos + exact.length));
      }
    }

    const exactNorm = normalizeWhitespace(exact).toLowerCase();
    if (exactNorm.length >= 8 && exactNorm.length <= 700) {
      const lower = model.text.toLowerCase();
      const words = exactNorm.split(/\s+/).filter(w => w.length >= 4);
      const phrases = [];
      if (words.length) {
        phrases.push(words.slice(0, Math.min(4, words.length)).join(" "));
        phrases.push(words.slice(Math.max(0, Math.floor(words.length / 2) - 2), Math.min(words.length, Math.floor(words.length / 2) + 2)).join(" "));
        phrases.push(words.slice(Math.max(0, words.length - 4)).join(" "));
      }
      phrases.push(...[...new Set(words.filter(w => w.length >= 7))].slice(0, 6));
      for (const phrase of phrases) {
        if (!phrase || phrase.length < 5) continue;
        let idx = lower.indexOf(phrase.toLowerCase());
        let count = 0;
        while (idx >= 0 && count < 25) {
          const phraseInExact = exactNorm.indexOf(phrase.toLowerCase());
          const start = Math.max(0, idx - Math.max(0, phraseInExact));
          const len = Math.max(8, exact.length);
          const end = Math.min(model.text.length, start + len);
          const currentText = model.text.slice(start, end);
          const ratio = levenshteinRatio(normalizeWhitespace(currentText).toLowerCase(), exactNorm);
          const score = ratio * 0.82 + Math.min(0.18, contextScore(model.text, start, ann, model) / 25);
          if (score >= 0.35) add(start, end, score, "fuzzy-candidate", currentText);
          idx = lower.indexOf(phrase.toLowerCase(), idx + phrase.length);
          count += 1;
        }
      }
    }

    out.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return out.slice(0, maxCandidates);
  }

  function resolveAnnotation(ann, model) {
    const exact = ann.selector?.exact || "";
    const start = ann.selector?.start;
    const end = ann.selector?.end;

    if (typeof start === "number" && typeof end === "number" && start >= 0 && end <= model.text.length) {
      if (model.text.slice(start, end) === exact) {
        return { status: "attached", start, end, confidence: 1, currentText: exact, reason: "same-position" };
      }
    }

    const positions = findAllOccurrences(model.text, exact);
    if (positions.length > 0) {
      let bestPos = positions[0];
      let bestScore = -Infinity;
      for (const pos of positions) {
        const score = contextScore(model.text, pos, ann, model);
        if (score > bestScore) {
          bestScore = score;
          bestPos = pos;
        }
      }
      return {
        status: "attached",
        start: bestPos,
        end: bestPos + exact.length,
        confidence: positions.length === 1 ? 0.95 : 0.82,
        currentText: exact,
        reason: positions.length === 1 ? "exact-quote" : "exact-quote-context"
      };
    }

    const lowerPositions = findAllOccurrences(model.text.toLowerCase(), exact.toLowerCase());
    if (exact && lowerPositions.length > 0) {
      let bestPos = lowerPositions[0];
      let bestScore = -Infinity;
      for (const pos of lowerPositions) {
        const score = contextScore(model.text, pos, ann, model);
        if (score > bestScore) {
          bestScore = score;
          bestPos = pos;
        }
      }
      return {
        status: "modified",
        start: bestPos,
        end: bestPos + exact.length,
        confidence: 0.78,
        currentText: model.text.slice(bestPos, bestPos + exact.length),
        reason: "case-insensitive"
      };
    }

    const fuzzy = bestFuzzyMatch(model.text, ann);
    if (fuzzy) {
      return { status: "modified", ...fuzzy, reason: "fuzzy-text" };
    }

    return { status: "unresolved", start: null, end: null, confidence: 0, currentText: "", reason: "not-found", candidates: candidateListForAnnotation(ann, model) };
  }

  async function loadPageData() {
    const url = canonicalUrl();
    const pageId = pageIdFor(url);
    const key = STORAGE_PREFIX + pageId;
    const result = await chromeGet(key);
    pageData = result[key] || {
      version: 1,
      pageId,
      url: window.location.href,
      canonicalUrl: url,
      title: document.title,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastTextHash: "",
      annotations: [],
      drawings: [],
      stickers: []
    };
    if (!Array.isArray(pageData.drawings)) pageData.drawings = [];
    if (!Array.isArray(pageData.stickers)) pageData.stickers = [];
    pageData.url = window.location.href;
    pageData.canonicalUrl = url;
    pageData.title = document.title;
    pageSetsInitialized = false;
    ensurePageSets();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePageData, 250);
  }

  async function savePageData() {
    if (!pageData) return;
    syncRootToActiveSet();
    pageData.updatedAt = nowIso();
    pageData.setVersion = 2;
    const clone = JSON.parse(JSON.stringify(pageData));
    for (const ann of clone.annotations || []) {
      delete ann._runtime;
    }
    if (!Array.isArray(clone.drawings)) clone.drawings = [];
    if (!Array.isArray(clone.stickers)) clone.stickers = [];
    await chromeSet({ [storageKey()]: clone });
  }

  function showSelectionButton() {
    // Deprecated: this extension now uses explicit highlight mode instead of
    // opening a floating button after every selection. Keeping this as a no-op
    // prevents old calls from reintroducing outside-click behavior on websites.
  }

  function hideSelectionButton() {
    selectionButton?.remove();
    selectionButton = null;
  }

  function ensureHighlightModeBadge() {
    if (highlightModeBadge) return highlightModeBadge;
    highlightModeBadge = document.createElement("div");
    highlightModeBadge.setAttribute(UI_ATTR, "true");
    highlightModeBadge.className = "wa-highlight-mode-badge";
    highlightModeBadge.textContent = "Highlight mode ON — select text. Press Esc to stop.";
    document.documentElement.appendChild(highlightModeBadge);
    return highlightModeBadge;
  }

  function updateHighlightModeBadge() {
    if (highlightMode) {
      ensureHighlightModeBadge();
    } else {
      highlightModeBadge?.remove();
      highlightModeBadge = null;
    }
  }

  async function loadToolbarSettings() {
    const result = await chromeGet(TOOLBAR_SETTINGS_KEY);
    const incoming = result[TOOLBAR_SETTINGS_KEY] || {};
    toolbarSettings = {
      left: Number.isFinite(incoming.left) ? incoming.left : null,
      top: Number.isFinite(incoming.top) ? incoming.top : null
    };
  }

  function scheduleToolbarPositionSave() {
    clearTimeout(toolbarSaveTimer);
    toolbarSaveTimer = setTimeout(() => {
      if (!toolbar) return;
      const rect = toolbar.getBoundingClientRect();
      chromeSet({ [TOOLBAR_SETTINGS_KEY]: { left: rect.left, top: rect.top } });
    }, 300);
  }

  function clampToolbarToViewport() {
    if (!toolbar) return;
    const rect = toolbar.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(maxLeft, Math.max(margin, rect.left));
    const top = Math.min(maxTop, Math.max(margin, rect.top));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    updateToolbarOrientation();
  }

  function updateToolbarOrientation() {
    if (!toolbar) return;
    const rect = toolbar.getBoundingClientRect();
    const nearBottom = rect.top > window.innerHeight - 150;
    const nearSide = rect.left < 120 || rect.right > window.innerWidth - 120;
    toolbar.classList.toggle("horizontal", nearBottom || !nearSide);
    toolbar.classList.toggle("vertical", !nearBottom && nearSide);
  }

  function toolbarSwatchesHtml() {
    const selected = normalizeColorValue(currentHighlightColor);
    const standard = standardColorEntries()
      .map(c => colorSwatchHtml(c, normalizeColorValue(c.value) === selected, "select-color"))
      .join("");
    const custom = customHighlightColors.map(c => `
      <span class="wa-toolbar-custom-wrap">
        ${colorSwatchHtml({ value: c, name: `Custom ${c}` }, normalizeColorValue(c) === selected, "select-color")}
        <button type="button" class="wa-toolbar-remove-color" data-tb-action="remove-custom-color" data-color="${normalizeColorValue(c)}" title="Remove ${normalizeColorValue(c)}">×</button>
      </span>`).join("");
    return `${standard}${custom}`;
  }

  function renderToolbar() {
    if (!toolbar) return;
    toolbar.innerHTML = `
      <div class="wa-toolbar-grip" title="Drag SF toolbar">SF</div>
      <div class="wa-toolbar-body">
        <div class="wa-toolbar-group wa-toolbar-set-group" title="Current annotation set for this page">
          <select class="wa-toolbar-set-select" title="Annotation set">${annotationSetOptionsHtml()}</select>
          <button type="button" class="wa-toolbar-button compact" data-tb-action="new-set" title="Create annotation set">+Set</button>
          <button type="button" class="wa-toolbar-button compact" data-tb-action="rename-set" title="Rename current set">Ren</button>
          <button type="button" class="wa-toolbar-button compact danger" data-tb-action="delete-set" title="Delete current set">Del</button>
        </div>
        <div class="wa-toolbar-group">
          <button type="button" class="wa-toolbar-button ${highlightMode ? "active" : ""}" data-tb-action="toggle-highlight">${highlightMode ? "Stop" : "Start"}</button>
          <button type="button" class="wa-toolbar-button" data-tb-action="open-panel">Notes</button>
        </div>
        <div class="wa-toolbar-group wa-toolbar-stickers" title="Graphic comments: select text first, then choose a shape and click Sticky">
          <select class="wa-toolbar-sticker-select" title="Sticky note type">${stickerOptionsHtml()}</select>
          <button type="button" class="wa-toolbar-button compact" data-tb-action="create-sticker-selected" title="Create graphic comment from selected text">Sticky</button>
        </div>
        <div class="wa-toolbar-group wa-toolbar-colors" title="Color for new highlights and graphic comments">
          ${toolbarSwatchesHtml()}
          <input class="wa-toolbar-custom-picker" type="color" value="${normalizeColorValue(currentHighlightColor)}" aria-label="Custom color picker">
          <button type="button" class="wa-toolbar-button compact" data-tb-action="add-custom-color" title="Save custom color">+</button>
        </div>
        <div class="wa-toolbar-group">
          <button type="button" class="wa-toolbar-button" data-tb-action="export-page">Export</button>
          <button type="button" class="wa-toolbar-button" data-tb-action="import-page">Import</button>
          <button type="button" class="wa-toolbar-button danger" data-tb-action="clear-page">Clear</button>
          <button type="button" class="wa-toolbar-button" data-tb-action="folder-info" title="Folder sync remains in the extension popup">Folder</button>
          <input class="wa-toolbar-import-input" type="file" accept="application/json,.json" hidden>
        </div>
      </div>
    `;
    updateToolbarOrientation();
  }

  function ensureToolbar() {
    if (toolbar && toolbar.isConnected) return toolbar;
    toolbar = document.createElement("div");
    toolbar.setAttribute(UI_ATTR, "true");
    toolbar.className = "wa-toolbar horizontal";
    const left = toolbarSettings.left ?? Math.max(16, Math.round(window.innerWidth * 0.25));
    const top = toolbarSettings.top ?? Math.max(8, window.innerHeight - 86);
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;

    toolbar.addEventListener("pointerdown", onToolbarPointerDown, true);
    toolbar.addEventListener("click", onToolbarClick, true);
    toolbar.addEventListener("input", onToolbarInput, true);
    toolbar.addEventListener("change", onToolbarChange, true);
    for (const type of ["pointerup", "mousedown", "mouseup", "dblclick", "contextmenu", "touchstart", "touchend", "focusin", "focusout", "keydown", "keyup", "keypress", "beforeinput"]) {
      toolbar.addEventListener(type, (e) => shieldEvent(e, { prevent: false }), true);
    }

    document.documentElement.appendChild(toolbar);
    renderToolbar();
    requestAnimationFrame(() => { clampToolbarToViewport(); updateAnnotatorActiveState(); });
    return toolbar;
  }

  function hideToolbar() {
    endToolbarDrag(null, { save: false });
    toolbar?.remove();
    toolbar = null;
    updateAnnotatorActiveState();
  }

  function showToolbar() {
    const tb = ensureToolbar();
    updateAnnotatorActiveState();
    return tb;
  }

  function onToolbarPointerDown(e) {
    const grip = e.target?.closest?.(".wa-toolbar-grip");
    if (!grip) {
      shieldEvent(e, { prevent: false });
      return;
    }

    // If a previous drag was left active because the browser/site swallowed
    // pointerup, terminate it before starting a new drag.
    endToolbarDrag(null, { save: false });

    const rect = toolbar.getBoundingClientRect();

    // Once a user starts dragging, explicitly use left/top positioning.
    // This avoids any conflict with older bottom/right/transform placement.
    toolbar.style.left = `${rect.left}px`;
    toolbar.style.top = `${rect.top}px`;
    toolbar.style.right = "auto";
    toolbar.style.bottom = "auto";
    toolbar.style.transform = "none";
    toolbar.classList.add("dragging");

    toolbarDragging = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left,
      top: rect.top,
      startedAt: Date.now(),
      moved: false
    };

    // Register movement/end handlers before pointer capture. Some pages/browsers
    // are picky about pointer capture during the capture phase; drag should work
    // even if setPointerCapture fails.
    window.addEventListener("pointermove", onToolbarPointerMove, true);
    window.addEventListener("pointerup", onToolbarPointerUp, true);
    window.addEventListener("pointercancel", onToolbarPointerCancel, true);
    window.addEventListener("mouseup", onToolbarMouseUpFallback, true);
    window.addEventListener("touchend", onToolbarMouseUpFallback, true);
    window.addEventListener("blur", onToolbarWindowBlur, true);
    window.addEventListener("keyup", onToolbarKeyUp, true);

    try {
      if (e.pointerId != null) toolbar.setPointerCapture?.(e.pointerId);
    } catch {}

    shieldEvent(e, { prevent: true });
  }

  function onToolbarPointerMove(e) {
    if (!toolbarDragging) return;
    if (e.pointerId != null && toolbarDragging.pointerId != null && e.pointerId !== toolbarDragging.pointerId) return;

    const nextLeft = toolbarDragging.left + e.clientX - toolbarDragging.startX;
    const nextTop = toolbarDragging.top + e.clientY - toolbarDragging.startY;
    toolbar.style.left = `${nextLeft}px`;
    toolbar.style.top = `${nextTop}px`;
    toolbar.style.right = "auto";
    toolbar.style.bottom = "auto";
    toolbar.style.transform = "none";
    toolbarDragging.moved = true;
    clampToolbarToViewport();
    shieldEvent(e, { prevent: true });
  }

  function onToolbarPointerUp(e) {
    endToolbarDrag(e, { save: true });
    shieldEvent(e, { prevent: true });
  }

  function onToolbarPointerCancel(e) {
    endToolbarDrag(e, { save: true });
    shieldEvent(e, { prevent: true });
  }

  function onToolbarMouseUpFallback(e) {
    endToolbarDrag(e, { save: true });
    shieldEvent(e, { prevent: true });
  }

  function onToolbarWindowBlur() {
    endToolbarDrag(null, { save: true });
  }

  function onToolbarKeyUp(e) {
    if (e.key === "Escape") {
      endToolbarDrag(e, { save: true });
      shieldEvent(e, { prevent: true });
    }
  }

  function endToolbarDrag(e = null, { save = true } = {}) {
    if (!toolbarDragging) return;
    const pointerId = toolbarDragging.pointerId;
    toolbarDragging = null;

    try {
      if (toolbar && pointerId != null) toolbar.releasePointerCapture?.(pointerId);
    } catch {}

    window.removeEventListener("pointermove", onToolbarPointerMove, true);
    window.removeEventListener("pointerup", onToolbarPointerUp, true);
    window.removeEventListener("pointercancel", onToolbarPointerCancel, true);
    window.removeEventListener("mouseup", onToolbarMouseUpFallback, true);
    window.removeEventListener("touchend", onToolbarMouseUpFallback, true);
    window.removeEventListener("blur", onToolbarWindowBlur, true);
    window.removeEventListener("keyup", onToolbarKeyUp, true);

    if (toolbar) {
      toolbar.classList.remove("dragging");
      clampToolbarToViewport();
      if (save) scheduleToolbarPositionSave();
    }
  }

  async function onToolbarClick(e) {
    const target = e.target;
    const btn = target?.closest?.("[data-tb-action]");
    if (!btn) {
      shieldEvent(e, { prevent: target?.tagName !== "INPUT" });
      return;
    }
    const action = btn.dataset.tbAction;
    if (action === "toggle-highlight") {
      setHighlightMode(!highlightMode);
    } else if (action === "new-set") {
      await createAnnotationSet();
    } else if (action === "rename-set") {
      await renameActiveAnnotationSet();
    } else if (action === "delete-set") {
      await deleteActiveAnnotationSet();
    } else if (action === "create-sticker-selected") {
      const selectedShape = toolbar?.querySelector(".wa-toolbar-sticker-select")?.value || currentStickerShape || "comment";
      currentStickerShape = STICKER_SHAPES[selectedShape] ? selectedShape : "comment";
      await createStickerFromCurrentSelection(currentStickerShape);
    } else if (action === "open-panel") {
      togglePanel();
    } else if (action === "select-color") {
      await setCurrentHighlightColor(btn.dataset.color);
    } else if (action === "add-custom-color") {
      await addToolbarCustomColor();
    } else if (action === "remove-custom-color") {
      await removeToolbarCustomColor(btn.dataset.color);
    } else if (action === "export-page") {
      exportCurrentPageJson();
    } else if (action === "import-page") {
      toolbar.querySelector(".wa-toolbar-import-input")?.click();
    } else if (action === "clear-page") {
      await clearCurrentPageAnnotations();
    } else if (action === "folder-info") {
      alert("Folder sync uses browser-granted directory permissions and remains in the extension popup. The current page file now stores all annotation sets for this page.");
    }
    shieldEvent(e, { prevent: action !== "import-page" });
  }

  async function onToolbarInput(e) {
    if (e.target?.classList?.contains("wa-toolbar-custom-picker")) {
      currentHighlightColor = normalizeColorValue(e.target.value);
      await saveColorSettings();
    }
    shieldEvent(e, { prevent: false });
  }

  async function onToolbarChange(e) {
    if (e.target?.classList?.contains("wa-toolbar-set-select")) {
      await switchAnnotationSet(e.target.value);
    }
    if (e.target?.classList?.contains("wa-toolbar-sticker-select")) {
      const nextShape = e.target.value;
      currentStickerShape = STICKER_SHAPES[nextShape] ? nextShape : "comment";
    }
    if (e.target?.classList?.contains("wa-toolbar-custom-picker")) {
      currentHighlightColor = normalizeColorValue(e.target.value);
      await saveColorSettings();
      renderToolbar();
    }
    if (e.target?.classList?.contains("wa-toolbar-import-input")) {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (file) await importCurrentPageJsonFile(file);
    }
    shieldEvent(e, { prevent: false });
  }

  async function addToolbarCustomColor() {
    const picker = toolbar?.querySelector(".wa-toolbar-custom-picker");
    const color = normalizeColorValue(picker?.value || currentHighlightColor);
    currentHighlightColor = color;
    if (!customHighlightColors.includes(color)) {
      if (customHighlightColors.length >= MAX_CUSTOM_COLORS) {
        alert(`You can save at most ${MAX_CUSTOM_COLORS} custom colors. Remove one first.`);
        await saveColorSettings();
        renderToolbar();
        return;
      }
      customHighlightColors.push(color);
    }
    await saveColorSettings();
    renderToolbar();
  }

  async function removeToolbarCustomColor(color) {
    color = normalizeColorValue(color);
    customHighlightColors = customHighlightColors.filter(c => normalizeColorValue(c) !== color);
    if (normalizeColorValue(currentHighlightColor) === color) currentHighlightColor = DEFAULT_HIGHLIGHT_COLOR;
    await saveColorSettings();
    renderToolbar();
  }

  function exportCurrentPageJson() {
    if (!pageData) return;
    syncRootToActiveSet();
    const clone = JSON.parse(JSON.stringify(pageData));
    for (const ann of clone.annotations || []) delete ann._runtime;
    const blob = new Blob([JSON.stringify(clone, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = currentPageExportFileName();
    a.style.display = "none";
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  async function importCurrentPageJsonFile(file) {
    const text = await file.text();
    const incoming = JSON.parse(text);
    if (!incoming || (!Array.isArray(incoming.annotations) && !(incoming.sets && typeof incoming.sets === "object"))) {
      alert("Invalid annotation JSON file.");
      return;
    }
    if (!Array.isArray(incoming.drawings)) incoming.drawings = [];
    if (!Array.isArray(incoming.stickers)) incoming.stickers = [];
    incoming.pageId = pageData.pageId;
    incoming.url = window.location.href;
    incoming.canonicalUrl = canonicalUrl();
    incoming.title = document.title;
    incoming.updatedAt = nowIso();
    pageData = incoming;
    pageSetsInitialized = false;
    ensurePageSets();
    await savePageData();
    await renderAnnotations();
    renderToolbar();
  }

  async function clearCurrentPageAnnotations() {
    if (!pageData?.annotations?.length && !pageData?.stickers?.length && !pageData?.drawings?.length) return;
    if (!confirm(`Clear all highlights and graphic comments in annotation set "${getActiveSetName()}"?`)) return;
    pageData.annotations = [];
    pageData.stickers = [];
    pageData.drawings = [];
    closeCommentBox();
    closePanel();
    await renderAnnotations();
    await savePageData();
  }

  function setHighlightMode(active) {
    highlightMode = Boolean(active);
    if (highlightMode && drawingMode) drawingMode = false;
    hideSelectionButton();
    updateHighlightModeBadge();
    updateAnnotatorActiveState();
    renderToolbar();
  }

  async function autoHighlightCurrentSelection() {
    if (!highlightMode || !pageData) return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !normalizeWhitespace(sel.toString())) return false;
    const range = sel.getRangeAt(0);
    if (isExtensionUiNode(range.startContainer) || isExtensionUiNode(range.endContainer)) return false;

    const ann = makeAnnotationFromSelection(currentHighlightColor);
    if (!ann) return false;
    pageData.annotations.push(ann);
    lastAutoHighlightAt = Date.now();
    window.getSelection()?.removeAllRanges();
    await renderAnnotations();
    scheduleSave();
    return true;
  }


  function startCommentBoxDrag(e, box) {
    if (!box) return false;
    if (e.button != null && e.button !== 0) return false;
    const handle = e.target?.closest?.(".wa-comment-drag-handle");
    if (!handle || !box.contains(handle)) return false;

    // A comment box is temporary UI. Moving it should not change any annotation
    // data; it only changes this currently open editor's viewport position.
    endCommentBoxDrag({ suppressClick: true });

    const rect = box.getBoundingClientRect();
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.top)}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";

    commentBoxDragging = {
      box,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      lastLeft: rect.left,
      lastTop: rect.top
    };

    box.classList.add("dragging");
    try { box.setPointerCapture?.(e.pointerId); } catch {}
    window.addEventListener("pointermove", onCommentBoxPointerMove, true);
    window.addEventListener("pointerup", onCommentBoxPointerUp, true);
    window.addEventListener("pointercancel", onCommentBoxPointerCancel, true);
    window.addEventListener("mouseup", onCommentBoxMouseUpFallback, true);
    window.addEventListener("touchend", onCommentBoxMouseUpFallback, true);
    shieldEvent(e, { prevent: true });
    return true;
  }

  function updateCommentBoxPositionFromDrag(e) {
    if (!commentBoxDragging) return false;
    const drag = commentBoxDragging;
    if (e.pointerId != null && drag.pointerId != null && e.pointerId !== drag.pointerId) return true;
    const box = drag.box;
    if (!box?.isConnected) return false;

    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    const width = box.offsetWidth || box.getBoundingClientRect().width || 320;
    const height = box.offsetHeight || box.getBoundingClientRect().height || 220;
    const margin = 6;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    const left = Math.round(Math.min(maxLeft, Math.max(margin, drag.startLeft + dx)));
    const top = Math.round(Math.min(maxTop, Math.max(margin, drag.startTop + dy)));

    drag.lastLeft = left;
    drag.lastTop = top;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";
    return true;
  }

  function onCommentBoxPointerMove(e) {
    if (!commentBoxDragging) return;
    updateCommentBoxPositionFromDrag(e);
    shieldEvent(e, { prevent: true });
  }

  function endCommentBoxDrag(opts = {}) {
    if (!commentBoxDragging) return;
    const drag = commentBoxDragging;
    commentBoxDragging = null;
    window.removeEventListener("pointermove", onCommentBoxPointerMove, true);
    window.removeEventListener("pointerup", onCommentBoxPointerUp, true);
    window.removeEventListener("pointercancel", onCommentBoxPointerCancel, true);
    window.removeEventListener("mouseup", onCommentBoxMouseUpFallback, true);
    window.removeEventListener("touchend", onCommentBoxMouseUpFallback, true);
    drag.box?.classList?.remove("dragging");
    try {
      if (drag.pointerId != null) drag.box?.releasePointerCapture?.(drag.pointerId);
    } catch {}
  }

  function onCommentBoxPointerUp(e) {
    if (!commentBoxDragging) return;
    updateCommentBoxPositionFromDrag(e);
    endCommentBoxDrag();
    shieldEvent(e, { prevent: true });
  }

  function onCommentBoxPointerCancel(e) {
    endCommentBoxDrag();
    shieldEvent(e, { prevent: true });
  }

  function onCommentBoxMouseUpFallback(e) {
    if (!commentBoxDragging) return;
    if (e.clientX != null && e.clientY != null) updateCommentBoxPositionFromDrag(e);
    endCommentBoxDrag();
    shieldEvent(e, { prevent: true });
  }

  function showCommentBox(ann, anchorRect) {
    closeCommentBox();
    commentBox = document.createElement("div");
    commentBox.setAttribute(UI_ATTR, "true");
    commentBox.className = "wa-comment-box";
    commentBox.dataset.waCommentKind = "highlight";
    commentBox.dataset.waCommentId = ann.id;
    const runtime = runtimeById.get(ann.id);
    const quote = runtime?.currentText || ann.selector.exact || "";
    commentBox.innerHTML = `
      <div class="wa-comment-title wa-comment-drag-handle" title="Drag to move this comment box">Annotation <span class="wa-comment-drag-hint">drag</span></div>
      <div class="wa-comment-quote"></div>
      ${annotationColorChoicesHtml(ann.color)}
      <textarea placeholder="Add a comment..."></textarea>
      <div class="wa-button-row">
        <button class="wa-small-button primary" data-action="save">Save</button>
        <button class="wa-small-button" data-action="copy">Copy text</button>
        <button class="wa-small-button danger" data-action="delete">Delete</button>
        <button class="wa-small-button" data-action="close">Close</button>
      </div>
    `;
    commentBox.querySelector(".wa-comment-quote").textContent = truncate(normalizeWhitespace(quote), 220);
    const textarea = commentBox.querySelector("textarea");
    textarea.value = ann.comment || "";
    const x = Math.min(window.innerWidth - 340, Math.max(8, anchorRect.left));
    const y = Math.min(window.innerHeight - 240, Math.max(8, anchorRect.bottom + 8));
    commentBox.style.left = `${x}px`;
    commentBox.style.top = `${y}px`;

    const stopUiEvent = (e) => {
      // Do not let the host page see clicks, keypresses, or focus changes inside
      // the annotation editor. Many app drawers close on those events.
      shieldEvent(e);
    };
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend", "focusin", "focusout", "keydown", "keyup", "keypress", "beforeinput", "input"]) {
      commentBox.addEventListener(type, stopUiEvent, true);
    }

    commentBox.addEventListener("click", async (e) => {
      shieldEvent(e);
      const action = e.target?.dataset?.action;
      if (!action) return;
      if (action === "ann-color") {
        ann.color = normalizeColorValue(e.target?.dataset?.color);
        ann.updatedAt = nowIso();
        await renderAnnotations();
        updateCommentBoxColorSelection(commentBox, ann.color);
        scheduleSave();
      } else if (action === "save") {
        ann.comment = textarea.value;
        ann.updatedAt = nowIso();
        await renderAnnotations();
        scheduleSave();
        closeCommentBox();
      } else if (action === "delete") {
        pageData.annotations = pageData.annotations.filter(a => a.id !== ann.id);
        await renderAnnotations();
        scheduleSave();
        closeCommentBox();
      } else if (action === "copy") {
        navigator.clipboard?.writeText(ann.selector.exact || "");
      } else if (action === "close") {
        closeCommentBox();
      }
    });

    document.documentElement.appendChild(commentBox);
    updateAnnotatorActiveState();
    // Deliberately do not autofocus. Some sites close their side drawer when
    // focus leaves the drawer. The user can click into the textarea; our capture
    // listeners prevent that focus transition from reaching the page.
  }


  function showStickerCommentBox(sticker, anchorRect) {
    closeCommentBox();
    commentBox = document.createElement("div");
    commentBox.setAttribute(UI_ATTR, "true");
    commentBox.className = "wa-comment-box wa-sticker-comment-box";
    commentBox.dataset.waCommentKind = "sticker";
    commentBox.dataset.waCommentId = sticker.id;
    const runtime = runtimeById.get(sticker.id);
    const quote = runtime?.currentText || sticker.selector?.exact || "";
    const info = stickerShapeInfo(sticker.shape);
    commentBox.innerHTML = `
      <div class="wa-comment-title wa-comment-drag-handle" title="Drag to move this comment box">Graphic comment: <span class="wa-comment-shape">${info.symbol}</span> ${info.label} <span class="wa-comment-drag-hint">drag</span></div>
      <div class="wa-comment-quote"></div>
      ${annotationColorChoicesHtml(sticker.color)}
      <textarea placeholder="Add a comment..."></textarea>
      <div class="wa-button-row">
        <button class="wa-small-button primary" data-action="save">Save</button>
        <button class="wa-small-button" data-action="copy">Copy anchor text</button>
        <button class="wa-small-button danger" data-action="delete">Delete</button>
        <button class="wa-small-button" data-action="close">Close</button>
      </div>
    `;
    commentBox.querySelector(".wa-comment-quote").textContent = truncate(normalizeWhitespace(quote), 220);
    const textarea = commentBox.querySelector("textarea");
    textarea.value = sticker.comment || "";
    const x = Math.min(window.innerWidth - 340, Math.max(8, anchorRect.left));
    const y = Math.min(window.innerHeight - 240, Math.max(8, anchorRect.bottom + 8));
    commentBox.style.left = `${x}px`;
    commentBox.style.top = `${y}px`;

    const stopUiEvent = (e) => shieldEvent(e);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend", "focusin", "focusout", "keydown", "keyup", "keypress", "beforeinput", "input"]) {
      commentBox.addEventListener(type, stopUiEvent, true);
    }

    document.documentElement.appendChild(commentBox);
    updateAnnotatorActiveState();
  }

  function updateCommentBoxColorSelection(box, selectedColor) {
    if (!box) return;
    const selected = normalizeColorValue(selectedColor);
    for (const btn of box.querySelectorAll(".wa-color-swatch[data-color]")) {
      btn.classList.toggle("selected", normalizeColorValue(btn.dataset.color) === selected);
    }
  }

  async function handleCommentBoxClick(e) {
    const box = e.target?.closest?.(".wa-comment-box");
    if (!box) return false;
    const action = e.target?.dataset?.action;
    if (!action) return true;
    const kind = box.dataset.waCommentKind || "highlight";
    const textarea = box.querySelector("textarea");
    if (kind === "sticker") {
      const sticker = pageData?.stickers?.find(s => s.id === box.dataset.waCommentId);
      if (!sticker) return true;
      if (action === "ann-color") {
        sticker.color = normalizeColorValue(e.target?.dataset?.color);
        sticker.updatedAt = nowIso();
        await renderAnnotations();
        updateCommentBoxColorSelection(box, sticker.color);
        scheduleSave();
      } else if (action === "save") {
        sticker.comment = textarea?.value || "";
        sticker.updatedAt = nowIso();
        await renderAnnotations();
        scheduleSave();
        closeCommentBox();
      } else if (action === "delete") {
        pageData.stickers = (pageData.stickers || []).filter(s => s.id !== sticker.id);
        await renderAnnotations();
        scheduleSave();
        closeCommentBox();
      } else if (action === "copy") {
        navigator.clipboard?.writeText(sticker.selector?.exact || "");
      } else if (action === "close") {
        closeCommentBox();
      }
      return true;
    }

    const ann = pageData?.annotations?.find(a => a.id === box.dataset.waCommentId);
    if (!ann) return true;

    if (action === "ann-color") {
      ann.color = normalizeColorValue(e.target?.dataset?.color);
      ann.updatedAt = nowIso();
      await renderAnnotations();
      updateCommentBoxColorSelection(box, ann.color);
      scheduleSave();
    } else if (action === "save") {
      ann.comment = textarea?.value || "";
      ann.updatedAt = nowIso();
      await renderAnnotations();
      scheduleSave();
      closeCommentBox();
    } else if (action === "delete") {
      pageData.annotations = pageData.annotations.filter(a => a.id !== ann.id);
      await renderAnnotations();
      scheduleSave();
      closeCommentBox();
    } else if (action === "copy") {
      navigator.clipboard?.writeText(ann.selector.exact || "");
    } else if (action === "close") {
      closeCommentBox();
    }
    return true;
  }

  function closeCommentBox() {
    endCommentBoxDrag({ save: false });
    commentBox?.remove();
    commentBox = null;
    updateAnnotatorActiveState();
  }

  function ensureStatusPill() {
    if (statusPill) return statusPill;
    statusPill = document.createElement("div");
    statusPill.setAttribute(UI_ATTR, "true");
    statusPill.className = "wa-status-pill";
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "focusin", "focusout"]) {
      statusPill.addEventListener(type, (e) => shieldEvent(e), true);
    }
    statusPill.addEventListener("click", (e) => { shieldEvent(e); togglePanel(); });
    document.documentElement.appendChild(statusPill);
    return statusPill;
  }

  function updateStatusPill() {
    if (!pageData) return;
    const annotations = Array.isArray(pageData.annotations) ? pageData.annotations : [];
    const stickers = Array.isArray(pageData.stickers) ? pageData.stickers : [];
    const issues = [...annotations, ...stickers].filter(a => ["modified", "unresolved"].includes(runtimeById.get(a.id)?.status)).length;
    const total = annotations.length + stickers.length;
    const setName = getActiveSetName();
    if (total === 0) {
      statusPill?.remove();
      statusPill = null;
      return;
    }
    const pill = ensureStatusPill();
    pill.textContent = issues > 0 ? `${setName}: ${issues} issue${issues === 1 ? "" : "s"}` : `${setName}: ${total} note${total === 1 ? "" : "s"}`;
  }

  function togglePanel() {
    if (panel) {
      closePanel();
      return;
    }
    openPanel();
  }

  function closePanel() {
    endPanelFastScroll();
    document.removeEventListener("mousemove", onPanelFastScrollMove, true);
    document.removeEventListener("mouseup", endPanelFastScroll, true);
    panel?.remove();
    panel = null;
    updateAnnotatorActiveState();
  }

  function openPanel() {
    closePanel();
    panel = document.createElement("div");
    panel.setAttribute(UI_ATTR, "true");
    panel.className = "wa-panel";
    panel.innerHTML = `
      <div class="wa-panel-header">
        <span>Local Web Annotator — ${escapeHtml(getActiveSetName())}</span>
        <button class="wa-panel-close" data-action="close">×</button>
      </div>
      <div class="wa-panel-body" tabindex="0" aria-label="Annotation list"></div>
    `;
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchend", "focusin", "focusout", "keydown", "keyup", "keypress", "beforeinput", "input"]) {
      panel.addEventListener(type, (e) => shieldEvent(e), true);
    }
    panel.addEventListener("click", onPanelClick);
    const body = panel.querySelector(".wa-panel-body");
    body?.addEventListener("mousedown", onPanelBodyMouseDown, true);
    document.addEventListener("mousemove", onPanelFastScrollMove, true);
    document.addEventListener("mouseup", endPanelFastScroll, true);
    document.documentElement.appendChild(panel);
    updateAnnotatorActiveState();
    renderPanelBody();
  }

  function focusAnnotationList() {
    if (!panel) openPanel();
    const body = panel?.querySelector(".wa-panel-body");
    body?.focus?.({ preventScroll: true });
  }

  function onPanelBodyMouseDown(e) {
    if (e.button !== 1) return;
    const body = panel?.querySelector(".wa-panel-body");
    if (!body) return;
    shieldEvent(e, { prevent: true });
    panelFastScrollState = { body, startY: e.clientY, startScrollTop: body.scrollTop };
    body.style.cursor = "ns-resize";
  }

  function onPanelFastScrollMove(e) {
    if (!panelFastScrollState) return;
    shieldEvent(e, { prevent: true });
    const dy = e.clientY - panelFastScrollState.startY;
    panelFastScrollState.body.scrollTop = panelFastScrollState.startScrollTop + dy * 4;
  }

  function endPanelFastScroll() {
    if (!panelFastScrollState) return;
    try { panelFastScrollState.body.style.cursor = ""; } catch {}
    panelFastScrollState = null;
  }

  function renderPanelBody() {
    if (!panel) return;
    const body = panel.querySelector(".wa-panel-body");
    const anns = Array.isArray(pageData.annotations) ? pageData.annotations : [];
    const stickers = Array.isArray(pageData.stickers) ? pageData.stickers : [];
    if (!anns.length && !stickers.length) {
      body.innerHTML = `<div class="wa-panel-help">Alt+A focuses this annotation list. Esc exits list focus.</div><div>No annotations in set <strong>${escapeHtml(getActiveSetName())}</strong> yet.</div>`;
      return;
    }
    body.innerHTML = `<div class="wa-panel-help">Alt+A focuses this annotation list. Mouse wheel scrolls the list. Hold the mouse wheel and move up/down for fast scroll. Esc exits list focus or closes drag modes.</div>`;
    for (const ann of anns) {
      const runtime = runtimeById.get(ann.id) || { status: ann.status || "unknown", confidence: 0 };
      const card = document.createElement("div");
      card.className = `wa-ann-card ${runtime.status === "unresolved" ? "unresolved" : ""}`;
      card.dataset.id = ann.id;
      const statusLabel = runtime.status === "modified"
        ? `changed candidate, confidence ${Math.round((runtime.confidence || 0) * 100)}%`
        : runtime.status;
      const annColor = normalizeColorValue(ann.color);
      card.innerHTML = `
        <div class="wa-ann-meta"><span class="wa-color-dot" style="background:${annColor}"></span>Status: ${statusLabel}</div>
        <div class="wa-ann-quote"></div>
        ${ann.comment ? `<div class="wa-ann-comment"></div>` : ""}
        <div class="wa-button-row">
          <button class="wa-small-button" data-action="scroll" data-id="${ann.id}">Go to</button>
          <button class="wa-small-button" data-action="edit" data-id="${ann.id}">Comment</button>
          ${runtime.status === "modified" ? `<button class="wa-small-button primary" data-action="accept" data-id="${ann.id}">Accept new text</button>` : ""}
          ${runtime.status === "unresolved" ? `<button class="wa-small-button primary" data-action="attach" data-id="${ann.id}">Attach to current selection</button>` : ""}
          <button class="wa-small-button" data-action="copy" data-id="${ann.id}">Copy</button>
          <button class="wa-small-button danger" data-action="delete" data-id="${ann.id}">Delete</button>
        </div>
      `;
      card.querySelector(".wa-ann-quote").textContent = `“${truncate(normalizeWhitespace(runtime.currentText || ann.selector.exact), 260)}”`;
      const c = card.querySelector(".wa-ann-comment");
      if (c) c.textContent = ann.comment;
      body.appendChild(card);
    }

    for (const sticker of stickers) {
      const runtime = runtimeById.get(sticker.id) || { status: sticker.status || "unknown", confidence: 0 };
      const info = stickerShapeInfo(sticker.shape);
      const card = document.createElement("div");
      card.className = `wa-ann-card wa-sticker-card ${runtime.status === "unresolved" ? "unresolved" : ""}`;
      card.dataset.id = sticker.id;
      const statusLabel = runtime.status === "modified"
        ? `changed anchor, confidence ${Math.round((runtime.confidence || 0) * 100)}%`
        : runtime.status;
      const stickerColor = normalizeColorValue(sticker.color);
      card.innerHTML = `
        <div class="wa-ann-meta"><span class="wa-color-dot" style="background:${stickerColor}"></span>Graphic: ${info.symbol} ${info.label}. Status: ${statusLabel}</div>
        <div class="wa-ann-quote"></div>
        ${sticker.comment ? `<div class="wa-ann-comment"></div>` : ""}
        <div class="wa-button-row">
          <button class="wa-small-button" data-action="scroll-sticker" data-id="${sticker.id}">Go to</button>
          <button class="wa-small-button" data-action="edit-sticker" data-id="${sticker.id}">Comment</button>
          <button class="wa-small-button" data-action="copy-sticker" data-id="${sticker.id}">Copy anchor text</button>
          <button class="wa-small-button danger" data-action="delete-sticker" data-id="${sticker.id}">Delete</button>
        </div>
      `;
      card.querySelector(".wa-ann-quote").textContent = `Anchored to: “${truncate(normalizeWhitespace(runtime.currentText || sticker.selector?.exact || ""), 240)}”`;
      const c = card.querySelector(".wa-ann-comment");
      if (c) c.textContent = sticker.comment;
      body.appendChild(card);
    }
  }

  function firstVisualForAnnotation(id) {
    return document.querySelector(`.wa-highlight-overlay[data-wa-id="${CSS.escape(id)}"]`) ||
      document.querySelector(`.${HIGHLIGHT_CLASS}[data-wa-id="${CSS.escape(id)}"]`);
  }

  function clearTemporaryCandidateMarkers() {
    document.querySelectorAll(".wa-temp-candidate").forEach(el => el.remove());
  }

  function flashRangeCandidate(start, end, model) {
    clearTemporaryCandidateMarkers();
    const range = rangeForOffsets(start, end, model);
    if (!range) return false;
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
    if (!rects.length) { range.detach?.(); return false; }
    const layer = ensureOverlayLayer();
    for (const rect of rects.slice(0, 6)) {
      const mark = document.createElement("div");
      mark.setAttribute(UI_ATTR, "true");
      mark.className = "wa-temp-candidate";
      mark.style.left = `${rect.left + window.scrollX}px`;
      mark.style.top = `${rect.top + window.scrollY}px`;
      mark.style.width = `${rect.width}px`;
      mark.style.height = `${rect.height}px`;
      layer.appendChild(mark);
    }
    const el = range.startContainer?.parentElement || range.commonAncestorContainer?.parentElement;
    el?.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
    setTimeout(clearTemporaryCandidateMarkers, 3500);
    range.detach?.();
    return true;
  }

  function scrollToNextCandidate(id) {
    const runtime = runtimeById.get(id);
    const candidates = runtime?.candidates || [];
    if (!candidates.length) return false;
    const idx = ((candidateCycleById.get(id) || 0) % candidates.length);
    candidateCycleById.set(id, idx + 1);
    const c = candidates[idx];
    const ok = flashRangeCandidate(c.start, c.end, buildTextModel());
    if (ok) {
      const msg = `Candidate ${idx + 1}/${candidates.length}, confidence ${Math.round((c.confidence || 0) * 100)}%`;
      const card = panel?.querySelector(`.wa-ann-card[data-id="${CSS.escape(id)}"] .wa-ann-meta`);
      if (card) card.append(document.createTextNode(` — ${msg}`));
    }
    return ok;
  }

  function scrollToAnnotation(id) {
    const runtime = runtimeById.get(id);
    if (!runtime || runtime.start == null || runtime.end == null) return false;
    const model = buildTextModel();
    const range = rangeForOffsets(runtime.start, runtime.end, model);
    const node = range?.startContainer;
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (el?.scrollIntoView) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      setTimeout(scheduleOverlayRefresh, 350);
      range?.detach?.();
      return true;
    }
    range?.detach?.();
    return false;
  }

  async function onPanelClick(e) {
    shieldEvent(e);
    const action = e.target?.dataset?.action;
    const id = e.target?.dataset?.id;
    if (action === "close") return closePanel();
    if (!action || !id) return;

    if (action.endsWith("-sticker")) {
      const sticker = pageData?.stickers?.find(s => s.id === id);
      if (!sticker) return;
      const el = firstStickerVisual(id);
      if (action === "scroll-sticker") {
        if (el) el.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
        else if (!scrollToNextCandidate(id)) alert("No exact location is available. The extension could not find candidate locations for this graphic comment.");
      }
      if (action === "edit-sticker") {
        const rect = el?.getBoundingClientRect?.() || { left: window.innerWidth - 350, bottom: 90 };
        showStickerCommentBox(sticker, rect);
      }
      if (action === "copy-sticker") {
        navigator.clipboard?.writeText(sticker.selector?.exact || "");
      }
      if (action === "delete-sticker") {
        pageData.stickers = (pageData.stickers || []).filter(s => s.id !== id);
        await renderAnnotations();
        scheduleSave();
        renderPanelBody();
      }
      return;
    }

    const ann = pageData.annotations.find(a => a.id === id);
    if (!ann) return;
    const runtime = runtimeById.get(id);

    if (action === "scroll") {
      if (!scrollToAnnotation(id)) {
        const el = firstVisualForAnnotation(id);
        if (el) el.scrollIntoView?.({ behavior: "smooth", block: "center" });
        else if (!scrollToNextCandidate(id)) alert("No exact location is available. The extension could not find candidate locations for this annotation.");
      }
    }
    if (action === "edit") {
      const el = firstVisualForAnnotation(id);
      const rect = el?.getBoundingClientRect?.() || { left: window.innerWidth - 350, bottom: 90 };
      showCommentBox(ann, rect);
    }
    if (action === "copy") {
      navigator.clipboard?.writeText(ann.selector.exact || "");
    }
    if (action === "delete") {
      pageData.annotations = pageData.annotations.filter(a => a.id !== id);
      await renderAnnotations();
      scheduleSave();
      renderPanelBody();
    }
    if (action === "accept" && runtime?.status === "modified") {
      updateAnnotationAnchorFromOffsets(ann, runtime.start, runtime.end);
      await renderAnnotations();
      scheduleSave();
      renderPanelBody();
    }
    if (action === "attach") {
      const model = buildTextModel();
      const offsets = selectionToOffsets(model);
      if (!offsets) {
        alert("Select the replacement text on the page first, then click Attach to current selection.");
        return;
      }
      updateAnnotationAnchorFromOffsets(ann, offsets.start, offsets.end);
      window.getSelection()?.removeAllRanges();
      await renderAnnotations();
      scheduleSave();
      renderPanelBody();
    }
  }

  function updateAnnotationAnchorFromOffsets(ann, start, end) {
    const model = buildTextModel();
    const exact = model.text.slice(start, end);
    ann.selector.exact = exact;
    ann.selector.prefix = model.text.slice(Math.max(0, start - CONTEXT_CHARS), start);
    ann.selector.suffix = model.text.slice(end, Math.min(model.text.length, end + CONTEXT_CHARS));
    ann.selector.start = start;
    ann.selector.end = end;
    ann.selector.sectionContext = sectionContextForOffsets(model, start, end);
    ann.status = "attached";
    ann.updatedAt = nowIso();
    ann.pageState = ann.pageState || {};
    ann.pageState.title = document.title;
    ann.pageState.textHash = model.textHash;
    ann.pageState.savedAt = nowIso();
  }

  async function renderAnnotations() {
    if (!pageData) return;
    ensurePageSets();
    isRendering = true;
    hideSelectionButton();
    // The current renderer uses non-mutating overlay highlights. We only unwrap
    // old span-based highlights from earlier versions if they still exist.
    unwrapAllHighlights();
    clearOverlayLayer();
    await sleep(0);

    runtimeById = new Map();
    const model = buildTextModel();
    pageData.lastTextHash = model.textHash;
    pageData.title = document.title;
    pageData.url = window.location.href;
    pageData.canonicalUrl = canonicalUrl();

    for (const ann of pageData.annotations) {
      const runtime = resolveAnnotation(ann, model);
      runtimeById.set(ann.id, runtime);
      ann.status = runtime.status;
      ann.confidence = runtime.confidence;
      if (runtime.status === "attached" || runtime.status === "modified") {
        applyHighlightOverlayByOffsets(ann, runtime.start, runtime.end, model, runtime);
      }
    }

    renderStickers(model);
    updateStatusPill();
    renderPanelBody();
    lastRenderAt = Date.now();
    isRendering = false;
  }

  function setupSelectionListener() {
    const pageMouseEvents = ["pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mousemove", "mouseup", "click", "dblclick", "contextmenu", "touchstart", "touchmove", "touchend"];

    async function handleExtensionClick(e) {
      if (toolbar && toolbar.contains(e.target)) {
        if (e.type === "pointerdown") onToolbarPointerDown(e);
        if (e.type === "click") await onToolbarClick(e);
        return true;
      }

      if (commentBox && commentBox.contains(e.target) && e.type === "pointerdown") {
        if (startCommentBoxDrag(e, commentBox)) return true;
      }

      const stickerHit = e.target?.closest?.(`.wa-sticker[data-wa-sticker-id]`);
      if (stickerHit && e.type === "pointerdown") {
        startStickerDrag(e, stickerHit);
        return true;
      }
      if (stickerHit && e.type === "click") {
        const stickerId = stickerHit.dataset.waStickerId;
        const suppressThisClick = Date.now() < suppressStickerClickUntil && (!suppressStickerClickId || suppressStickerClickId === stickerId);
        if (!suppressThisClick && Date.now() - lastStickerDragAt > 450) {
          const sticker = pageData?.stickers?.find(s => s.id === stickerId);
          if (sticker) showStickerCommentBox(sticker, stickerHit.getBoundingClientRect());
        }
        return true;
      }

      const overlay = e.target?.closest?.(`.wa-highlight-overlay[data-wa-id]`);
      const span = e.target?.closest?.(`.${HIGHLIGHT_CLASS}[data-wa-id]`); // legacy span fallback
      const hit = overlay || span;
      if (hit && e.type === "click") {
        const id = hit.dataset.waId;
        const ann = pageData?.annotations?.find(a => a.id === id);
        if (ann) showCommentBox(ann, hit.getBoundingClientRect());
        return true;
      }

      if (statusPill && statusPill.contains(e.target) && e.type === "click") {
        togglePanel();
        return true;
      }

      if (commentBox && commentBox.contains(e.target) && e.type === "click") {
        await handleCommentBoxClick(e);
        return true;
      }

      if (panel && panel.contains(e.target) && e.type === "click") {
        await onPanelClick(e);
        return true;
      }

      return eventTouchesExtensionUi(e);
    }

    function maybeAutoHighlightFromMouseup(e) {
      if (!highlightMode || e.__waAutoHighlightQueued) return;
      if (e.type !== "mouseup" && e.type !== "touchend" && e.type !== "pointerup") return;
      if (isExtensionUiNode(e.target)) return;
      e.__waAutoHighlightQueued = true;
      setTimeout(async () => {
        try { await autoHighlightCurrentSelection(); }
        catch (err) { console.error(err); }
      }, 0);
    }

    function onGlobalCapture(e) {
      if (e.__waShielded) return;

      // When a comment editor is being dragged, handle that before the general
      // extension-UI shield runs. This makes the editor temporarily movable
      // without letting the host page see the drag events.
      if (commentBoxDragging) {
        if (e.type === "pointermove") {
          e.__waShielded = true;
          onCommentBoxPointerMove(e);
          return;
        }
        if (e.type === "pointerup") {
          e.__waShielded = true;
          onCommentBoxPointerUp(e);
          return;
        }
        if (e.type === "pointercancel") {
          e.__waShielded = true;
          onCommentBoxPointerCancel(e);
          return;
        }
        if (e.type === "mouseup" || e.type === "touchend") {
          e.__waShielded = true;
          onCommentBoxMouseUpFallback(e);
          return;
        }
      }

      // When a sticky note is being dragged, handle the drag before the general
      // extension-UI shield runs. Pointer capture can retarget pointermove
      // events; without this priority path, the generic shield can interpret a
      // long drag as a click and reopen the comment box.
      if (stickerDragging) {
        if (e.type === "pointermove") {
          e.__waShielded = true;
          onStickerPointerMove(e);
          return;
        }
        if (e.type === "pointerup") {
          e.__waShielded = true;
          onStickerPointerUp(e);
          return;
        }
        if (e.type === "pointercancel") {
          e.__waShielded = true;
          onStickerPointerCancel(e);
          return;
        }
        if (e.type === "mouseup" || e.type === "touchend") {
          e.__waShielded = true;
          onStickerMouseUpFallback(e);
          return;
        }
      }

      // When the SF toolbar is being dragged, handle the drag before the
      // general extension-UI shield runs. Pointer capture can retarget
      // pointermove events to the toolbar; without this priority path, the
      // generic shield can stop the event before onToolbarPointerMove sees it.
      if (toolbarDragging) {
        if (e.type === "pointermove") {
          e.__waShielded = true;
          onToolbarPointerMove(e);
          return;
        }
        if (e.type === "pointerup") {
          e.__waShielded = true;
          onToolbarPointerUp(e);
          return;
        }
        if (e.type === "pointercancel") {
          e.__waShielded = true;
          onToolbarPointerCancel(e);
          return;
        }
        if (e.type === "mouseup" || e.type === "touchend") {
          e.__waShielded = true;
          onToolbarMouseUpFallback(e);
          return;
        }
      }

      if (drawingMode && handleDrawingPointerEvent(e)) {
        e.__waShielded = true;
        shieldEvent(e, { prevent: true });
        return;
      }

      if (maybeSuppressResizeInteraction(e)) {
        e.__waShielded = true;
        shieldEvent(e, { prevent: true });
        return;
      }

      if (["pointerup", "mouseup", "touchend", "keyup"].includes(e.type) && !isExtensionUiNode(e.target)) {
        setTimeout(() => { try { rememberCurrentSelection(); } catch {} }, 0);
      }

      // Extension UI/highlight overlays are handled here because if the event
      // reaches the host page, app drawers often close as an outside click.
      if (eventTouchesExtensionUi(e)) {
        e.__waShielded = true;
        if ((e.type === "mousedown" || e.type === "pointerdown" || e.type === "click") && isEditableExtensionTarget(e.target)) {
          setTimeout(() => e.target?.focus?.(), 0);
        }
        handleExtensionClick(e).catch?.(console.error);
        const isButtonLike = e.target?.closest?.("button, [data-action], .wa-highlight-overlay");
        const shouldPrevent = isButtonLike && !isEditableExtensionTarget(e.target);
        shieldEvent(e, { prevent: shouldPrevent && pageMouseEvents.includes(e.type) });
        return;
      }

      // While highlight mode is active, allow native text selection but prevent
      // the page from receiving mouse/click events that close side drawers.
      if (highlightMode && ["pointerup", "mouseup", "click", "dblclick", "contextmenu", "touchend"].includes(e.type)) {
        maybeAutoHighlightFromMouseup(e);
        e.__waShielded = true;
        shieldEvent(e, { prevent: false });
        return;
      }

      // If focus is moving into our editor, suppress the focus event path so the
      // website cannot interpret this as "instruction drawer lost focus".
      if ((e.type === "focusout" || e.type === "blur") && isExtensionUiNode(e.relatedTarget)) {
        e.__waShielded = true;
        shieldEvent(e);
      }
    }

    for (const type of [...pageMouseEvents, "focusin", "focusout", "blur"]) {
      window.addEventListener(type, onGlobalCapture, true);
      document.addEventListener(type, onGlobalCapture, true);
    }

    document.addEventListener("keydown", (e) => {
      if (e.altKey && String(e.key || "").toLowerCase() === "a") {
        shieldEvent(e, { prevent: true });
        focusAnnotationList();
        return;
      }
      if (isExtensionUiNode(e.target)) {
        if (e.key === "Escape" && panel?.querySelector(".wa-panel-body") === e.target) {
          shieldEvent(e, { prevent: true });
          e.target.blur?.();
          return;
        }
        shieldEvent(e, { prevent: false });
        return;
      }
      if (e.key === "Escape" && commentBoxDragging) endCommentBoxDrag({ suppressClick: true });
      else if (e.key === "Escape" && drawingMode) setDrawingMode(false);
      else if (e.key === "Escape" && highlightMode) setHighlightMode(false);
    }, true);

    window.addEventListener("scroll", () => { scheduleOverlayRefresh(); resizeDrawingCanvas(false); }, true);
    window.addEventListener("resize", () => { scheduleOverlayRefresh(); clampToolbarToViewport(); resizeDrawingCanvas(false); }, true);
  }

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      if (isRendering) return;
      if (Date.now() - lastRenderAt < 1000) return;
      if (!pageData?.annotations?.length && !pageData?.stickers?.length && !pageData?.drawings?.length) return;
      if (mutations.every(m => isExtensionUiNode(m.target))) return;
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        if (!isRendering) renderAnnotations();
      }, 1200);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message?.type === "WA_GET_PAGE_DATA") {
        syncRootToActiveSet();
        sendResponse({ ok: true, pageData, activeSetName: getActiveSetName(), setNames: orderedAnnotationSetNames(), runtime: Array.from(runtimeById.entries()), highlightMode, drawingMode, toolbarVisible: isToolbarVisible(), currentHighlightColor });
        return;
      }
      if (message?.type === "WA_SHOW_TOOLBAR") {
        showToolbar();
        sendResponse({ ok: true, toolbarVisible: true, drawingMode });
        return;
      }
      if (message?.type === "WA_HIDE_TOOLBAR") {
        hideToolbar();
        sendResponse({ ok: true, toolbarVisible: false, drawingMode });
        return;
      }
      if (message?.type === "WA_SET_DRAWING_MODE") {
        setDrawingMode(Boolean(message.active));
        sendResponse({ ok: true, drawingMode });
        return;
      }
      if (message?.type === "WA_SET_HIGHLIGHT_MODE") {
        setHighlightMode(Boolean(message.active));
        sendResponse({ ok: true, highlightMode });
        return;
      }
      if (message?.type === "WA_SET_CURRENT_COLOR") {
        currentHighlightColor = normalizeColorValue(message.color);
        await saveColorSettings();
        renderToolbar();
        sendResponse({ ok: true, currentHighlightColor });
        return;
      }
      if (message?.type === "WA_SET_PAGE_DATA") {
        const incoming = message.pageData;
        if (!incoming || (!Array.isArray(incoming.annotations) && !(incoming.sets && typeof incoming.sets === "object"))) throw new Error("Invalid annotation file.");
        if (!Array.isArray(incoming.drawings)) incoming.drawings = [];
        if (!Array.isArray(incoming.stickers)) incoming.stickers = [];
        incoming.pageId = pageData.pageId;
        incoming.url = window.location.href;
        incoming.canonicalUrl = canonicalUrl();
        incoming.title = document.title;
        incoming.updatedAt = nowIso();
        pageData = incoming;
        pageSetsInitialized = false;
        ensurePageSets();
        await savePageData();
        await renderAnnotations();
        sendResponse({ ok: true, pageData, activeSetName: getActiveSetName(), setNames: orderedAnnotationSetNames() });
        return;
      }
      if (message?.type === "WA_SET_ACTIVE_SET") {
        await switchAnnotationSet(message.name);
        sendResponse({ ok: true, pageData, activeSetName: getActiveSetName(), setNames: orderedAnnotationSetNames() });
        return;
      }
      if (message?.type === "WA_RENDER") {
        await renderAnnotations();
        sendResponse({ ok: true });
        return;
      }
    })().catch((err) => {
      console.error(err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
    return true;
  });

  async function waitForBody() {
    if (document.body) return;
    await new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      } else {
        resolve();
      }
    });
    while (!document.body) await sleep(25);
  }

  async function init() {
    // Install input listeners as early as possible. This helps on sites that
    // close right-side panels using global click/mouseup handlers.
    setupSelectionListener();
    await loadColorSettings();
    await loadToolbarSettings();
    await waitForBody();
    await loadPageData();
    setupMutationObserver();
    await renderAnnotations();
  }

  init().catch(console.error);
})();
