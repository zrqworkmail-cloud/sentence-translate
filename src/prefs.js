/* Preference pane behaviour for Sentence Translate.
 *
 * Zotero loads pane scripts before the pane markup is inserted, so the controls
 * are only touched after MutationObserver sees them. Colour inputs are plain
 * HTML controls, which Zotero's `preference` attribute does not bind, so this
 * script reads and writes the same prefs directly.
 */
{
	const PREFIX = "extensions.zotero.sentenceTranslate.";
	const DEFAULTS = {
		color: "#ffd23f",
		stripColor: "#f2f2f2",
	};
	let initialized = false;

	const $ = (id) => document.getElementById(id);

	function get(key) {
		try {
			const value = Zotero.Prefs.get(PREFIX + key, true);
			if (value !== undefined && value !== null && value !== "") return String(value);
		}
		catch (e) { /* unset */ }
		return DEFAULTS[key];
	}

	function set(key, value) {
		try {
			Zotero.Prefs.set(PREFIX + key, value, true);
		}
		catch (e) {
			Zotero.debug("Sentence Translate: cannot save " + key + " - " + e);
		}
	}

	function isHex(value) {
		return /^#[0-9a-f]{6}$/i.test(String(value || ""));
	}

	function markPresets(container, color) {
		if (!container) return;
		for (const button of container.querySelectorAll("button[data-color]")) {
			const active = String(button.dataset.color).toLowerCase() === color;
			button.setAttribute("aria-pressed", active ? "true" : "false");
		}
	}

	function bindColor(inputId, valueId, presetId, key) {
		const input = $(inputId);
		if (!input) return;
		const valueLabel = $(valueId);
		const presets = $(presetId);

		const apply = (value, write) => {
			const color = isHex(value) ? value.toLowerCase() : get(key);
			input.value = color;
			if (valueLabel) valueLabel.textContent = color;
			markPresets(presets, color);
			if (write) set(key, color);
		};

		apply(get(key), false);
		input.addEventListener("input", () => apply(input.value, true));

		if (presets) {
			presets.addEventListener("click", (event) => {
				const button = event.target.closest("button[data-color]");
				if (!button) return;
				apply(button.dataset.color, true);
			});
		}
	}

	function init() {
		if (initialized) return;
		initialized = true;
		bindColor(
			"sentence-translate-color",
			"sentence-translate-color-value",
			"sentence-translate-color-presets",
			"color"
		);
		bindColor(
			"sentence-translate-strip-color",
			"sentence-translate-strip-color-value",
			"sentence-translate-strip-color-presets",
			"stripColor"
		);
	}

	// The markup appears after this script has run.
	const ready = () => {
		if (!document.getElementById("sentence-translate-color")) return false;
		init();
		return true;
	};

	if (!ready()) {
		const observer = new MutationObserver(() => {
			if (ready()) observer.disconnect();
		});
		observer.observe(document.documentElement, { childList: true, subtree: true });
		window.addEventListener("unload", () => observer.disconnect(), { once: true });
	}
}
