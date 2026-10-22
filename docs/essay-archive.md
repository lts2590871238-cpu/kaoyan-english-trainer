# 历年考研作文模块 · 验收与部署

## 已实现
- 2005—2026 英语（一）小作文 + 大作文，共 22 年 44 道，逐题提供英文题面、年份、文体分类和满分。
- 每年 Part A/B 都可查看该年完整原卷写作页图片（`essay-scans/YYYY.jpg`），在当前页面放大，点击「返回写作」关闭；2024/2025 图表数据已经核对。
- 独立入口：欢迎页、学习首页 → `#essay` → `#essay/2010_A` 等 → 可返回年份列表／首页。
- 编辑区实时字数、自动草稿保存、提交前保存当次全文、历史多稿互不覆盖、基于某一稿继续修改、导出 JSON。
- 复用已有账号与 D1 `progress_chunks` 云同步。草稿暂放 `core`，每一篇正式保存的稿件以 `essay:<题号>:<唯一记录ID>` 独立存储，不复写旧稿；初始全量同步自动分批上传，每批不超过40条。上线前必须先发布兼容新分片键的 Worker。
- 评分为英语（一）五档 **AI 模拟评分**，Part A 满分10、Part B满分20；指出内容完成、组织衔接、语言及格式与语域，并逐条提供原句、原因和改法。不能评估手写字迹。
- 基于 Playwright 的桌面、手机浏览器测试：`scripts/tests/test-essay-feature.cjs`，检查历史保存、评分模拟、跨设备云端恢复、原卷弹层、页面返回和移动端横向越界。

## 重要：前端合并≠Worker已部署
本仓库的 `worker/deepseek-worker.js` 添加了 `POST /score-essay`，但 **GitHub Pages 不会自动发布 Cloudflare Worker**。不能仅因本分支已合并就说 DeepSeek 作文评分已经上线。

安全部署步骤（需登录原本管理这个 Worker 的 Cloudflare 账号）：
1. 登录对应 Cloudflare 账号，找到现有 Worker `xuanxuan-english-ai`；先备份当前代码，并记下 D1 数据库绑定名 `DB` 和现有 Secrets 名称，不能新建同名空 Worker。
2. 通过 Cloudflare > Workers & Pages > `xuanxuan-english-ai` > Edit Code，把分支 [`worker/deepseek-worker.js`](../worker/deepseek-worker.js) 的完整代码部署到**同一个** Worker。**保留原有** D1 `DB`、`DEEPSEEK_API_KEY`、`AUTH_PEPPER`、`ADMIN_RESET_SECRET`、`ALLOWED_ORIGIN`、`DEEPSEEK_MODEL` 配置。不要将任何密钥粘入 GitHub，也不要用缺少 D1 绑定的简单 Wrangler 示例文件覆盖线上环境。
3. 发布后访问 `https://xuanxuan-english-ai.lts2590871238.workers.dev/health`，确认 `version` 为 `v21.2.1-essay-2026` 且 `configured`、`database`、`auth_configured` 为 `true`；此检测不消耗 DeepSeek 额度。
4. 先确认旧有账号登录、单词训练和翻译评分仍正常；然后在新前端（PR 合并后）分别写一篇 A 和 B，核对 10 分 / 20 分、反馈和历史；再用另一设备登录同一账号核对全部已存稿。
5. 如果出现线上异常，Cloudflare Worker 可按版本记录回滚到备份代码，GitHub Pages 可以回滚此次 PR；D1 原始数据不会因为回滚代码而自动删除。
6. 前端 GitHub Pages 发布及 Worker 发布 **都验证通过后**，才能把这个功能视为正式可用。

## 数据与边界
- 题面和图画来自用户提供的2005—2026真题交接包，并用原卷截图核对；2010 Part A 是“志愿者招募通知”而非“建议信”。
- DeepSeek 评分基于题面、经核对的图表文字摘要和学生正文，不直接向模型发送图片。对原图细节的判断须谨慎。
- 每次评分请求会在发往 Worker 前保存正文；DeepSeek 暂时不可用时，失败信息会连同原稿保存在本题历史中，切勿将失败误当零分。
- 已改为每篇一条独立的 `progress_chunks` 记录，避免全历史堆在 1.5MB 的 `core` 分片里；客户端仍保存历史副本，云端每条记录都有限额，请不要把超长资料当作文提交。建议定期通过「导出全部记录」留存个人备份。
- 若新 Worker 未部署，旧 Worker 会忽略作文专用云分片；网站不能宣称跨设备历史同步成功，因此切勿在新旧代码不一致时正式放量。
- 请定期确认电脑与手机登录的是同一个账号；只有云同步成功才能跨设备恢复，不宜仅依赖浏览器缓存。

## 2026 追加说明（2026-10-22）
- 新增小作文：给朋友 Paul 回复邮件，介绍中国家庭手写书信，并回答是否有公开展出；回复询问邮件，10 分。
- 新增大作文：养老机器人消费者接受度与首要关注点的饼图＋柱状图作文，20 分。饼图 39.3%／32.8%／27.9%，柱状图安全 46.30%／价格 24.90%／便利 10.70%，后者显示的是所列首要关注因素，并非完整比例表。原题扫描位于 `essay-scans/2026.jpg`。
- 前端目录及训练模块、云历史分片键格式、Worker `/score-essay` 年份校验均扩展至2026。
- **先在 Cloudflare 部署本分支 `worker/deepseek-worker.js`（`v21.2.1-essay-2026`），确认 /health 版本；再合并 GitHub PR 到 main**。仅合并前端但未升级 Worker 会导致2026评分及记录云同步失败。
- 旧账号登录、原来的每个练习模块、2005—2025 的全部数据保持不变。
