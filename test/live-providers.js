/*
 * Live check of the built-in providers against the real endpoints.
 * Run with: node test/live-providers.js
 *
 * This is not part of the unit tests: it needs network access and is meant to
 * be run by hand after changing a provider.
 */

"use strict";

const T = require("../src/lib/translation.js");

async function request(method, url, options) {
	const opts = options || {};
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeout || 15000);
	try {
		const response = await fetch(url, {
			method: method,
			headers: opts.headers,
			body: opts.body,
			signal: controller.signal,
		});
		return { status: response.status, text: await response.text() };
	}
	catch (e) {
		// Same flag the Zotero transport sets, so the retry path is exercised.
		const error = new Error(((e && e.cause && e.cause.message) || (e && e.message) || "network"));
		error.transport = true;
		throw error;
	}
	finally {
		clearTimeout(timer);
	}
}

const SENTENCE = "We propose a transformer-based framework that reduces inference latency by 38% on long documents.";
const CHINESE = "该框架在长文档上的推理延迟降低了 38%。";

const CASES = [
	{ label: "google en→zh", text: SENTENCE, options: { provider: "google", targetLang: "zh-CN" } },
	{ label: "google 长句分块", text: (SENTENCE + " ").repeat(4), options: { provider: "google", targetLang: "zh-CN" } },
	{ label: "mymemory en→zh", text: SENTENCE, options: { provider: "mymemory", targetLang: "zh-CN" } },
	{ label: "mymemory 长文分块", text: (SENTENCE + " ").repeat(4), options: { provider: "mymemory", targetLang: "zh-CN" } },
	{ label: "google zh→en", text: CHINESE, options: { provider: "google", targetLang: "en" } },
	{ label: "auto 链路", text: SENTENCE, options: { provider: "auto", targetLang: "zh-CN" } },
];

(async () => {
	let failed = 0;
	for (const testCase of CASES) {
		try {
			const result = await T.translate(testCase.text, {
				...testCase.options,
				request,
				timeoutMs: 15000,
			});
			console.log(`PASS ${testCase.label} [${result.provider}] ${result.text}`);
		}
		catch (e) {
			failed++;
			console.log(`FAIL ${testCase.label}: ${(e && e.message) || e}`);
		}
	}

	// A missing key must be reported, not silently ignored.
	try {
		await T.translate(SENTENCE, { provider: "deepl", request });
		console.log("FAIL deepl 无 key 时应报错");
		failed++;
	}
	catch (e) {
		console.log(`PASS deepl 无 key 报错: ${e.message}`);
	}

	console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
	process.exit(failed ? 1 : 0);
})();
