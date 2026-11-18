"use strict";

const assert = require("assert");
const T = require("../src/lib/translation.js");

// --- splitting long text for providers with a small limit ------------------

{
	assert.deepStrictEqual(T.splitForLimit("Short sentence.", 450), ["Short sentence."]);
	assert.deepStrictEqual(T.splitForLimit("   ", 450), []);

	const long = ("Sentence number one is here. ").repeat(40);
	const pieces = T.splitForLimit(long, 120);
	assert.ok(pieces.length > 1, "long text split");
	assert.ok(pieces.every((p) => p.length <= 120), "every piece fits the limit");
	assert.strictEqual(pieces.join(" ").replace(/\s+/g, " ").trim(), long.trim(), "no words lost");
}

{
	// A single word longer than the limit is cut, not dropped.
	const pieces = T.splitForLimit("x".repeat(300), 100);
	assert.strictEqual(pieces.join(""), "x".repeat(300));
	assert.ok(pieces.every((p) => p.length <= 100));
}

// --- Google ----------------------------------------------------------------

{
	const payload = [[
		["敏捷的棕色狐狸", "The quick brown fox", null, null, 3],
		["跳过了那只懒狗。", " jumps over the lazy dog.", null, null, 3],
	], null, "en"];
	assert.strictEqual(T.parseGoogle(payload), "敏捷的棕色狐狸跳过了那只懒狗。");
	assert.ok(T.googleUrl("a b", "zh-CN").includes("q=a%20b"), "query is encoded");
	assert.throws(() => T.parseGoogle({ nope: true }), /无法识别/);
	assert.throws(() => T.parseGoogle([[]]), /空译文/);
}

// --- MyMemory --------------------------------------------------------------

{
	assert.strictEqual(T.myMemorySource("zh-CN"), "en");
	assert.strictEqual(T.myMemorySource("en"), "zh-CN");
	assert.ok(T.myMemoryUrl("hello", "zh-CN").includes("langpair=en%7Czh-CN"));

	assert.strictEqual(
		T.parseMyMemory({ responseStatus: 200, responseData: { translatedText: "你好" } }),
		"你好"
	);
	assert.throws(
		() => T.parseMyMemory({ responseStatus: 200, responseData: { translatedText: "MYMEMORY WARNING: LIMITED" } }),
		/空译文/
	);
	assert.throws(() => T.parseMyMemory({ responseStatus: 429, responseData: {} }), /频繁/);
}

// --- DeepL -----------------------------------------------------------------

{
	assert.strictEqual(T.deepLTarget("zh-CN"), "ZH");
	assert.strictEqual(T.deepLTarget("zh-TW"), "ZH-HANT");
	assert.strictEqual(T.deepLTarget("en"), "EN");
	assert.ok(T.deepLEndpoint("abc:fx").includes("api-free"));
	assert.ok(T.deepLEndpoint("abc").includes("api.deepl.com"));
	assert.ok(T.deepLBody("a b", "zh-CN").includes("text=a%20b"));
	assert.strictEqual(T.parseDeepL({ translations: [{ text: "你好" }] }), "你好");
	assert.throws(() => T.parseDeepL({ translations: [] }), /空译文/);
}

// --- LLM -------------------------------------------------------------------

