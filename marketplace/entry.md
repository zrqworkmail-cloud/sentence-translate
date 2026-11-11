# 插件市场提交草稿

提交地址：https://github.com/zotero-chinese/zotero-plugins/issues/new

标题：

```
[新插件] Sentence Translate — 点击 PDF 句子，句下显示中文译文
```

正文：

```markdown
- 仓库：https://github.com/<owner>/sentence-translate
- 最新 Release：https://github.com/<owner>/sentence-translate/releases/latest
- 插件 ID：sentence-translate@<owner>.github.io
- 支持版本：Zotero 7–11
- 许可证：MIT

功能：在 Zotero PDF 阅读器里点击一个句子，按文字宽度高亮该句，并在句子正下方显示中文译文；点击下一句时上一句的高亮和译文一起消失。译文通过 Translate for Zotero 的公开 API 获取，复用其中已配置的翻译引擎；未安装时只高亮。

实现：独立实现，不使用 Sentence Focus 或其他插件的代码。使用 PDF.js 的 getTextContent() 取文字与坐标，按基线聚行、识别双栏中缝、按句末标点切句；高亮矩形按字符比例切分，译文条宽度随文字收缩。

仓库已包含 MIT LICENSE、README、updates.json 与可复现的 build.ps1。
```
