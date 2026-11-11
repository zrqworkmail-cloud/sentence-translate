/*
 * Sentence Translate for Zotero
 *
 * Click a sentence in a PDF: the sentence is tinted and its Chinese
 * translation appears directly underneath. Clicking another sentence moves
 * both. Translation is delegated to Translate for Zotero when it is installed.
 *
 * Independent implementation; no code from other Zotero plugins.
 */

"use strict";

const PREF_PREFIX = "extensions.zotero.sentenceTranslate.";
const DEFAULTS = {
	enabled: true,
	color: "#ffd23f",
	opacity: 38,
	targetLang: "zh-CN",
	maxLines: 3,
};

let addonID = "";
let rootDir = "";
let TextLib = null;
let started = false;

const readerStates = new Map();
const translationCache = new Map();
const CACHE_LIMIT = 200;

// --- preferences -----------------------------------------------------------

function pref(key) {
	try {
		const value = Zotero.Prefs.get(PREF_PREFIX + key, true);
		return value === undefined || value === null ? DEFAULTS[key] : value;
	}
	catch (e) {
		return DEFAULTS[key];
	}
}

function registerDefaults() {
	const branch = Services.prefs.getDefaultBranch(PREF_PREFIX);
	branch.setBoolPref("enabled", DEFAULTS.enabled);
	branch.setStringPref("color", DEFAULTS.color);
	branch.setIntPref("opacity", DEFAULTS.opacity);
	branch.setStringPref("targetLang", DEFAULTS.targetLang);
	branch.setIntPref("maxLines", DEFAULTS.maxLines);
}

// --- lifecycle -------------------------------------------------------------

function startup({ id, version, rootURI }) {
	addonID = id;
	rootDir = rootURI;
	if (started) return;
	started = true;

	registerDefaults();
	Services.scriptloader.loadSubScript(rootURI + "lib/text.js", globalThis);
	TextLib = globalThis.SentenceText;
	if (!TextLib || typeof TextLib.pageUnits !== "function") {
		throw new Error("Sentence Translate: text library failed to load");
	}

	try {
		Zotero.PreferencePanes.register({
			pluginID: id,
			src: rootURI + "prefs.xhtml",
			label: "Sentence Translate",
			image: rootURI + "icon.svg",
			stylesheets: [rootURI + "prefs.css"],
		});
	}
	catch (e) {
		Zotero.debug("Sentence Translate: cannot register preferences - " + e);
	}

	Zotero.Reader.registerEventListener("renderToolbar", onReaderToolbar, id);

	for (const reader of Array.from(Zotero.Reader._readers || [])) {
		attachReader(reader);
	}

	Zotero.debug(`Sentence Translate ${version} starting`);
}

function shutdown() {
	if (!started) return;
	started = false;

	try {
		Zotero.Reader.unregisterEventListener("renderToolbar", onReaderToolbar, addonID);
	}
	catch (e) { /* older API */ }

	for (const state of Array.from(readerStates.values())) {
		detachReader(state.reader);
	}
	readerStates.clear();
	translationCache.clear();

	try {
		Zotero.PreferencePanes.unregister(addonID);
	}
	catch (e) { /* unregister is optional */ }
}

function install() {}
function uninstall() {}

// --- readers ---------------------------------------------------------------

function onReaderToolbar(event) {
	if (event && event.reader) attachReader(event.reader);
}

function attachReader(reader) {
	if (!reader || readerStates.has(reader)) return;
	const state = {
		reader,
		win: null,
		doc: null,
		seq: 0,
		layer: null,
		strip: null,
		pageEl: null,
		unit: null,
		models: new Map(),
		onClick: null,
		onPageRendered: null,
		onUnload: null,
	};
	readerStates.set(reader, state);

	waitForReaderWindow(state)
		.then((win) => {
			if (!win || readerStates.get(reader) !== state) return;
			bindReader(state, win);
		})
		.catch((e) => Zotero.debug("Sentence Translate: attach failed - " + e));
}

