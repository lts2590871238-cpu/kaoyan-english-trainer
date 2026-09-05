# DeepSeek runtime proxy

不要把 DeepSeek API Key 写进网页或 GitHub 文件。

部署 Cloudflare Worker 后，把 `DEEPSEEK_API_KEY` 作为 Worker Secret 保存；网页只保存 Worker URL。

Worker 提供：
- `POST /score-translation`：宽松智能翻译评分。
- `POST /daily-plan`：在本地候选中进行智能复习/句子重排。

如果 Worker 或 DeepSeek 暂时不可用，网页会退回本地计划，不影响基础练习。
