# 插件市场提交草稿

提交地址：https://github.com/zotero-chinese/zotero-plugins/issues/new

标题：

```
[新插件] Sentence Translate — 点击 PDF 句子，句下显示中文译文
```

正文：

```markdown
- 仓库：https://github.com/zrqworkmail-cloud/sentence-translate
- 最新 Release：https://github.com/zrqworkmail-cloud/sentence-translate/releases/latest
- 插件 ID：sentence-translate@zrqworkmail-cloud.github.io
- 支持版本：Zotero 10（`strict_min_version` 10.0，`strict_max_version` 10.*；仅在 Zotero 10.0.8 上验证）
- 许可证：MIT

功能：在 Zotero PDF 阅读器里点击一个句子，按文字宽度高亮该句，并在句子正下方显示中文译文；点击下一句时上一句的高亮和译文一起消失。翻译由插件自带，只装这一个插件就能用：「自动」按 大模型 → DeepL → Google → MyMemory 的顺序尝试（大模型和 DeepL 只在填了对应 key 时参与），全部失败才回退到已安装的 Translate for Zotero。Google 优先走 `clients5.google.com` 的扩展端点，失败再试 `translate_a/single`。所有请求经 Zotero 的 HTTP 栈发出、跟随系统代理，每个请求带硬超时，网络不通时自动换下一个引擎而不是一直转圈。免密钥接口用的是未公开端点，不保证长期可用。设置页提供“测试翻译”按钮，用固定例句当场验证当前引擎。

外观可调：高亮颜色与不透明度、译文背景色与背景不透明度、译文文字颜色都在设置页里修改。提供浅灰、纯白、深色、米色、浅蓝、高对比 6 套一键配色方案；默认译文背景为浅灰 `#e6e6e6`、95% 不透明，文字自动用深色；深色背景会自动改用浅色文字，也可取消“自动对比”指定任意文字颜色。

实现：独立实现，不使用 Sentence Focus 或其他插件的代码。用 Zotero 10 的 `pdfDocument.getPageData({ pageIndex })` 取字符与 `viewBox`，把 PDF 左下原点坐标换算成左上原点并按页面百分比定位；按基线聚行、补回词间空格、识别双栏中缝、按句末标点切句；高亮矩形按字符比例切分，译文条按原句水平范围设置宽度，与原文句子同宽。仓库包含 MIT LICENSE、README、`updates.json` 和可复现的 `build.ps1`，纯文本几何层有 Node 测试。

更新清单：https://github.com/zrqworkmail-cloud/sentence-translate/releases/latest/download/updates.json

自动更新实测：已在干净配置实测 0.2.3 自动升级到 0.2.4；0.3.0 发布后 `latest/download/updates.json` 返回 0.3.0。
```
