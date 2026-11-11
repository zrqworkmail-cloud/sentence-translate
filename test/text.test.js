"use strict";

const assert = require("assert");
const { pageUnits, hitTest, splitColumns } = require("../src/lib/text.js");

// A text item as the page extractor hands it over: page pixels, y downwards.
function item(str, x, y, w, h) {
	return { str, x, y, w, h, baseline: y + h * 0.82 };
}

function line(str, x, y, w, h) {
	return item(str, x, y, w, h);
}

// --- one column, sentence split and continuation ---------------------------

{
	const items = [
		line("This is a short sentence. This one is", 50, 100, 260, 12),
		line("continued on the next line.", 50, 120, 170, 12),
	];
	const units = pageUnits(items, 600);
	assert.strictEqual(units.length, 2, "two sentences expected");
	assert.strictEqual(units[0].text, "This is a short sentence.");
	assert.strictEqual(units[1].text, "This one is continued on the next line.");
	assert.strictEqual(units[1].rects.length, 2, "second sentence spans two lines");
}

// --- abbreviations and decimals do not split -------------------------------

{
	const items = [
		line("As shown by Smith et al. 2020 the value is 3.14 at most. Next sentence follows.", 50, 100, 470, 12),
	];
	const units = pageUnits(items, 600);
	assert.strictEqual(units.length, 2, "abbreviation and decimal kept together");
	assert.ok(units[0].text.includes("3.14"), "decimal stayed in first sentence");
	assert.strictEqual(units[1].text, "Next sentence follows.");
}

// --- hyphenated line break --------------------------------------------------

{
	const items = [
		line("The transla-", 50, 100, 70, 12),
		line("tion is shown below.", 50, 120, 120, 12),
	];
	const units = pageUnits(items, 600);
	assert.strictEqual(units.length, 1);
	assert.strictEqual(units[0].text, "The translation is shown below.");
}

// --- two columns are kept apart --------------------------------------------

{
	const items = [];
	for (let i = 0; i < 6; i++) {
		items.push(line(`Left column sentence number ${i}.`, 40, 100 + i * 20, 220, 12));
		items.push(line(`Right column sentence number ${i}.`, 380, 100 + i * 20, 220, 12));
	}
	const columns = splitColumns(items, 640);
	assert.strictEqual(columns.length, 2, "gutter found");
	assert.strictEqual(columns[0].length, 6);
	assert.strictEqual(columns[1].length, 6);

	const units = pageUnits(items, 640);
	assert.strictEqual(units.length, 12);
	assert.ok(units.every((u) => /^(Left|Right) column/.test(u.text)));
}

// --- click hit testing ------------------------------------------------------

{
	const items = [line("A sentence to click on.", 50, 100, 200, 12)];
	const units = pageUnits(items, 600);
	assert.ok(hitTest(units, 60, 105, 6), "inside the box hits");
	assert.ok(hitTest(units, 60, 118, 6), "just below still hits with padding");
	assert.strictEqual(hitTest(units, 60, 300, 6), null, "far away misses");
}

// --- rectangles follow the words, not the column ---------------------------

{
	const items = [line("Short words. A much longer sentence that runs on.", 50, 100, 300, 12)];
	const units = pageUnits(items, 600);
	const first = units[0].rects[0];
	assert.ok(first.w < 120, `first sentence box should hug its words, got ${first.w}`);
	assert.ok(first.x >= 49.5);
}

console.log("text.js: all assertions passed");
