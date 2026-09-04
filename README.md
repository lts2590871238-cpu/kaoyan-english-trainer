# 考研英语一真题训练器（2023—2026）

这是一个纯静态网页：HTML + CSS + JavaScript + JSON 数据，不需要服务器、不需要数据库，适合直接放到 GitHub Pages。

## 已有功能

1. 词汇 / 词组连线：每轮最多 50 个，分成 10 个一组；错词会提高后续出现概率。
2. 汉译 → 英文拼句：真题 Part C 句子按意群拆分，并加入干扰词块。
3. 英文 → 中文拼译：用中文意群重组，不要求逐词硬译。
4. 无提示汉译：用户直接输入中文；本地“宽松评分”按关键语义覆盖 + 文本相似度综合判断，并允许用户自我修正。
5. 长难句拆骨架：显示主干、从句、修饰和逻辑关系。
6. 错题强化：把词汇错题重新放回真题语境做填词选择。
7. LocalStorage：浏览器自动保存错题、已练项目和累计练习次数。

## 文件

- `index.html`：网页入口
- `styles.css`：页面样式
- `data.js`：题库。后续扩充年份时主要修改这个文件
- `app.js`：所有练习逻辑

## 本地打开

最简单：直接双击 `index.html`。

推荐：双击 `一键本地运行.bat`。新版启动器会先启动本地服务器，等待 2 秒后再打开浏览器，并自动兼容 Windows 常见的 `py -3` 和 `python` 两种命令。

网页地址为 `http://127.0.0.1:8000/`。如果 Python 不可用，启动器会自动退回到直接打开 `index.html`。

## 发布到 GitHub Pages

1. 登录 GitHub，新建仓库，例如 `kaoyan-english-trainer`。
2. 把本文件夹里的 `index.html`、`styles.css`、`app.js`、`data.js`、`README.md` 上传到仓库根目录。
3. 进入仓库 `Settings` → `Pages`。
4. `Build and deployment` 中：Source 选择 `Deploy from a branch`。
5. Branch 选择 `main`，Folder 选择 `/ (root)`，点击 `Save`。
6. 等待 1—3 分钟，GitHub 会显示网站地址。

## 数据扩充原则

不要把题写死在页面里。所有词汇和句子都继续放在 `data.js` 中。未来加入 2022、2021 等年份时，只追加数据即可，不需要重写页面。
