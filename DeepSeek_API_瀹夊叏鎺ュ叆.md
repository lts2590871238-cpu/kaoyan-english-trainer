# DeepSeek API 安全接入

## 一、构建 3000 词和 600 句静态题库

API Key **不要发到聊天里，也不要写进 `app.js` / `config.js` / GitHub 普通文件。**

进入你的 GitHub 仓库：

1. `Settings`
2. `Secrets and variables`
3. `Actions`
4. `New repository secret`
5. Name 填：`DEEPSEEK_API_KEY`
6. Secret 填你在 DeepSeek 控制台得到的 API Key
7. 保存

然后：

1. 顶部 `Actions`
2. 左侧选择 `Build stable bilingual content`
3. `Run workflow`
4. 等待绿色对勾
5. 打开该任务日志，最后必须看到：`RELEASE VALIDATION: PASS`

工作流会把成功生成并验收过的 `data/generated/` 自动提交回 main 分支。

## 二、运行时 AI 翻译评分 / 智能每日微调

GitHub Pages 是纯前端，不能安全保存 API Key。因此运行时必须通过一个服务端代理。

本项目已经提供：

`worker/deepseek-worker.js`

推荐部署到 Cloudflare Workers。

在 Worker 的 Settings / Variables and Secrets 中添加：

- Secret：`DEEPSEEK_API_KEY` = 你的 DeepSeek Key
- Variable：`ALLOWED_ORIGIN` = 你的 GitHub Pages 域名，例如 `https://lts2590871238-cpu.github.io`
- Variable：`DEEPSEEK_MODEL` = `deepseek-v4-flash`

部署后得到类似：

`https://xuanxuan-english-ai.<你的子域>.workers.dev`

然后只修改 GitHub 的 `config.js`：

```js
window.XUANXUAN_CONFIG = {
  AI_PROXY_URL: "https://你的worker地址.workers.dev",
  DEFAULT_ACCENT: "en-US"
};
```

这里填的是公开的 Worker 地址，不是 API Key。

## 三、断网/AI故障策略

- 词义、译文、句法数据已经静态存在本地，不受 DeepSeek 是否在线影响。
- 每日计划有本地 5:3:2 与遗忘曲线兜底。
- AI评分失败时会显示参考译文并允许自评，不会卡住当天进度。
