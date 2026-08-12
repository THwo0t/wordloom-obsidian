# Wordloom

Wordloom 是一款面向 Obsidian 的本地 IELTS 生词采集器。输入单词后，DeepSeek 原生 Web Search 会限定搜索 Cambridge Dictionary，提取词性、音标、释义、例句与 CEFR 等级，并在同一次请求中整理学习提示，最后安全追加到指定的 Markdown 笔记。

## 特性

- DeepSeek V4 Flash 原生网页搜索，严格限定 Cambridge Dictionary 域名与精确词头
- 可选 Cambridge Dictionary 官方 API；配置 Access Key 后优先使用授权 XML 接口
- HTML 主界面与轻量悬浮窗，支持 `Alt+V` 和 `Alt+Enter`
- Obsidian 原生折叠 Callout：平时每个词只占一行，点击后查看完整词卡
- 重复词检测、写前完整备份、并发修改检测、原子替换及写后 SHA-256 校验
- API Key 由 Electron `safeStorage` 保存，不会暴露给页面脚本或写入仓库
- 独立悬浮窗关闭后立即退出，不常驻后台

## 安装

从 [Releases](https://github.com/THwo0t/wordloom-obsidian/releases) 下载适合 Linux x64 的安装包。

AppImage：

```bash
chmod +x Wordloom-0.1.0-x86_64.AppImage
./Wordloom-0.1.0-x86_64.AppImage
```

Debian / Ubuntu：

```bash
sudo apt install ./Wordloom-0.1.0-amd64.deb
```

安装 `.deb` 后可使用短命令：

```bash
wordloom  # 主应用
wl        # 快速悬浮窗
wl mitigate
```

也可以从源码运行（需要 Node.js 22+）：

```bash
npm install
npm start
```

源码模式可安装短启动命令：

```bash
npm run install:command
wl
wl mitigate
```

## 首次设置

1. 打开“设置”，选择目标 Obsidian Markdown 笔记。
2. 填写 DeepSeek API Key；默认 Endpoint 为 `https://api.deepseek.com`，模型为 `deepseek-v4-flash`。
3. 测试连接并保存。
4. 可选：填写 Cambridge Dictionary API Access Key。

默认查询路径如下：

```text
有 Cambridge Access Key → Cambridge 官方 API
没有 Cambridge Access Key → DeepSeek 原生 Web Search（仅 Cambridge 域名）
                         → 同次生成 IELTS 学习信息
                         → 本地校验后写入 Obsidian
```

如果精确单词尚未被 Cambridge 收录，Wordloom 会明确提示并拒绝生成未经验证的词义。例如 Cambridge 尚未收录 `anthropic` 单词词条，但会建议已收录的 `anthropic principle`。

## 笔记格式与保护

新增词条位于笔记末尾的 `Wordloom 新增词汇` 区域。默认使用 Obsidian 折叠 Callout：

```markdown
> [!abstract]- **mitigate** `verb` — 使缓和；减轻（危害等）
> 点击后显示音标、来源、释义、例句、搭配与 IELTS 提示。
```

每次修改现有笔记都会：

1. 验证 UTF-8、frontmatter 与 Wordloom 区块边界。
2. 检查 Obsidian 是否在写入期间修改了文件。
3. 在笔记旁的 `.wordloom-backups/` 中保存完整写前备份。
4. 验证原笔记前缀逐字节不变，再执行原子替换。
5. 重新读取文件，核对长度、哈希和区块边界，并写入审计回执。

模型不会接收整篇笔记，也没有直接文件写入权限。

## 快捷键

- `Alt+V`：应用运行时显示快速悬浮窗
- `Alt+Enter`：把当前查询结果加入笔记
- `Esc`：关闭独立悬浮窗并退出进程

应用未运行时，可把系统自定义快捷键绑定到 `wl`。组合键由操作系统监听，因此 Wordloom 无需常驻后台。

## 开发与构建

```bash
npm ci
npm run check
npm test
npm run dist:linux
```

构建产物输出到 `release/`。

```text
src/main.js                 Electron 生命周期、快捷键与 IPC
src/services/cambridge.js   Cambridge 官方 API 与 HTML 解析
src/services/deepseek.js    DeepSeek 原生搜索、结构校验与学习信息
src/services/obsidian.js    折叠模板、备份、去重与原子写入
src/renderer/               主界面与悬浮窗
test/                       服务与笔记保护测试
```

## 数据与授权说明

- API Key 仅发送给用户配置的 AI Endpoint；Cambridge Access Key 仅发送给 Cambridge 官方 API。
- DeepSeek 搜索结果必须包含与查询词精确匹配的 Cambridge 来源 URL，否则拒绝使用。
- Cambridge 内容及商标归其各自权利人所有。本项目不打包或再分发 Cambridge 词典数据。
- 商业化或大规模分发前，请自行确认 Cambridge Dictionary API/数据授权要求。

## License

[MIT](LICENSE)
