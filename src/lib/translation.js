/*
 * Translation backends for Sentence Translate.
 *
 * The plugin ships its own translation channels so that installing it alone is
 * enough. The network layer is injected (`options.request`) because Zotero and
 * the Node test harness provide different transports:
 *
 *   request(method, url, { body, headers, timeout }) ->
 *     Promise<{ status: number, text: string }>
 *
 * Providers:
 *   google    Google 翻译免密钥接口（默认，质量最好）
 *   mymemory  MyMemory 免密钥接口（备用，单次 450 字符）
 *   deepl     DeepL API（需要 key，key 以 :fx 结尾走免费端点）
 *   llm       任何 OpenAI 兼容的 /chat/completions 接口
 *   zotero    Translate for Zotero（可选，仅在已安装时由调用方注入）
 */

"use strict";

(function (factory) {
	const api = factory();
	if (typeof module === "object" && module && module.exports) module.exports = api;
	if (typeof globalThis !== "undefined") globalThis.SentenceTranslation = api;
})(function () {
	const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
	// The extension endpoint is far more tolerant of shared proxy egress IPs:
	// the gtx one answers 429 as soon as a few users share an address.
	const GOOGLE_DICT_ENDPOINT = "https://clients5.google.com/translate_a/t";
	const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
	const DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";
	const DEEPL_PRO_ENDPOINT = "https://api.deepl.com/v2/translate";

	// Longest text handed to one provider request. Google accepts far more,
	// MyMemory rejects anything above 500 characters, so the smallest safe
	// value is used for that provider only.
	const LIMITS = { google: 1800, mymemory: 450, deepl: 4000, llm: 6000 };

	const LANGUAGE_NAMES = {
		"zh-CN": "简体中文",
		"zh-TW": "繁體中文",
		en: "English",
		ja: "日本語",
		ko: "한국어",
		de: "Deutsch",
		fr: "Français",
		es: "Español",
		ru: "Русский",
	};

	function normalizeText(value) {
		return String(value === undefined || value === null ? "" : value)
			.replace(/\s+/g, " ")
			.trim();
	}

	function languageName(code) {
		return LANGUAGE_NAMES[code] || code || "简体中文";
	}

	function joinsWithoutSpace(targetLang) {
		return /^(zh|ja)/i.test(String(targetLang || ""));
	}

	function joinChunks(parts, targetLang) {
		const separator = joinsWithoutSpace(targetLang) ? "" : " ";
		return parts
			.map((part) => String(part || "").trim())
			.filter(Boolean)
			.join(separator);
	}

	// Split on sentence ends, then on words, so a long paragraph still fits a
	// provider limit without cutting a word in half.
	function splitForLimit(text, limit) {
		const clean = normalizeText(text);
		if (!clean) return [];
		const max = Math.max(40, Number(limit) || 450);
		if (clean.length <= max) return [clean];

		const out = [];
		let current = "";
		const flush = () => {
			if (current.trim()) out.push(current.trim());
			current = "";
		};

		for (const raw of clean.match(/[^.!?;。！？；]+[.!?;。！？；]*/g) || [clean]) {
			const piece = raw.trim();
			if (!piece) continue;
			if (!current) {
				if (piece.length <= max) { current = piece; continue; }
			}
			else if ((current + " " + piece).length <= max) {
				current += " " + piece;
				continue;
			}
			else {
				flush();
				if (piece.length <= max) { current = piece; continue; }
			}

			// A single sentence longer than the limit: break on whitespace and
			// hard-split the rare token that is still too long.
			let chunk = "";
			for (const word of piece.split(/\s+/)) {
				const next = chunk ? chunk + " " + word : word;
				if (next.length <= max) { chunk = next; continue; }
				if (chunk) { out.push(chunk); chunk = ""; }
				let rest = word;
				while (rest.length > max) {
					out.push(rest.slice(0, max));
					rest = rest.slice(max);
				}
				chunk = rest;
			}
			if (chunk) out.push(chunk);
		}
		flush();
		return out;
	}

	// --- google --------------------------------------------------------------

	function googleUrl(text, targetLang) {
		return GOOGLE_ENDPOINT
			+ "?client=gtx&sl=auto&tl=" + encodeURIComponent(targetLang || "zh-CN")
			+ "&dt=t&q=" + encodeURIComponent(text);
	}

	function googleDictUrl(text, targetLang) {
		return GOOGLE_DICT_ENDPOINT
			+ "?client=dict-chrome-ex&sl=auto&tl=" + encodeURIComponent(targetLang || "zh-CN")
			+ "&q=" + encodeURIComponent(text);
	}

	function parseGoogleDict(payload) {
		const data = typeof payload === "string" ? JSON.parse(payload) : payload;
		if (!Array.isArray(data)) throw new Error("Google 返回了无法识别的内容");
		const parts = [];
		const walk = (node) => {
			if (!Array.isArray(node)) return;
			if (typeof node[0] === "string" && typeof node[1] === "string") {
				parts.push(node[0]);
				return;
			}
			for (const child of node) walk(child);
		};
		walk(data);
		const text = normalizeText(parts.join(""));
		if (!text) throw new Error("Google 返回空译文");
		return text;
	}

	function parseGoogle(payload) {
		const data = typeof payload === "string" ? JSON.parse(payload) : payload;
		if (!Array.isArray(data) || !Array.isArray(data[0])) {
			throw new Error("Google 返回了无法识别的内容");
		}
		const parts = [];
		for (const segment of data[0]) {
			if (Array.isArray(segment) && typeof segment[0] === "string") parts.push(segment[0]);
		}
		const text = normalizeText(parts.join(""));
		if (!text) throw new Error("Google 返回空译文");
		return text;
	}

	// --- mymemory ------------------------------------------------------------

	// MyMemory needs an explicit source language; academic PDFs are mostly
	// English, and Chinese source is assumed when translating into English.
	function myMemorySource(targetLang) {
		return /^(zh|ja|ko)/i.test(String(targetLang || "")) ? "en" : "zh-CN";
	}

	function myMemoryUrl(text, targetLang) {
		const pair = myMemorySource(targetLang) + "|" + (targetLang || "zh-CN");
		return MYMEMORY_ENDPOINT
			+ "?q=" + encodeURIComponent(text)
			+ "&langpair=" + encodeURIComponent(pair);
	}

	function parseMyMemory(payload) {
		const data = typeof payload === "string" ? JSON.parse(payload) : payload;
		const status = Number(data && data.responseStatus);
		if (status && (status < 200 || status >= 300)) {
			throw new Error("MyMemory " + (status === 429 ? "请求过于频繁" : "HTTP " + status));
		}
		const text = normalizeText(data && data.responseData && data.responseData.translatedText);
		if (!text || /^MYMEMORY WARNING/i.test(text)) {
			throw new Error("MyMemory 返回空译文");
		}
		return text;
	}

	// --- deepl ---------------------------------------------------------------

	function deepLTarget(targetLang) {
		const code = String(targetLang || "zh-CN").toUpperCase();
		if (code === "ZH-CN" || code === "ZH") return "ZH";
		if (code === "ZH-TW") return "ZH-HANT";
		return code.split("-")[0];
	}

	function deepLEndpoint(key) {
		return String(key || "").trim().endsWith(":fx") ? DEEPL_FREE_ENDPOINT : DEEPL_PRO_ENDPOINT;
	}

	function deepLBody(text, targetLang) {
		return "text=" + encodeURIComponent(text) + "&target_lang=" + encodeURIComponent(deepLTarget(targetLang));
	}

	function parseDeepL(payload) {
		const data = typeof payload === "string" ? JSON.parse(payload) : payload;
		const first = data && data.translations && data.translations[0];
		const text = normalizeText(first && first.text);
		if (!text) throw new Error("DeepL 返回空译文");
		return text;
	}

	// --- llm -----------------------------------------------------------------

	function llmSystemPrompt(targetLang) {
		return "你是学术文献的翻译引擎。把用户给出的句子翻译成"
			+ languageName(targetLang)
			+ "。保留公式、数字、引文和专有名词原样，不要解释，不要加引号，只输出译文。";
	}

	function llmUrl(baseUrl) {
		const base = String(baseUrl || "").trim().replace(/\/+$/, "");
		if (!base) throw new Error("没有填写大模型接口地址");
		return /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
	}

	function llmBody(text, targetLang, model) {
		if (!model) throw new Error("没有填写模型名称");
		return JSON.stringify({
			model: model,
			temperature: 0,
			messages: [
				{ role: "system", content: llmSystemPrompt(targetLang) },
				{ role: "user", content: text },
			],
		});
	}

	// Models sometimes wrap the answer in fenced code, a label or quotes.
	function cleanModelOutput(value) {
		let text = normalizeText(value);
		text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
		text = text.replace(/^(translation|译文|翻譯|中文翻译)\s*[:：]\s*/i, "");
		const quoted = text.match(/^["“']([\s\S]*)["”']$/);
		if (quoted) text = quoted[1].trim();
		return normalizeText(text);
	}

	function parseLlm(payload) {
		const data = typeof payload === "string" ? JSON.parse(payload) : payload;
		const choice = data && data.choices && data.choices[0];
		const content = choice && (choice.message ? choice.message.content : choice.text);
		const text = cleanModelOutput(content);
		if (!text) throw new Error("大模型返回空译文");
		return text;
	}

	// --- dispatch ------------------------------------------------------------

	function hasText(value) {
		return typeof value === "string" && value.trim() !== "";
	}

	function providerChain(options) {
		const opts = options || {};
		const provider = String(opts.provider || "auto");
		const custom = opts.custom || {};

		const available = {
			google: true,
			mymemory: true,
			deepl: hasText(opts.deeplKey),
			llm: hasText(opts.llmKey) && hasText(opts.llmBaseUrl) && hasText(opts.llmModel),
			zotero: typeof custom.zotero === "function",
		};

		if (provider !== "auto") {
			if (provider === "zotero" && !available.zotero) {
				throw new Error("未检测到 Translate for Zotero；本插件已自带翻译，请把引擎改成“自动”");
			}
			if (!available[provider]) {
				throw new Error("所选翻译引擎缺少必要配置");
			}
			return [provider];
		}

		const chain = [];
		if (available.llm) chain.push("llm");
		if (available.deepl) chain.push("deepl");
		chain.push("google", "mymemory");
		if (available.zotero) chain.push("zotero");
		return chain;
	}

	async function readJson(request, url, options) {
		const response = await request("GET", url, options);
		if (!response || !response.status || response.status < 200 || response.status >= 300) {
			throw new Error("HTTP " + (response && response.status ? response.status : "无响应"));
		}
		return JSON.parse(response.text);
	}

	async function inChunks(text, limit, targetLang, run) {
		const pieces = splitForLimit(text, limit);
		if (!pieces.length) throw new Error("没有可翻译的文本");
		if (pieces.length === 1) return run(pieces[0]);
		const out = [];
		for (const piece of pieces) out.push(await run(piece));
		return joinChunks(out, targetLang);
	}

	async function runProvider(name, text, targetLang, options, request) {
		const timeout = options.timeoutMs || 12000;
		const custom = options.custom || {};
		if (typeof custom[name] === "function") return custom[name](text, targetLang);

		switch (name) {
			case "google":
				return inChunks(text, LIMITS.google, targetLang, async (piece) => {
					try {
						const data = await readJson(request, googleDictUrl(piece, targetLang), { timeout });
						return parseGoogleDict(data);
					}
					catch (e) {
						const data = await readJson(request, googleUrl(piece, targetLang), { timeout });
						return parseGoogle(data);
					}
				});

			case "mymemory":
				return inChunks(text, LIMITS.mymemory, targetLang, async (piece) => {
					const data = await readJson(request, myMemoryUrl(piece, targetLang), { timeout });
					return parseMyMemory(data);
				});

			case "deepl":
				return inChunks(text, LIMITS.deepl, targetLang, async (piece) => {
					const response = await request("POST", deepLEndpoint(options.deeplKey), {
						body: deepLBody(piece, targetLang),
						headers: {
							"Authorization": "DeepL-Auth-Key " + String(options.deeplKey || "").trim(),
							"Content-Type": "application/x-www-form-urlencoded",
						},
						timeout,
					});
					if (!response || !response.status || response.status < 200 || response.status >= 300) {
						throw new Error("HTTP " + (response && response.status ? response.status : "无响应")
							+ (response && response.status === 403 ? "（key 无效）" : ""));
					}
					return parseDeepL(response.text);
				});

			case "llm":
				return inChunks(text, LIMITS.llm, targetLang, async (piece) => {
					const response = await request("POST", llmUrl(options.llmBaseUrl), {
						body: llmBody(piece, targetLang, String(options.llmModel || "").trim()),
						headers: {
							"Authorization": "Bearer " + String(options.llmKey || "").trim(),
							"Content-Type": "application/json",
						},
						timeout: Math.max(timeout, 20000),
					});
					if (!response || !response.status || response.status < 200 || response.status >= 300) {
						throw new Error("HTTP " + (response && response.status ? response.status : "无响应"));
					}
					return parseLlm(response.text);
				});

			default:
				throw new Error("未知的翻译引擎 " + name);
		}
	}

	/**
	 * Translate one sentence.
	 *
	 * @param {string} text
	 * @param {object} options provider, targetLang, deeplKey, llmBaseUrl,
	 *   llmModel, llmKey, request, custom, timeoutMs
	 * @returns {Promise<{text: string, provider: string}>}
	 */
	async function translate(text, options) {
		const opts = options || {};
		const source = normalizeText(text);
		if (!source) throw new Error("没有可翻译的文本");
		if (typeof opts.request !== "function") throw new Error("翻译层缺少网络通道");

		const targetLang = opts.targetLang || "zh-CN";
		const chain = providerChain(opts);
		const failures = [];

		for (const name of chain) {
			for (let attempt = 0; ; attempt++) {
				try {
					const result = await runProvider(name, source, targetLang, opts, opts.request);
					const clean = normalizeText(result);
					if (!clean) throw new Error("空译文");
					return { text: clean, provider: name };
				}
				catch (e) {
					// A dropped connection is usually transient; one retry is
					// cheaper than making the user click again.
					if (e && e.transport && attempt === 0) {
						await delay(400);
						continue;
					}
					failures.push(name + "：" + ((e && e.message) || e));
					break;
				}
			}
		}

		const error = new Error(failures.join("；") || "没有可用的翻译引擎");
		error.failures = failures;
		throw error;
	}

	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	return {
		translate: translate,
		providerChain: providerChain,
		splitForLimit: splitForLimit,
		normalizeText: normalizeText,
		googleUrl: googleUrl,
		parseGoogle: parseGoogle,
		myMemoryUrl: myMemoryUrl,
		myMemorySource: myMemorySource,
		parseMyMemory: parseMyMemory,
		deepLTarget: deepLTarget,
		deepLEndpoint: deepLEndpoint,
		deepLBody: deepLBody,
		parseDeepL: parseDeepL,
		llmUrl: llmUrl,
		llmBody: llmBody,
		llmSystemPrompt: llmSystemPrompt,
		cleanModelOutput: cleanModelOutput,
		parseLlm: parseLlm,
		languageName: languageName,
		LIMITS: LIMITS,
	};
});
