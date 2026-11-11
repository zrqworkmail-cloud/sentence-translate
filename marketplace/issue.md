- 仓库：https://github.com/zrqworkmail-cloud/sentence-translate
- 最新 Release：https://github.com/zrqworkmail-cloud/sentence-translate/releases/latest
- 插件 ID：sentence-translate@zrqworkmail-cloud.github.io
- 支持版本：Zotero 7–11（`strict_min_version` 7.0，`strict_max_version` 11.*）
- 许可证：MIT

功能：在 Zotero PDF 阅读器里点击一个句子，按文字宽度高亮该句，并在句子正下方显示中文译文；点击下一句时，上一句的高亮和译文一起消失。译文通过 Translate for Zotero 的公开 API 获取，复用其中已配置的翻译引擎；未安装 TfZ 时只高亮，不报错。

实现：独立实现，不使用 Sentence Focus 或其他插件的代码。用 PDF.js 的 `getTextContent()` 取文字与坐标，按基线聚行、识别双栏中缝、按句末标点切句；高亮矩形按字符比例切分，译文条用 `max-content` 随文字收缩。仓库包含 MIT LICENSE、README、`updates.json` 和可复现的 `build.ps1`，纯文本几何层有 Node 测试。

更新清单：https://cdn.jsdelivr.net/gh/zrqworkmail-cloud/sentence-translate@main/updates.json