async function waitForReaderWindow(state) {
	for (let attempt = 0; attempt < 80; attempt++) {
		if (!readerStates.has(state.reader)) return null;
		let win = null;
		try {
			win = state.reader._lastView?._iframeWindow
				|| state.reader._internalReader?._primaryView?._iframeWindow
				|| state.reader._iframeWindow;
		}
		catch (e) {
			win = null;
		}
		const app = win && win.PDFViewerApplication;
		if (app) {
			try { await app.initializedPromise; }
			catch (e) { /* still usable */ }
			return win;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return null;
}

function bindReader(state, win) {
	state.win = win;
	state.doc = win.document;
	state.doc.documentElement.setAttribute("data-sentence-translate", "on");

	injectCSS(state.doc);

	state.onClick = (event) => onDocumentClick(event, state);
	state.doc.addEventListener("click", state.onClick, true);

	state.onPageRendered = () => clearPaint(state);
	try {
		win.PDFViewerApplication.eventBus.on("pagerendered", state.onPageRendered);
	}
	catch (e) { /* event bus missing */ }

	state.onUnload = () => detachReader(state.reader);
	win.addEventListener("pagehide", state.onUnload, true);
}

function detachReader(reader) {
	const state = readerStates.get(reader);
	if (!state) return;
	readerStates.delete(reader);
	clearPaint(state);

	try {
		if (state.doc && state.onClick) {
			state.doc.removeEventListener("click", state.onClick, true);
			state.doc.documentElement.removeAttribute("data-sentence-translate");
		}
		if (state.win && state.onPageRendered) {
			state.win.PDFViewerApplication.eventBus.off("pagerendered", state.onPageRendered);
		}
		if (state.win && state.onUnload) {
			state.win.removeEventListener("pagehide", state.onUnload, true);
		}
	}
	catch (e) { /* the tab is already gone */ }
}

// --- click handling --------------------------------------------------------

function onDocumentClick(event, state) {
	if (!pref("enabled")) return;
	if (event.defaultPrevented || event.button !== 0) return;
	if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

	const target = event.target;
	if (!target || typeof target.closest !== "function") return;
	if (target.closest("a, .annotationLayer, .highlightLayer, .linkAnnotation, .popup, .sft-strip")) {
		return;
	}

	const pageEl = target.closest(".page");
	if (!pageEl || !pageEl.dataset || !pageEl.dataset.pageNumber) return;

	const selection = state.win.getSelection ? state.win.getSelection() : null;
	if (selection && !selection.isCollapsed) return;

	const box = pageEl.getBoundingClientRect();
	if (!box.width || !box.height) return;
	const x = event.clientX - box.left;
	const y = event.clientY - box.top;
	if (x < 0 || y < 0 || x > box.width || y > box.height) return;

	const pageIndex = Number(pageEl.dataset.pageNumber) - 1;
	selectSentence(state, pageEl, pageIndex, x, y);
}

async function selectSentence(state, pageEl, pageIndex, x, y) {
	const seq = ++state.seq;
	let model;
	try {
		model = await pageModel(state, pageEl, pageIndex);
	}
	catch (e) {
		Zotero.debug("Sentence Translate: cannot read page text - " + e);
		return;
	}
	if (seq !== state.seq || !state.doc.contains(pageEl)) return;

	const unit = TextLib.hitTest(model.units, x, y, 8);
	if (!unit) return;

	paintUnit(state, pageEl, unit);
	const strip = makeStrip(state, pageEl, unit);
	state.strip = strip;
	translateUnit(state, unit, strip, seq);
}

// --- page text -------------------------------------------------------------

async function pageModel(state, pageEl, pageIndex) {
	const width = Math.round(pageEl.clientWidth);
	const height = Math.round(pageEl.clientHeight);
	const key = `${pageIndex}@${width}x${height}`;
	if (state.models.has(key)) return state.models.get(key);

	const app = state.win.PDFViewerApplication;
	const page = await app.pdfDocument.getPage(pageIndex + 1);
	const base = page.getViewport({ scale: 1 });
	const scale = (pageEl.clientWidth || base.width) / base.width;
	const content = await page.getTextContent();

	const items = [];
	for (const raw of content.items) {
		if (!raw.str || !raw.str.trim() || !raw.transform) continue;
		const tr = raw.transform;
		const point = base.convertToViewportPoint(tr[4], tr[5]);
		const fontHeight = Math.hypot(tr[2], tr[3]) || raw.height || 10;
		const itemWidth = Number.isFinite(raw.width)
			? raw.width
			: raw.str.length * fontHeight * 0.5;
		items.push({
			str: raw.str,
			x: point[0] * scale,
			y: (point[1] - fontHeight * 0.82) * scale,
			w: itemWidth * scale,
			h: fontHeight * 1.06 * scale,
			baseline: point[1] * scale,
		});
	}

	const model = { units: TextLib.pageUnits(items, pageEl.clientWidth) };
	if (state.models.size > 8) state.models.clear();
	state.models.set(key, model);
	return model;
}

// --- painting --------------------------------------------------------------

function injectCSS(doc) {
	if (doc.getElementById("sentence-translate-style")) return;
	const style = doc.createElement("style");
	style.id = "sentence-translate-style";
	style.textContent = `
.sft-layer { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.sft-box { position: absolute; mix-blend-mode: multiply; border-radius: 2px; }
.sft-strip {
  position: absolute; box-sizing: border-box; z-index: 4; pointer-events: none;
  width: max-content; max-width: 100%;
  padding: .42em .6em; border-radius: 6px;
  border: 1px solid rgba(0,0,0,.12);
  background: rgba(255,255,255,.96); color: #1b1b1b;
  box-shadow: 0 2px 8px rgba(0,0,0,.18);
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  line-height: 1.45; text-align: left; word-break: break-word; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical;
}
.sft-strip[data-state="error"] { color: #a33; }
.sft-strip[data-state="loading"] { opacity: .7; font-style: italic; }
`;
	(doc.head || doc.documentElement).append(style);
}

function paintUnit(state, pageEl, unit) {
	clearPaint(state);
	const layer = state.doc.createElement("div");
	layer.className = "sft-layer";
	const color = String(pref("color") || DEFAULTS.color);
	const opacity = Math.min(0.9, Math.max(0.05, (Number(pref("opacity")) || DEFAULTS.opacity) / 100));

	for (const rect of unit.rects) {
		const box = state.doc.createElement("div");
		box.className = "sft-box";
		box.style.left = `${rect.x}px`;
		box.style.top = `${rect.y}px`;
		box.style.width = `${rect.w}px`;
		box.style.height = `${rect.h}px`;
		box.style.background = color;
		box.style.opacity = String(opacity);
		layer.append(box);
	}

	pageEl.append(layer);
	state.layer = layer;
	state.pageEl = pageEl;
	state.unit = unit;
}

function makeStrip(state, pageEl, unit) {
	const left = Math.max(0, Math.min(...unit.rects.map((r) => r.x)));
	const top = Math.min(...unit.rects.map((r) => r.y));
	const bottom = Math.max(...unit.rects.map((r) => r.y + r.h));
	const lineHeight = TextLib.median(unit.rects.map((r) => r.h)) || 12;
	const fontSize = Math.max(11, Math.min(20, lineHeight * 0.92));
	const maxLines = Math.max(1, Math.min(6, Number(pref("maxLines")) || DEFAULTS.maxLines));

	const strip = state.doc.createElement("div");
	strip.className = "sft-strip";
	strip.dataset.state = "loading";
	strip.textContent = "翻译中…";
	strip.style.left = `${left}px`;
	strip.style.maxWidth = `${Math.max(80, pageEl.clientWidth - left - 6)}px`;
	strip.style.fontSize = `${fontSize.toFixed(1)}px`;
	strip.style.setProperty("-webkit-line-clamp", String(maxLines));
	strip.style.maxHeight = `${Math.round(fontSize * (1.45 * maxLines + 0.9))}px`;

	const margin = 6;
	const estimated = fontSize * 1.45 * maxLines + 18;
	if (bottom + margin + estimated <= pageEl.clientHeight) {
		strip.style.top = `${bottom + margin}px`;
	}
	else {
		strip.style.bottom = `${pageEl.clientHeight - top + margin}px`;
	}

	pageEl.append(strip);
	return strip;
}

function clearPaint(state) {
	try {
		if (state.layer) state.layer.remove();
		if (state.strip) state.strip.remove();
	}
	catch (e) { /* tab closed */ }
	state.layer = null;
	state.strip = null;
	state.unit = null;
	state.pageEl = null;
}

// --- translation -----------------------------------------------------------

function cacheGet(key) {
	if (!translationCache.has(key)) return "";
	const value = translationCache.get(key);
	translationCache.delete(key);
	translationCache.set(key, value);
	return value;
}

function cachePut(key, value) {
	translationCache.set(key, value);
	while (translationCache.size > CACHE_LIMIT) {
		translationCache.delete(translationCache.keys().next().value);
	}
}

function renderStrip(strip, text, isError) {
	if (!strip || !strip.isConnected) return;
	strip.textContent = text;
	strip.dataset.state = isError ? "error" : "done";
}

async function translateUnit(state, unit, strip, seq) {
	const text = unit.text;
	if (!text || text.length > 1500) {
		strip.remove();
		return;
	}

	const cached = cacheGet(text);
	if (cached) {
		renderStrip(strip, cached, false);
		return;
	}

	const api = Zotero.PDFTranslate && Zotero.PDFTranslate.api;
	if (!api || typeof api.translate !== "function") {
		renderStrip(strip, "未检测到 Translate for Zotero", true);
		return;
	}

	let timer = 0;
	try {
		const timeout = new Promise((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("timeout")), 15000);
		});
		const task = await Promise.race([
			api.translate(text, {
				pluginID: addonID,
				langto: String(pref("targetLang") || DEFAULTS.targetLang),
			}),
			timeout,
		]);
		if (timer) clearTimeout(timer);
		if (seq !== state.seq || !strip.isConnected) return;

		const result = task && typeof task.result === "string" ? task.result.trim() : "";
		if (!result) throw new Error("empty translation");
		cachePut(text, result);
		renderStrip(strip, result, false);
	}
	catch (e) {
		if (timer) clearTimeout(timer);
		if (seq === state.seq && strip.isConnected) {
			renderStrip(strip, "译文获取失败", true);
		}
		Zotero.debug("Sentence Translate: translation failed - " + ((e && e.message) || e));
	}
}
