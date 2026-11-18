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
		stripColor: "#e6e6e6",
		textColor: "auto",
		deeplKey: "",
		llmBaseUrl: "",
		llmModel: "",
		llmKey: "",
	};
	const TEXT_PREFS = [
		["sentence-translate-deepl-key", "deeplKey"],
		["sentence-translate-llm-base", "llmBaseUrl"],
		["sentence-translate-llm-model", "llmModel"],
		["sentence-translate-llm-key", "llmKey"],
	];
	const THEMES = {
		gray: {
			color: "#ffd23f", opacity: 38,
			stripColor: "#e6e6e6", stripOpacity: 95, textColor: "auto",
		},
		white: {
			color: "#ffd23f", opacity: 38,
			stripColor: "#ffffff", stripOpacity: 100, textColor: "#1b1b1b",
		},
		dark: {
			color: "#ffd23f", opacity: 45,
			stripColor: "#2b2b2b", stripOpacity: 94, textColor: "#f5f5f5",
		},
		sepia: {
			color: "#e8b34b", opacity: 38,
			stripColor: "#f6f0e4", stripOpacity: 95, textColor: "#3b3226",
		},
		blue: {
			color: "#9ecbff", opacity: 38,
			stripColor: "#eaf2fb", stripOpacity: 95, textColor: "#17324d",
		},
		contrast: {
			color: "#ffd23f", opacity: 55,
			stripColor: "#ffffff", stripOpacity: 100, textColor: "#000000",
		},
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

	function showColor(inputId, valueId, presetId, color) {
		const input = $(inputId);
		if (!input) return;
		input.value = color;
		const valueLabel = $(valueId);
		if (valueLabel) valueLabel.textContent = color;
		markPresets($(presetId), color);
	}

	function bindColor(inputId, valueId, presetId, key) {
		const input = $(inputId);
		if (!input) return;

		showColor(inputId, valueId, presetId, get(key));
		input.addEventListener("input", () => {
			showColor(inputId, valueId, presetId, input.value);
			set(key, input.value);
		});

		const presets = $(presetId);
		if (presets) {
			presets.addEventListener("click", (event) => {
				const button = event.target.closest("button[data-color]");
				if (!button) return;
				showColor(inputId, valueId, presetId, button.dataset.color);
				set(key, button.dataset.color);
			});
		}
	}

	function setScale(id, value) {
		const scale = $(id);
		if (scale) scale.value = String(value);
	}

	function renderTextColor(auto, color) {
		const input = $("sentence-translate-text-color");
		const checkbox = $("sentence-translate-text-auto");
		const label = $("sentence-translate-text-color-value");
		if (!input || !checkbox) return;
		checkbox.checked = auto;
		input.disabled = auto;
		input.value = isHex(color) ? color : "#1b1b1b";
		if (label) label.textContent = auto ? "自动" : input.value;
	}

	function applyTheme(name) {
		const theme = THEMES[name];
		if (!theme) return;

		set("color", theme.color);
		set("opacity", theme.opacity);
		set("stripColor", theme.stripColor);
		set("stripOpacity", theme.stripOpacity);
		set("textColor", theme.textColor);

		showColor("sentence-translate-color", "sentence-translate-color-value",
			"sentence-translate-color-presets", theme.color);
		showColor("sentence-translate-strip-color", "sentence-translate-strip-color-value",
			"sentence-translate-strip-color-presets", theme.stripColor);
		setScale("sentence-translate-opacity", theme.opacity);
		setScale("sentence-translate-strip-opacity", theme.stripOpacity);
		renderTextColor(theme.textColor === "auto",
			theme.textColor === "auto" ? "#1b1b1b" : theme.textColor);

		const themes = $("sentence-translate-themes");
		if (themes) {
			for (const button of themes.querySelectorAll("button[data-theme]")) {
				button.setAttribute("aria-pressed", button.dataset.theme === name ? "true" : "false");
			}
		}
	}

	// Text inputs are plain HTML, so they are bound here rather than through
	// the XUL `preference` attribute.
	function bindTextPrefs() {
		for (const [id, key] of TEXT_PREFS) {
			const input = $(id);
			if (!input) continue;
			input.value = get(key);
			const save = () => set(key, input.value);
			input.addEventListener("input", save);
			input.addEventListener("change", save);
		}
	}

	function showTestResult(text, state) {
		const out = $("sentence-translate-test-result");
		if (!out) return;
		out.textContent = text;
		out.dataset.state = state || "";
	}

	function bindTestButton() {
		const button = $("sentence-translate-test");
		if (!button) return;
		button.addEventListener("click", async () => {
			const api = Zotero.SentenceTranslate;
			if (!api || typeof api.translate !== "function") {
				showTestResult("插件未加载，请重启 Zotero", "error");
				return;
			}
			button.disabled = true;
			showTestResult("测试中…", "");
			try {
				const result = await api.translate("The quick brown fox jumps over the lazy dog.");
				showTestResult(`${result.provider}：${result.text}`, "ok");
			}
			catch (e) {
				showTestResult("失败：" + ((e && e.message) || e), "error");
			}
			finally {
				button.disabled = false;
			}
		});
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

		const auto = $("sentence-translate-text-auto");
		const input = $("sentence-translate-text-color");
		const saved = get("textColor");
		const startAuto = !isHex(saved);
		renderTextColor(startAuto, isHex(saved) ? saved : "#1b1b1b");

		if (auto) {
			const syncAuto = () => {
				const isAuto = !!auto.checked;
				const color = isHex(input && input.value) ? input.value : "#1b1b1b";
				set("textColor", isAuto ? "auto" : color);
				renderTextColor(isAuto, color);
			};
			// XUL checkboxes send `command`; HTML-style `change` is kept for
			// builds that forward it too. Both paths write the same value.
			auto.addEventListener("command", syncAuto);
			auto.addEventListener("change", syncAuto);
		}
		if (input) {
			input.addEventListener("input", () => {
				if (auto && auto.checked) return;
				set("textColor", input.value);
				renderTextColor(false, input.value);
			});
		}

		const themes = $("sentence-translate-themes");
		if (themes) {
			themes.addEventListener("click", (event) => {
				const button = event.target.closest("button[data-theme]");
				if (button) applyTheme(button.dataset.theme);
			});
		}

		bindTextPrefs();
		bindTestButton();
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
