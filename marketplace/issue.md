- 仓库：https://github.com/zrqworkmail-cloud/sentence-translate
- 最新 Release：https://github.com/zrqworkmail-cloud/sentence-translate/releases/latest
- 插件 ID：sentence-translate@zrqworkmail-cloud.github.io
- 支持版本：Zotero 7–11（`strict_min_version` 7.0，`strict_max_version` 11.*）
- 许可证：MIT
- 更新清单：https://github.com/zrqworkmail-cloud/sentence-translate/releases/latest/download/updates.json

功能：在 Zotero PDF 阅读器里点击一个句子，按文字宽度高亮该句，并在句子正下方显示中文译文；点击下一句时上一句的高亮和译文一起消失。实际需要安装 Translate for Zotero：译文通过其公开 API 获取，复用其中已配置的翻译引擎；未安装时仍会高亮，句下提示“未检测到 Translate for Zotero”，不会出现译文。

外观可调：高亮颜色与不透明度、译文背景色与背景不透明度、译文文字颜色都在设置页里修改。提供浅灰、纯白、深色、米色、浅蓝、高对比 6 套一键配色方案；默认译文背景为浅灰 `#e6e6e6`、95% 不透明，文字自动用深色；深色背景会自动改用浅色文字，也可取消“自动对比”指定任意文字颜色。

实现：独立实现，不使用 Sentence Focus 或其他插件的代码。用 Zotero 10 的 `pdfDocument.getPageData({ pageIndex })` 取字符与 `viewBox`，把 PDF 左下原点坐标换算成左上原点并按页面百分比定位；按基线聚行、补回词间空格、识别双栏中缝、按句末标点切句；高亮矩形按字符比例切分，译文条用 `max-content` 随文字收缩。仓库包含 MIT LICENSE、README、`updates.json` 和可复现的 `build.ps1`，纯文本几何层有 Node 测试。

当前版本：0.2.4。浅灰方案改为更可见的 `#e6e6e6` / 95%；修复“自动对比”复选框在 Zotero 设置页不写入偏好的问题。更新清单使用随 Release 发布的 `latest/download/updates.json`。
