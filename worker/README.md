# DeepSeek runtime proxy

不要把 DeepSeek API Key、认证 Pepper 或管理员密钥写进网页或 GitHub 文件。

部署 Cloudflare Worker 后：
- 把 `DEEPSEEK_API_KEY` 作为 Worker Secret 保存。
- 把 `AUTH_PEPPER` 作为 Worker Secret 保存。
- 把 `ADMIN_RESET_SECRET` 作为 Worker Secret 保存；它只用于站长重置用户密码。
- 把 D1 数据库绑定为 `DB`。
- 网页的 `config.js` 只保存 Worker URL，绝不能保存任何 Secret。

Worker 提供：
- `POST /auth/register`：注册账号并生成一次性显示的恢复码。
- `POST /auth/login`：账号登录。
- `POST /auth/reset-password`：用户凭恢复码重置密码。
- `POST /admin/reset-password`：站长凭 `ADMIN_RESET_SECRET` 重置指定账号密码，刷新恢复码并注销该账号旧会话，不删除学习进度。
- `GET /sync/pull` / `POST /sync/push`：同步学习进度。
- `POST /score-translation`：宽松智能翻译评分。
- `POST /daily-plan`：在本地候选中进行智能复习/句子重排。

管理员重置接口有独立限流。管理员密钥由 Cloudflare Worker Secret 保存，前端只在本次操作时提交，不写入 localStorage / sessionStorage。

如果 Worker 或 DeepSeek 暂时不可用，网页会退回本地计划，不影响基础练习。
