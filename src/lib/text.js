/*
 * Sentence geometry for PDF pages.
 *
 * This file is deliberately free of Zotero and DOM APIs: it takes plain text
 * items (position + size + string) and returns sentence units with rectangles.
 * That keeps the layout rules testable outside Zotero.
 *
 * Items are expected in page pixels, y growing downwards:
 *   { str, x, y, w, h, baseline }
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) {
		module.exports = api;
	}
	else {
		root.SentenceText = api;
	}
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
	"use strict";

	// Words that routinely end with a full stop without ending a sentence.
	const ABBREVIATIONS = new Set([
		"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc",
		"fig", "figs", "eq", "eqs", "no", "nos", "pp", "p", "al", "approx",
		"ref", "refs", "sec", "secs", "tab", "tabs", "vol", "vols", "ed",
		"eds", "cf", "ca", "resp", "inc", "ltd", "co", "corp", "dept",
		"univ", "e.g", "i.e", "et al"
	]);

	function median(values) {
		const nums = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
		if (!nums.length) return 0;
		const mid = Math.floor(nums.length / 2);
		return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
	}

	// A two-column page has a vertical gutter no glyph crosses. Headers and
	// full-width titles do cross it, so they are left out of the test and are
	// later assigned by their centre.
	function splitColumns(items, width) {
		if (!width || items.length < 8) return [items];
		const minSide = Math.max(3, Math.floor(items.length * 0.15));
		for (let gutter = width * 0.28; gutter <= width * 0.72; gutter += 2) {
			let crossing = 0;
			let left = 0;
			let right = 0;
			for (const item of items) {
				const centre = item.x + item.w / 2;
				if (item.w > width * 0.6) {
					if (centre < gutter) left++;
					else right++;
					continue;
				}
				if (item.x < gutter - 1 && item.x + item.w > gutter + 1) crossing++;
				else if (centre < gutter) left++;
				else right++;
			}
			if (crossing === 0 && left >= minSide && right >= minSide) {
				const a = [];
				const b = [];
				for (const item of items) {
					(item.x + item.w / 2 < gutter ? a : b).push(item);
				}
				return [a, b];
			}
		}
		return [items];
	}

	// One line per baseline cluster. Superscripts and footnote markers sit off
	// the baseline and form their own short clusters, which is acceptable: a
	// click near them still finds the sentence by proximity.
	function groupLines(items) {
		const sorted = items.slice().sort((a, b) => a.baseline - b.baseline || a.x - b.x);
		const height = median(sorted.map((i) => i.h)) || 10;
		const tolerance = Math.max(2, height * 0.45);
		const lines = [];
		for (const item of sorted) {
			const line = lines[lines.length - 1];
			if (!line || Math.abs(item.baseline - line.baseline) > tolerance) {
				lines.push({ baseline: item.baseline, items: [item] });
			}
			else {
				line.items.push(item);
			}
		}
		for (const line of lines) {
			line.items.sort((a, b) => a.x - b.x);
			line.top = Math.min(...line.items.map((i) => i.y));
			line.bottom = Math.max(...line.items.map((i) => i.y + i.h));
		}
		return lines;
	}

	function lineText(line) {
		let text = "";
		const segments = [];
		let previous = null;
		for (const item of line.items) {
			if (!item.str) continue;
			if (previous) {
				const gap = item.x - (previous.x + previous.w);
				if (gap > Math.max(1.2, item.h * 0.22)
					&& !/\s$/.test(text) && !/^\s/.test(item.str)) {
					text += " ";
				}
			}
			const start = text.length;
			text += item.str;
			segments.push({ item, start, end: text.length });
			previous = item;
		}
		return { text, segments };
	}

	// Index just past each sentence-ending mark. A full stop only counts when
	// it is followed by whitespace and then something that can start a new
	// sentence; decimals, URLs and known abbreviations do not split.
	function sentenceEnds(text) {
		const ends = [];
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (ch === "。" || ch === "！" || ch === "？" || ch === "；") {
				ends.push(i + 1);
				continue;
			}
			if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") continue;
			let last = i;
			while (last + 1 < text.length && ".!?…".includes(text[last + 1])) last++;
			const after = text[last + 1];
			if (after && !/\s/.test(after)) {
				i = last;
				continue;
			}
			const before = text.slice(0, i);
			const word = (before.match(/([A-Za-z][A-Za-z.]*)$/) || [null, ""])[1]
				.toLowerCase().replace(/\.+$/, "");
			if (ABBREVIATIONS.has(word)) {
				i = last;
				continue;
			}
			let nextIndex = last + 1;
			while (nextIndex < text.length && /\s/.test(text[nextIndex])) nextIndex++;
			const next = text[nextIndex] || "";
			if (!next || /[A-Z0-9"“'‘([]/.test(next) || /[\u3400-\u9fff]/.test(next)) {
				ends.push(last + 1);
			}
			i = last;
		}
		return ends;
	}

	// Rectangles for a character range of one line, splitting each item
	// proportionally by character count. Good enough for a highlight: PDF text
	// items are usually a word or a short run, not a whole paragraph.
	function rectsForRange(segments, from, to) {
		const rects = [];
		for (const segment of segments) {
			const start = Math.max(from, segment.start);
			const end = Math.min(to, segment.end);
			if (end <= start) continue;
			const raw = segment.item.str;
			let a = start - segment.start;
			let b = end - segment.start;
			while (a < b && /\s/.test(raw[a])) a++;
			while (b > a && /\s/.test(raw[b - 1])) b--;
			if (b <= a || !raw.length) continue;
			const width = segment.item.w / raw.length;
			rects.push({
				x: segment.item.x + a * width,
				y: segment.item.y,
				w: (b - a) * width,
				h: segment.item.h,
			});
		}
		return rects;
	}

	// Boxes on one line that overlap become one box, so a transparent tint is
	// laid down once instead of stacking darker where items abut.
	function mergeRects(rects) {
		const rows = [];
		for (const rect of rects) {
			if (!(rect.w > 0.6) || !(rect.h > 0.6)) continue;
			let row = rows.find((r) => Math.abs(r.y - rect.y) <= Math.max(1.5, rect.h * 0.3));
			if (!row) {
				row = { y: rect.y, h: rect.h, items: [] };
				rows.push(row);
			}
			row.h = Math.max(row.h, rect.h);
			row.items.push(rect);
		}
		const out = [];
		for (const row of rows) {
			row.items.sort((a, b) => a.x - b.x);
			let current = null;
			for (const rect of row.items) {
				if (current && rect.x <= current.x + current.w + 1.5) {
					current.w = Math.max(current.w, rect.x + rect.w - current.x);
					current.h = Math.max(current.h, rect.h);
				}
				else {
					if (current) out.push(current);
					current = { x: rect.x, y: row.y, w: rect.w, h: Math.max(rect.h, row.h) };
				}
			}
			if (current) out.push(current);
		}
		return out;
	}

	function appendText(left, right) {
		const piece = right.trim();
		if (!piece) return left;
		if (!left) return piece;
		if (left.endsWith("-") && /^[a-z]/.test(piece)) return left.slice(0, -1) + piece;
		if (/^[,.;:!?%)\]]/.test(piece)) return left + piece;
		return left + " " + piece;
	}

	function closeUnit(unit) {
		return {
			text: unit.text.replace(/\s+/g, " ").trim(),
			rects: mergeRects(unit.rects),
		};
	}

	function pageUnits(items, pageWidth) {
		const usable = items.filter((item) => item && item.str && item.str.trim()
			&& Number.isFinite(item.x) && Number.isFinite(item.baseline));
		if (!usable.length) return [];

		const units = [];
		for (const column of splitColumns(usable, pageWidth)) {
			const lines = groupLines(column);
			const height = median(lines.map((line) => line.bottom - line.top)) || 10;
			let open = null;
			let previous = null;

			for (const line of lines) {
				if (open && previous && line.top - previous.bottom > height * 1.5) {
					units.push(closeUnit(open));
					open = null;
				}
				const { text, segments } = lineText(line);
				if (!text.trim()) continue;

				const ends = new Set(sentenceEnds(text));
				let start = 0;
				for (let i = 0; i <= text.length; i++) {
					if (i !== text.length && !ends.has(i)) continue;
					const piece = text.slice(start, i);
					if (piece.trim()) {
						if (!open) open = { text: "", rects: [] };
						open.text = appendText(open.text, piece);
						open.rects.push(...rectsForRange(segments, start, i));
						if (ends.has(i)) {
							units.push(closeUnit(open));
							open = null;
						}
					}
					start = i;
				}
				previous = line;
			}
			if (open) units.push(closeUnit(open));
		}

		return units.filter((unit) => unit.text.length >= 2 && unit.rects.length > 0);
	}

	function hitTest(units, x, y, padding) {
		const pad = Number.isFinite(padding) ? padding : 6;
		let best = null;
		let bestDistance = Infinity;
		for (const unit of units) {
			for (const rect of unit.rects) {
				const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
				const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h));
				const distance = Math.hypot(dx, dy);
				if (distance < bestDistance) {
					bestDistance = distance;
					best = unit;
				}
			}
		}
		return bestDistance <= pad ? best : null;
	}

	return { pageUnits, hitTest, sentenceEnds, median, splitColumns };
});
