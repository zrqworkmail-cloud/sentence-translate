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
	stripColor: "#e6e6e6",
	stripOpacity: 95,
	textColor: "auto",
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
const CU = Components.utils;

// Set to true only while diagnosing a reader-specific failure. The log is
// written to Zotero's temporary directory, never to the user's documents.
const DEBUG = false;
const DEBUG_LOG = (Zotero.getTempDirectory ? Zotero.getTempDirectory().path : "") + "/sentence-translate.log";
let debugLines = [];
let sweepTimer = 0;

function diag(message) {
	if (!DEBUG) return;
	try {
		debugLines.push(new Date().toISOString() + " " + message);
		if (debugLines.length > 500) debugLines.shift();
		const pending = Zotero.File.putContentsAsync(DEBUG_LOG, debugLines.join("\n") + "\n");
		if (pending && pending.catch) pending.catch(() => {});
	}
	catch (e) { /* diagnostics must never break the plugin */ }
}

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
	branch.setStringPref("stripColor", DEFAULTS.stripColor);
	branch.setIntPref("stripOpacity", DEFAULTS.stripOpacity);
	branch.setStringPref("textColor", DEFAULTS.textColor);
	branch.setStringPref("targetLang", DEFAULTS.targetLang);
	branch.setIntPref("maxLines", DEFAULTS.maxLines);
}

// --- lifecycle -------------------------------------------------------------

function startup({ id, version, rootURI }) {
	addonID = id;
	rootDir = rootURI;
	if (started) return;
	started = true;
	diag(`startup id=${id} version=${version} root=${rootURI}`);

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
			scripts: [rootURI + "prefs.js"],
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

	// Reader tabs restored before this plugin started do not always produce a
	// renderToolbar event, so sweep as well as listen.
	sweepTimer = setInterval(() => {
		try {
			for (const reader of Array.from(Zotero.Reader._readers || [])) attachReader(reader);
		}
		catch (e) { diag("sweep failed " + e); }
	}, 1500);

	diag(`startup complete readers=${(Zotero.Reader._readers || []).length}`);
	Zotero.debug(`Sentence Translate ${version} starting`);
}

function shutdown() {
	if (!started) return;
	started = false;
	if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = 0; }
	diag("shutdown");

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
	diag(`renderToolbar reader=${event && event.reader && event.reader.itemID} type=${event && event.reader && event.reader.type}`);
	if (event && event.reader) attachReader(event.reader);
}

function attachReader(reader) {
	if (!reader || readerStates.has(reader)) return;
	diag(`attach item=${reader.itemID} type=${reader.type} inner=${!!reader._internalReader}`);
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
		bound: false,
		onClick: null,
		onPageRendered: null,
		onUnload: null,
	};
	readerStates.set(reader, state);

	waitForReaderWindow(state)
		.then((win) => {
			if (!win) {
				diag(`wait failed item=${reader.itemID}`);
				readerStates.delete(reader);
				return;
			}
			if (readerStates.get(reader) !== state) return;
			bindReader(state, win);
		})
		.catch((e) => {
			diag(`attach failed ${e}`);
			readerStates.delete(reader);
		});
}

