# 历年考研作文模块 · 验收与部署

## 已实现
- 2005—2025 英语（一）小作文 + 大作文，共 21 年 42 道，逐题提供英文题面、年份、文体分类和满分。
- 每年 Part B 采用原卷写作页扫描图片（`essay-scans/YYYY.jpg`），支持放大，2024/2025 图表单位另作核实。
- 独立入口：欢迎页、学习首页 → `#essay` → `#essay/2010_A` 等 → 可返回年份列表／首页。
- 编辑区实时字数、自动草稿保存、提交前保存当次全文、历史多稿互不覆盖、基于某一稿继续修改、导出 JSON。
- 复用已有账号和 D1 云同步（`Store.state.essayWork`, `Store.state.essayHistory`）。
- 评分为英语（一）五档 **AI 模拟评分**，Part A 满分10、Part B满分20；指出内容完成、组织衔接、语言及格式与语域，并逐条提供原句、原因和改法。不能评估手写字迹。
- 基于 Playwright 的桌面、手机冒烟测试：`scripts/tests/test-essay-feature.cjs`，检查历史保留、页面返回、内容一致和移动端横向越界。

## 重要：前端合并≠Worker已部署
本仓库的 `worker/deepseek-worker.js` 添加了 `POST /score-essay`，但 **GitHub Pages 不会自动发布 Cloudflare Worker**。不能仅因本分支已合并就说 DeepSeek 作文评分已经上线。

安全部署步骤（需登录原本管理这个 Worker 的 Cloudflare 账号）：
1. 确认当前线上 Worker 名称 `xuanxuan-english-ai`；先备份现有线上代码及设置，尤其 D1 `DB` 绑定。
2. 在该 Worker 的编辑／部署工作流里，应用此分支 `worker/deepseek-worker.js`，**保留原有** D1 `DB`、`DEEPSEEK_API_KEY`、`AUTH_PEPPER`、`ADMIN_RESET_SECRET`、`ALLOWED_ORIGIN`、`DEEPSEEK_MODEL` 配置。不要把任何密钥写入 GitHub 或前端，也不要用缺少 D1 绑定的简单 Wrangler 示例文件覆盖线上设置。
3. 发布后访问 Worker `/health`，确认 `version` 为 `v21.2.0-essay` 且 `configured`、`database`、`auth_configured` 均正常。
4. 登录网站，选择一篇英语（一）真题，输入完整正文后点击评分；验证分数（A/10、B/20）、逐条反馈、历史记录和换设备的恢复。
5. 前端 GitHub Pages 发布及 Worker 发布 **都验证通过后**，才能把这个功能视为正式可用。

## 数据与边界
- 题面和图画来自用户提供的2005—2025真题交接包，并用原卷截图核对；2010 Part A 是“志愿者招募通知”而非“建议信”。
- DeepSeek 评分基于题面、经核对的图表文字摘要和学生正文，不直接向模型发送图片。对原图细节的判断须谨慎。
- 每次评分请求会在发往 Worker 前保存正文；DeepSeek 暂时不可用时，失败信息会连同原稿保存在本题历史中，切勿将失败误当零分。
- 存档采用现有账号云同步的 core chunk；大量历史作文长期累积可能达到原有同步单块1.5MB限额，应定期导出 JSON；达到此规模前需升级为独立分片或逐篇 D1 表。
- 请定期确认电脑与手机登录的是同一个账号；只有云同步成功才能跨设备恢复，不宜仅依赖浏览器缓存。