{
	assert.strictEqual(T.llmUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
	assert.strictEqual(T.llmUrl("https://x/v1/chat/completions"), "https://x/v1/chat/completions");
	assert.throws(() => T.llmUrl(""), /接口地址/);

	const body = JSON.parse(T.llmBody("Hello.", "zh-CN", "deepseek-chat"));
	assert.strictEqual(body.model, "deepseek-chat");
	assert.strictEqual(body.messages[1].content, "Hello.");
	assert.ok(body.messages[0].content.includes("简体中文"));
	assert.throws(() => T.llmBody("Hello.", "zh-CN", ""), /模型名称/);

	assert.strictEqual(T.cleanModelOutput("```\n你好。\n```"), "你好。");
	assert.strictEqual(T.cleanModelOutput("译文：你好。"), "你好。");
	assert.strictEqual(T.cleanModelOutput("“你好。”"), "你好。");
	assert.strictEqual(
		T.parseLlm({ choices: [{ message: { content: " 你好。 " } }] }),
		"你好。"
	);
}

// --- provider chain --------------------------------------------------------

{
	assert.deepStrictEqual(T.providerChain({ provider: "auto" }), ["google", "mymemory"]);
	assert.deepStrictEqual(
		T.providerChain({ provider: "auto", deeplKey: "k:fx" }),
		["deepl", "google", "mymemory"]
	);
	assert.deepStrictEqual(
		T.providerChain({
			provider: "auto",
			llmKey: "k", llmBaseUrl: "https://x/v1", llmModel: "m",
			deeplKey: "k", custom: { zotero: () => "x" },
		}),
		["llm", "deepl", "google", "mymemory", "zotero"]
	);
	assert.deepStrictEqual(T.providerChain({ provider: "google", custom: {} }), ["google"]);
	assert.throws(() => T.providerChain({ provider: "zotero" }), /未检测到/);
	assert.throws(() => T.providerChain({ provider: "deepl" }), /缺少必要配置/);
}

// --- translate() with an injected transport --------------------------------

function transport(routes) {
	const calls = [];
	const request = async (method, url, options) => {
		calls.push({ method, url, options });
		for (const [match, reply] of routes) {
			if (url.includes(match)) return reply(calls.length);
		}
		return { status: 404, text: "" };
	};
	request.calls = calls;
	return request;
}

(async () => {
	// Google answers: no fallback needed.
	{
		const request = transport([
			["clients5.google.com", () => ({ status: 200, text: JSON.stringify([["你好。", "en"]]) })],
		]);
		const result = await T.translate("Hello.", { request });
		assert.strictEqual(result.text, "你好。");
		assert.strictEqual(result.provider, "google");
		assert.strictEqual(request.calls.length, 1);	
		assert.ok(request.calls[0].url.startsWith("https://clients5.google.com/"));
	}

	// Google fails, MyMemory answers.
	{
		const request = transport([
			["translate.googleapis.com", () => ({ status: 429, text: "" })],
			["mymemory", () => ({ status: 200, text: JSON.stringify({ responseStatus: 200, responseData: { translatedText: "你好。" } }) })],
		]);
		const result = await T.translate("Hello.", { request });
		assert.strictEqual(result.provider, "mymemory");
		assert.strictEqual(result.text, "你好。");
	}

	// Everything fails: the message names each engine.
	{
		const request = transport([
			["translate.googleapis.com", () => ({ status: 500, text: "" })],
			["mymemory", () => ({ status: 500, text: "" })],
		]);
		await assert.rejects(
			() => T.translate("Hello.", { request }),
			(e) => /google/.test(e.message) && /mymemory/.test(e.message)
		);
	}

	// A long paragraph is chunked for MyMemory and joined without a space
	// between Chinese fragments.
	{
		const request = transport([
			["mymemory", () => ({ status: 200, text: JSON.stringify({ responseStatus: 200, responseData: { translatedText: "片段。" } }) })],
		]);
		const long = "This is a fairly long sentence. ".repeat(40);
		const result = await T.translate(long, { request, provider: "mymemory", targetLang: "zh-CN" });
		assert.ok(request.calls.length > 1, "chunked into several requests");
		assert.ok(!result.text.includes("。 片段"), "Chinese chunks joined without a gap");
	}

	// A custom provider (Translate for Zotero) is preferred when selected.
	{
		const request = transport([]);
		const result = await T.translate("Hello.", {
			request,
			provider: "zotero",
			custom: { zotero: (text) => "来自 Zotero 的译文" },
		});
		assert.strictEqual(result.text, "来自 Zotero 的译文");
		assert.strictEqual(request.calls.length, 0, "no network call for the custom provider");
	}

	console.log("translation.js: all assertions passed");
})().catch((e) => {
	console.error(e);
	process.exit(1);
});

