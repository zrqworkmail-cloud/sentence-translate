# Sentence Translate

在 Zotero 的 PDF 阅读器里点一个句子，就给该句加上按文字宽度的高亮，并在句子正下方显示中文译文；点下一句时，上一句的高亮和译文一起消失。

这是一个独立实现，不复用 Sentence Focus 的代码。句子切分、坐标换算、命中测试和高亮绘制都在本仓库内完成；翻译交给已安装的 **Translate for Zotero**。

## 依赖

- Zotero 7 及以上（在 Zotero 10.0.8 上开发与验证）
- **Translate for Zotero**（可选）：安装后译文才会出现；未安装时只高亮

## 安装

从 [Releases](https://github.com/zrqworkmail-cloud/sentence-translate/releases/latest) 下载最新的 `.xpi`，然后：

1. 打开 Zotero → 工具 → 插件 → 齿轮 → Install Plugin From File…
2. 选择下载的 `sentence-translate-<version>.xpi`
3. 打开一篇 PDF，直接点句子即可

如果同时装着其他点句高亮插件，建议先禁用，避免两层高亮叠在一起。

## 更新

插件通过 `updates.json` 检查更新。已在干净配置实测 0.2.3 自动升级到 0.2.4，`latest/download/updates.json` 返回 0.2.4。

## 使用

- 单击句子：高亮该句，句下出现中文译文。
- 单击另一句：上一句的高亮与译文立即移除。
- 拖动选择文字、点击链接或注释：不触发。
- 缩放或翻页后高亮会清除，再点一次即可（译文有缓存，回来时立即显示）。

## 设置

编辑 → 设置 → Sentence Translate：

| 项 | 说明 |
|---|---|
| 启用点句翻译 | 总开关 |
| 配色方案 | 浅灰 / 纯白 / 深色 / 米色 / 浅蓝 / 高对比，一键套用 |
| 高亮颜色 | 系统取色器（任意颜色）+ 8 个常用色块 |
| 高亮不透明度 | 5–90，默认 38 |
| 译文背景色 | 系统取色器（任意颜色）+ 8 个常用色块，默认浅灰 `#e6e6e6` |
| 译文背景不透明度 | 0–100，默认 95 |
| 译文文字颜色 | 系统取色器 + 常用色块；默认“自动对比”，可手动指定 |
| 译文目标语言 | 默认简体中文 |
| 译文最多行数 | 1–6，默认 3 |

配色方案会同时设置高亮色、高亮不透明度、译文背景色/不透明度和文字颜色；套用后仍可逐项微调。默认“浅灰”为 `#e6e6e6` / 95% / 自动文字；深色背景会自动改用浅色文字，也可以取消“自动对比”指定任意文字颜色。

## 实现要点

- 用 Zotero 10 的 `PDFViewerApplication.pdfDocument.getPageData({ pageIndex })` 取每页字符与 `viewBox`，不依赖阅读器内部选择状态，也不调用 Zotero 10 已不提供的 PDF.js `getPage().getTextContent()`。
- 字符矩形从 PDF 的左下原点换算成左上原点，再统一按页面百分比定位，缩放和滚动后仍能对齐。
- 文本项按基线聚成行，补回词间空格，识别双栏页面的中缝；按句末标点切句，跨行句子合并，行末连字符会接回。
- 高亮矩形按字符比例从文本项宽度切分，所以底纹贴合文字，而不是铺满整栏。
- 译文条宽度用 `max-content`，随译文长度收缩，只有贴近页面右边距时才换行。

## 开发

```powershell
node test/text.test.js      # 纯文本几何层测试，不需要 Zotero
./build.ps1                 # 生成 build/sentence-translate-<version>.xpi
```

`src/lib/text.js` 不引用 Zotero 或 DOM，可以直接在 Node 里跑；`src/bootstrap.js` 只负责阅读器接入、绘制和翻译。

## 已知限制

- 只支持 PDF；EPUB 和网页快照暂不支持。
- 句子切分是启发式的：参考文献条目、公式行和极端排版可能需要手动调整。
- 旋转页面、扫描件（无文字层）不保证可用。
- 译文是页面浮层，不写入 Zotero 注释。

## 许可证

MIT，见 `LICENSE`。