async function waitForReaderWindow(state) {
	for (let attempt = 0; attempt < 240; attempt++) {
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
		let app = null;
		try { app = win && win.PDFViewerApplication; }
		catch (e) { app = null; }
		if (app && app.pdfDocument) {
			diag(`view ready item=${state.reader.itemID} attempt=${attempt} pages=${app.pdfDocument.numPages}`);
			try { await app.initializedPromise; }
			catch (e) { /* still usable */ }
			return win;
		}
		if (attempt % 20 === 0) {
			diag(`waiting item=${state.reader.itemID} attempt=${attempt} win=${!!win} app=${!!app} pdf=${!!(app && app.pdfDocument)}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return null;
}

function bindReader(state, win) {
	if (state.bound) return;
	state.bound = true;
	state.win = win;
	state.doc = win.document;
	state.doc.documentElement.setAttribute("data-sentence-translate", "on");

	diag(`bind item=${state.reader.itemID} url=${state.doc.URL} pages=${state.doc.querySelectorAll(".page").length}`);

	injectCSS(state.doc);

	state.onClick = (event) => onDocumentClick(event, state);
	state.doc.addEventListener("click", state.onClick, true);

	state.onPageRendered = () => clearPaint(state);
	try {
		win.PDFViewerApplication.eventBus.on("pagerendered", state.onPageRendered);
	}
	catch (e) { /* event bus missing */ }

	state.onUnload = () => detachReader(state.reader);
	win.addEventListener("unload", state.onUnload, true);
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
			state.win.removeEventListener("unload", state.onUnload, true);
		}
	}
	catch (e) { /* the tab is already gone */ }
}

// --- click handling --------------------------------------------------------

function onDocumentClick(event, state) {
	diag(`click enter enabled=${pref("enabled")} button=${event.button} target=${event.target && (event.target.className || event.target.nodeName)}`);
	if (!pref("enabled")) { diag("skip disabled"); return; }
	if (event.button !== 0) { diag("skip button"); return; }
	if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) { diag("skip modifier"); return; }

	const target = event.target;
	if (!target || typeof target.closest !== "function") { diag("skip no target"); return; }
	const pageEl = target.closest(".page");
	if (pageEl) {
		const pages = state.doc.querySelectorAll(".page");
		const pr = pageEl.getBoundingClientRect();
		const tr = target.getBoundingClientRect();
		diag(`click target=${target.className || target.nodeName} prevented=${event.defaultPrevented} page=${pageEl.dataset && pageEl.dataset.pageNumber} pages=${pages.length} same=${pages[0] === pageEl} pageRect=${Math.round(pr.left)},${Math.round(pr.top)},${Math.round(pr.width)}x${Math.round(pr.height)} targetRect=${Math.round(tr.left)},${Math.round(tr.top)},${Math.round(tr.width)}x${Math.round(tr.height)} client=${event.clientX},${event.clientY}`);
	}
	const blocked = target.closest("a, .annotationLayer, .highlightLayer, .linkAnnotation, .popup, .sft-strip");
	if (blocked) { diag(`skip blocked ${blocked.className}`); return; }

	if (!pageEl || !pageEl.dataset || !pageEl.dataset.pageNumber) { diag("skip no page"); return; }

	const selection = state.win.getSelection ? state.win.getSelection() : null;
	if (selection && !selection.isCollapsed) { diag(`skip selection ranges=${selection.rangeCount}`); return; }

	const box = pageEl.getBoundingClientRect();
	if (!box.width || !box.height) { diag(`skip box ${box.width}x${box.height}`); return; }
	const xPct = (event.clientX - box.left) / box.width * 100;
	const yPct = (event.clientY - box.top) / box.height * 100;
	if (xPct < -2 || yPct < -2 || xPct > 102 || yPct > 102) {
		diag(`skip bounds pct=${xPct.toFixed(2)},${yPct.toFixed(2)} box=${box.width}x${box.height}`);
		return;
	}

	const pageIndex = Number(pageEl.dataset.pageNumber) - 1;
	diag(`select call page=${pageIndex + 1} pct=${xPct.toFixed(2)},${yPct.toFixed(2)}`);
	selectSentence(state, pageEl, pageIndex, xPct, yPct);
}

async function selectSentence(state, pageEl, pageIndex, xPct, yPct) {
	const seq = ++state.seq;
	let model;
	try {
		model = await pageModel(state, pageEl, pageIndex);
	}
	catch (e) {
		diag(`page text failed ${(e && e.message) || e} stack=${(e && e.stack) || ""}`);
		Zotero.debug("Sentence Translate: cannot read page text - " + e);
		return;
	}
	if (seq !== state.seq || !state.doc.contains(pageEl)) return;

	const x = xPct / 100 * model.baseWidth;
	const y = yPct / 100 * model.baseHeight;
	const unit = TextLib.hitTest(model.units, x, y, 8);
	diag(`hit item=${state.reader.itemID} page=${pageIndex + 1} units=${model.units.length} x=${Math.round(x)} y=${Math.round(y)} found=${!!unit}`);
	if (!unit) return;

	paintUnit(state, pageEl, unit, model);
	const strip = makeStrip(state, pageEl, unit, model);
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
	diag(`pageModel start page=${pageIndex + 1} client=${pageEl.clientWidth}x${pageEl.clientHeight}`);

	const UNIT = 1000;
	let items = [];

	if (app.pdfDocument && typeof app.pdfDocument.getPageData === "function") {
		const data = CU.waiveXrays(await app.pdfDocument.getPageData(
			CU.cloneInto({ pageIndex }, state.win)
		));
		items = itemsFromChars(data && data.chars, (data && data.viewBox) || [0, 0, 612, 792], UNIT);
		diag(`pageData chars=${(data && data.chars && data.chars.length) || 0} viewBox=${JSON.stringify(data && data.viewBox)} items=${items.length}`);
		if (data && data.chars && data.chars.length) {
			diag(`char sample ${data.chars.slice(0, 6).map((ch) => `${ch.c}@${(ch.rect || []).map((n) => Math.round(n)).join(",")}`).join(" | ")}`);
		}
	}
	else {
		const page = await app.pdfDocument.getPage(pageIndex + 1);
		const content = await page.getTextContent();
		const viewport = app.pdfViewer.getPageView(pageIndex).viewport;
		for (const raw of content.items) {
			if (!raw.str || !raw.str.trim() || !raw.transform) continue;
			const tr = raw.transform;
			const point = viewport.convertToViewportPoint(tr[4], tr[5]);
			const fontHeight = (Math.hypot(tr[2], tr[3]) || 10) * viewport.scale;
			items.push({
				str: raw.str,
				x: point[0] / viewport.width * UNIT,
				y: (point[1] - fontHeight * 0.82) / viewport.height * UNIT,
				w: (raw.width || 1) * viewport.scale / viewport.width * UNIT,
				h: fontHeight * 1.06 / viewport.height * UNIT,
				baseline: point[1] / viewport.height * UNIT,
			});
		}
	}

	const model = {
		units: TextLib.pageUnits(items, UNIT),
		baseWidth: UNIT,
		baseHeight: UNIT,
	};
	diag(`page model item=${state.reader.itemID} page=${pageIndex + 1} items=${items.length} units=${model.units.length} unit=${UNIT}`);
	if (model.units.length) {
		diag(`unit sample ${model.units.slice(0, 3).map((u) => `${u.text.slice(0, 24)}|${u.rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)}x${Math.round(r.h)}`).join(";")}`).join(" || ")}`);
	}
	if (state.models.size > 8) state.models.clear();
	state.models.set(key, model);
	return model;
}

// Zotero's page data is a list of glyphs with page-space rectangles. Group
// them into short runs (a word, a formula fragment) so the sentence layer can
// work in the same geometry for columns, lines and highlights.
function itemsFromChars(chars, viewBox, unit) {
	if (!chars || !chars.length) return [];
	const vx = viewBox[0] || 0;
	const vy = viewBox[1] || 0;
	const vw = Math.max(1, (viewBox[2] || 612) - vx);
	const vh = Math.max(1, (viewBox[3] || 792) - vy);
	const topEdge = vy + vh;

	const items = [];
	let run = null;
	let previous = null;

	const flush = () => {
		if (!run) return;
		const text = run.text.replace(/\s+/g, " ").trim();
		if (text) {
			items.push({
				str: text,
				x: (run.left - vx) / vw * unit,
				y: (run.top - vy) / vh * unit,
				w: Math.max(1, (run.right - run.left) / vw * unit),
				h: Math.max(1, (run.bottom - run.top) / vh * unit),
				baseline: (run.baseline - vy) / vh * unit,
			});
		}
		run = null;
	};

	for (const ch of chars) {
		if (!ch || typeof ch.c !== "string") continue;
		const rect = ch.rect || [0, 0, 0, 0];
		const size = ch.size || Math.max(1, rect[3] - rect[1]) || 10;
		const baseline = Number.isFinite(ch.baseline) ? topEdge - ch.baseline : topEdge - rect[1];
		const charTop = topEdge - rect[3];
		const charBottom = topEdge - rect[1];

		if (run) {
			const gap = rect[0] - run.right;
			const jump = Math.abs(baseline - run.baseline) > Math.max(2, size * 0.45);
			if ((previous && previous.lineEnd) || jump || gap > size * 2.5) flush();
		}

		if (!run) {
			run = {
				text: "",
				left: rect[0], top: charTop, right: rect[2], bottom: charBottom,
				baseline,
			};
		}
		else if (previous && !previous.space && rect[0] - previous.rect[2] > size * 0.22
			&& !/^\s/.test(ch.c)) {
			run.text += " ";
		}
		run.text += ch.c;
		if (ch.space) run.text += " ";
		run.left = Math.min(run.left, rect[0]);
		run.top = Math.min(run.top, charTop);
		run.right = Math.max(run.right, rect[2]);
		run.bottom = Math.max(run.bottom, charBottom);
		run.baseline = baseline;
		previous = ch;
	}
	flush();
	return items;
}

// --- painting --------------------------------------------------------------

// Accept #rgb/#rrggbb only; a bad value in a preference must never produce an
// invisible highlight or a stylesheet parse error.
function hexColor(value, fallback) {
	const text = String(value || "").trim();
	if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
	if (/^#[0-9a-f]{3}$/i.test(text)) {
		return "#" + text.slice(1).split("").map((c) => c + c).join("").toLowerCase();
	}
	return fallback;
}

function colorChannels(hex) {
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

function colorWithAlpha(hex, percent) {
	const [r, g, b] = colorChannels(hex);
	const alpha = Math.min(1, Math.max(0, Number(percent) / 100));
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Keep the translation readable when the reader picks a dark background.
function isDarkColor(hex) {
	const [r, g, b] = colorChannels(hex);
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	return luminance <= 0.55;
}

function readableText(hex) {
	return isDarkColor(hex) ? "#f7f7f7" : "#1b1b1b";
}

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
  background: rgba(242,242,242,.96); color: var(--sft-fg, #1b1b1b);
  box-shadow: 0 2px 8px rgba(0,0,0,.18);
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  line-height: 1.45; text-align: left; word-break: break-word; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical;
}
.sft-strip[data-state="error"] { color: var(--sft-error, #a33); }
.sft-strip[data-state="loading"] { opacity: .7; font-style: italic; }
`;
	(doc.head || doc.documentElement).append(style);
}

function paintUnit(state, pageEl, unit, model) {
	clearPaint(state);
	const layer = state.doc.createElement("div");
	layer.className = "sft-layer";
	const color = hexColor(pref("color"), DEFAULTS.color);
	const rawOpacity = Number(pref("opacity"));
	const opacity = Math.min(0.9, Math.max(0.05, (Number.isFinite(rawOpacity) ? rawOpacity : DEFAULTS.opacity) / 100));

	for (const rect of unit.rects) {
		const box = state.doc.createElement("div");
		box.className = "sft-box";
		box.style.left = `${rect.x / model.baseWidth * 100}%`;
		box.style.top = `${rect.y / model.baseHeight * 100}%`;
		box.style.width = `${rect.w / model.baseWidth * 100}%`;
		box.style.height = `${rect.h / model.baseHeight * 100}%`;
		box.style.background = color;
		box.style.opacity = String(opacity);
		layer.append(box);
	}

	pageEl.append(layer);
	state.layer = layer;
	state.pageEl = pageEl;
	state.unit = unit;
}

function makeStrip(state, pageEl, unit, model) {
	const box = pageEl.getBoundingClientRect();
	const displayHeight = box.height || pageEl.clientHeight || 1;
	const left = Math.max(0, Math.min(...unit.rects.map((r) => r.x)));
	const top = Math.min(...unit.rects.map((r) => r.y));
	const bottom = Math.max(...unit.rects.map((r) => r.y + r.h));
	const lineHeight = TextLib.median(unit.rects.map((r) => r.h)) || 12;
	const fontSize = Math.max(11, Math.min(20, (lineHeight / model.baseHeight * displayHeight) * 0.92));
	const maxLines = Math.max(1, Math.min(6, Number(pref("maxLines")) || DEFAULTS.maxLines));
	const leftPct = left / model.baseWidth * 100;
	const topPct = top / model.baseHeight * 100;
	const bottomPct = bottom / model.baseHeight * 100;

	const strip = state.doc.createElement("div");
	strip.className = "sft-strip";
	strip.dataset.state = "loading";
	strip.textContent = "翻译中…";
	const stripColor = hexColor(pref("stripColor"), DEFAULTS.stripColor);
	const rawStripOpacity = Number(pref("stripOpacity"));
	const stripOpacity = Math.min(100, Math.max(0, Number.isFinite(rawStripOpacity) ? rawStripOpacity : DEFAULTS.stripOpacity));
	const foreground = hexColor(pref("textColor"), readableText(stripColor));
	strip.style.background = colorWithAlpha(stripColor, stripOpacity);
	strip.style.setProperty("--sft-fg", foreground);
	strip.style.setProperty("--sft-error", isDarkColor(foreground) ? "#ff9a9a" : "#a33");
	strip.style.borderColor = isDarkColor(foreground) ? "rgba(255,255,255,.22)" : "rgba(0,0,0,.12)";
	strip.style.left = `${leftPct}%`;
	strip.style.maxWidth = `calc(${Math.max(10, 100 - leftPct)}% - 6px)`;
	strip.style.fontSize = `${fontSize.toFixed(1)}px`;
	strip.style.setProperty("-webkit-line-clamp", String(maxLines));
	strip.style.maxHeight = `${Math.round(fontSize * (1.45 * maxLines + 0.9))}px`;

	const margin = 6;
	const estimated = fontSize * 1.45 * maxLines + 18;
	const below = displayHeight * (1 - bottomPct / 100);
	if (below >= estimated) {
		strip.style.top = `calc(${bottomPct}% + ${margin}px)`;
	}
	else {
		strip.style.bottom = `calc(${100 - topPct}% + ${margin}px)`;
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
		diag(`no TfZ api; keys=${Zotero.PDFTranslate ? Object.keys(Zotero.PDFTranslate).join(",") : "none"}`);
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
		diag(`translated chars=${result.length}`);
	}
	catch (e) {
		if (timer) clearTimeout(timer);
		if (seq === state.seq && strip.isConnected) {
			renderStrip(strip, "译文获取失败", true);
		}
		Zotero.debug("Sentence Translate: translation failed - " + ((e && e.message) || e));
		diag(`translation failed ${(e && e.message) || e}`);
	}
}
