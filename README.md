# dsh-skill-center · 技能中心

[![npm](https://img.shields.io/npm/v/@restregular/dsh-skill-center?color=cb3837&logo=npm)](https://www.npmjs.com/package/@restregular/dsh-skill-center)
[![license](https://img.shields.io/npm/l/@restregular/dsh-skill-center?color=blue)](./LICENSE)
[![node](https://img.shields.io/node/v/@restregular/dsh-skill-center)](package.json)
[![dsh plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4a6cf7)](https://github.com/RestRegular/dsh-skill-center)

**English** · [中文](#中文)

A Skill Center panel for **DeepSeek Harness**: browse every skill the current session can see,
read its `SKILL.md`, flip the model/user invocation switches, create and delete skills — without
leaving the app and without hand-editing frontmatter.

> [!NOTE]
> The npm name `dsh-skill-center` is taken by an unrelated project, so this plugin is published as
> **`@restregular/dsh-skill-center`**. The plugin id stays `dsh-skill-center` / `skill-center`.

```
Sidebar                                   Main area
├ New session                            ┌───────────────────────────────────────────────┐
├ Plugins            ← order 0           │ Skill Center      8 skills · session scope  Back│
├ Skill Center       ← order 1 (this)    ├──────────────┬────────────────────────────────┤
├ Workspaces / Sessions                  │ auth0-quick… │ auth0-quickstart               │
└ Settings                               │ discover-…   │ provider / source / root       │
                                         │ office-docx  │ path / size                    │
                                         │ …            │ [model invocable ●] [user ●]   │
                                         │              │ [Read body]  [Delete]          │
                                         └──────────────┴────────────────────────────────┘
```

## Features

| Capability | Detail |
|---|---|
| Browse | Lists every skill visible in the **current session scope**, including skills embedded in plugins, each with provider, source root and invocation policy |
| Search / filter | Search by name or description; filter by provider source |
| Read body | Renders the raw `SKILL.md` Markdown inside the panel (no right-hand resource pane needed) |
| Invocation switches | Toggles `disable-model-invocation` / `user-invocable` by rewriting the frontmatter; the host pushes the refreshed catalog to the model immediately |
| Create | Creates `<name>/SKILL.md` under the user Agents or user DSH skills root |
| Delete | Moves the skill to `.trash/<timestamp>-<name>` in the same root — recoverable, never a hard delete |
| Read-only guard | Skills embedded in plugins (e.g. `office-docx`) are labelled *embedded* and their switches/deletion are disabled |
| Security | Every write is confined to managed skill roots that really exist on disk; requests from non-loopback origins get `403` |

## Requirements

- **DeepSeek Harness** desktop build that provides the `ctx.skills` registry and the loopback web server.
- **Node.js ≥ 22.13.0** for the package metadata/engine field (the plugin itself is plain ESM and has **zero runtime dependencies**).

## Install

### From the plugin marketplace (GUI)

1. Open the **Plugins** entry in the sidebar.
2. Search for `@restregular/dsh-skill-center` and install it.
3. Restart the host (or reload the profile) so the host half mounts.

### Manually

```bash
# inside your DSH profile directory, e.g. ~/.dsh/profiles/desktop
pnpm add @restregular/dsh-skill-center
```

Then add the package to the profile's bundle list and restart:

```jsonc
// <profile>/package.json
{
  "dsh": { "profile": { "bundles": [/* … */ "@restregular/dsh-skill-center"] } },
  "dependencies": { "@restregular/dsh-skill-center": "^0.1.0" }
}
```

The package ships its own `cordis.patch.yml`, so no manual loader edit is required — it inserts the
host plugin (`id: skill-center`) and the client half. The sidebar row appears **below Plugins**,
because the client registers `sidebar.panellist` with `order: 1`.

To uninstall: remove the bundle entry and the dependency, then restart.

## Usage

1. Open a session (or stay on the home screen — see *Known limits*).
2. Click **Skill Center** in the sidebar.
3. Pick a skill on the left; the right pane shows provider, source, path, size and the two invocation switches.
4. Toggle a switch to rewrite the frontmatter, press **Read body** for the Markdown, or **Create** / **Delete** to manage files.

## HTTP API

The host half mounts a **loopback-only** route at `/dsh-skill-center/api`:

| Method | `op` | Parameters | Purpose |
|---|---|---|---|
| GET | `ping` | — | liveness probe |
| GET | `diagnose` | `sessionId?` `cwd?` | is the host mounted, did the client half reach the browser module graph, resolved skill roots |
| GET | `list` | `sessionId?` `cwd?` | skill catalog + read metadata |
| POST | `read` | `name` | raw `SKILL.md` text |
| POST | `setInvocation` | `name` `modelInvocable?` `userInvocable?` | rewrite invocation policy |
| POST | `create` | `name` `description` `body?` `rootId?` | create a skill bundle |
| POST | `delete` | `name` | move to `.trash` |

Requests from anything other than `127.0.0.1` / `::1` are rejected with `403`.

```bash
# list the catalog for a session
curl "http://127.0.0.1:19387/dsh-skill-center/api?op=list&sessionId=<session-id>"

# turn off model invocation for one skill
curl -X POST "http://127.0.0.1:19387/dsh-skill-center/api" \
  -H 'Content-Type: application/json' \
  -d '{"op":"setInvocation","sessionId":"<id>","name":"web-react","modelInvocable":false}'
```

```powershell
# PowerShell equivalent (UTF-8 safe)
$body = '{"op":"setInvocation","sessionId":"<id>","name":"web-react","modelInvocable":false}'
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:19387/dsh-skill-center/api" `
  -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

## Architecture

Two halves, no shared imports:

**Host half** — [`lib/index.js`](lib/index.js)

- Reads the catalog through `ctx.skills`, resolving scope with the same three-tier fallback as the
  official `ctx.remote.skills`: live agent → session-recorded preset scope (`agentPresets.acquireScope`)
  → global registry. The first two tiers decide whether the preset's `skill-filesystem` mount is visible
  (with the global tier only, embedded skills are all you see).
- Writes only touch files that live in a managed skill root **and** exist on disk:
  `<projectRoot>/.dsh/skills`, `<projectRoot>/.agents/skills`, `$DSH_HOME/skills`, `$DSH_AGENTS_HOME/skills`.
- Frontmatter edits are string-level: only the invocation keys are touched, everything else is preserved
  byte for byte, including line-ending style.
- Delete is a `rename` into `.trash`.

**Browser half** — [`client/client.js`](client/client.js)

Registers two slots and requires no Harness client package:

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: 'skill-center', order: 1,   // 1 → right below plugins (order 0)
  label: () => t('panel'), locale: NS,
}, SkillCenterIcon));

ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main', key: 'skill-center', locale: NS,             // `main` is keyed: use `key`
}, Page));
```

Styles use host theme tokens only (`--dsw-alias-*`, `--dsw-radius-*`, `--dsw-focus-ring-*`), and the
`<style>` tag carries `data-plugin="dsh-skill-center"` so the host's ownerless-style sweep does not
reclaim it.

## Development

```bash
git clone https://github.com/RestRegular/dsh-skill-center.git
cd dsh-skill-center
```

| Change | Takes effect |
|---|---|
| `client/client.js` | after a **page reload** — the host's `/plugins/<id>/client.js` route re-reads from disk and bumps the rev URL when ctime/size change |
| `lib/index.js` (host) | after a **host restart**. Source-level HMR must be configured *before launch*: add `config: { root: ['.', '<abs path to this repo>'] }` to the profile's `hmr` entry — changing it while running has no effect |
| `package.json` `dsh.*` | after a **host restart** |

For local development the repo can be mounted as a junction instead of being installed:

```powershell
# profile is  <DSH_HOME>\profiles\desktop
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-skill-center" `
  -Target "D:\path\to\dsh-skill-center"
```

Self-checks (both run against the local host route with a mini React shim):

```powershell
$env:ELECTRON_RUN_AS_NODE = 1
$exe  = "C:\path\to\DeepSeek Harness.exe"
$here = "D:\path\to\dsh-skill-center"
$env:DSH_SMOKE_SESSION = "<session-id>"; & $exe "$here\client-smoke.mjs"   # client half + real loopback route
& $exe "$here\verify-compose.mjs"                                          # client half accepted by the module graph
```

> Renaming or relocating the package: the client module table caches package metadata by
> `(loader baseUrl, loader line name)` — no file timestamps — so a running host keeps the old path.
> The browser side uses the in-memory snapshot taken at activation and keeps working after a reload;
> the new path is only resolved after a host restart.

## Known limits

- While the panel occupies the main area, the right-hand `dsh-resource://` preview is unavailable
  (the host throws when `sidebarRight.openResource` is called without a session surface), so body
  preview goes through this plugin's own route and renders raw Markdown in-panel.
- Only **filesystem-backed** skills can be managed; skills embedded in plugins are read-only.
- With no session selected the panel degrades to "read by working directory" and can only see
  embedded skills plus that cwd's project skills; the footer shows the effective cwd and scope tier.
- Catalog replacement is all-or-nothing: one switch change makes the host resend the whole skill
  catalog message (a Harness design choice, not this plugin's).

## License

[MIT](./LICENSE)

---

## 中文

**DeepSeek Harness 的技能管理面板**：在首页侧栏「新会话」下方的「插件」入口下面加一行「技能中心」，
点开后中央区域显示面板，用来查看和改写当前会话能看到的技能。

> [!NOTE]
> npm 上的 `dsh-skill-center` 已被另一个无关项目占用，所以本插件发布为
> **`@restregular/dsh-skill-center`**；插件 id 仍是 `dsh-skill-center` / `skill-center`。

### 功能

| 能力 | 说明 |
|---|---|
| 浏览 | 列出**当前会话作用域**下模型/用户能看到的所有技能（含插件内嵌技能），带提供方、来源根、调用策略 |
| 搜索 / 筛选 | 按名称或描述搜索；按来源（provider source）筛选 |
| 查看正文 | 面板内直接读 `SKILL.md` 原文（Markdown 原文，不经过右栏） |
| 调用开关 | 切换 `disable-model-invocation` / `user-invocable`，直接改写 frontmatter；监听器会立刻把新目录推给模型 |
| 新建 | 在「用户 Agents 技能」或「用户 DSH 技能」根下创建 `<name>/SKILL.md` |
| 删除 | 移动到同根目录的 `.trash/<时间戳>-<名字>`（可手工恢复，不硬删） |
| 只读保护 | 插件内嵌技能（如 `office-docx`、`diagnose-windows-sandbox-acl`）标注「内嵌」，开关与删除按钮禁用 |
| 安全 | 写操作只落在**真实存在于磁盘**的受管技能根内；非回环来源一律 `403` |

### 安装

**市场安装**：侧栏「插件」→ 搜索 `@restregular/dsh-skill-center` → 安装 → 重启宿主。

**手工安装**（在 profile 目录里，例如 `~/.dsh/profiles/desktop`）：

```bash
pnpm add @restregular/dsh-skill-center
```

然后把包加进 profile 的 bundle 清单并重启：

```jsonc
// <profile>/package.json
{
  "dsh": { "profile": { "bundles": [/* … */ "@restregular/dsh-skill-center"] } },
  "dependencies": { "@restregular/dsh-skill-center": "^0.1.0" }
}
```

包自带 `cordis.patch.yml`，**不需要**手改 loader：它会插入宿主半边（`id: skill-center`）与浏览器半边。
侧栏那一行排在「插件」下方，因为客户端以 `order: 1` 注册 `sidebar.panellist`。

卸载：删掉上面两处清单项，重启即可。

### 它怎么接进 Harness

**宿主半边**（`lib/index.js`）挂载一条**仅回环**的 HTTP 路由 `/dsh-skill-center/api`：

- 用 `ctx.skills` 读目录，作用域解析与官方 `ctx.remote.skills` 同源三级兜底：
  活 Agent → 会话记录的预设作用域（`agentPresets.acquireScope`）→ 全局层。
  前两级决定预设内挂载的 `skill-filesystem` 是否可见（只有全局层时只能看到内嵌技能）。
- 写操作只针对**落在受管技能根里、真实存在于磁盘**的文件：
  `<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、`$DSH_HOME/skills`、`$DSH_AGENTS_HOME/skills`。
- frontmatter 改写是字符串级编辑，只动与调用策略相关的键，其余逐字保留（含行尾风格）。
- 删除只 rename 进 `.trash`。

**浏览器半边**（`client/client.js`）注册两处槽位，不 require 任何 Harness Client 包：

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: 'skill-center', order: 1,   // 1 → 排在 plugins(order 0)后面
  label: () => t('panel'), locale: NS,
}, SkillCenterIcon));

ctx.slots.inject('main', () => ctx.slots.register({
  name: 'main', key: 'skill-center', locale: NS,             // main 是 keyed 槽,用 key
}, Page));
```

样式只用宿主主题令牌 `--dsw-alias-*` / `--dsw-radius-*` / `--dsw-focus-ring-*`，
`<style>` 带 `data-plugin="dsh-skill-center"`（避免被宿主的无主样式回收误删）。

### API 示例

```powershell
# 列目录(带会话作用域)
Invoke-RestMethod "http://127.0.0.1:19387/dsh-skill-center/api?op=list&sessionId=<session-id>"

# 关掉某技能的模型调用
$body = '{"op":"setInvocation","sessionId":"<id>","name":"web-react","modelInvocable":false}'
Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:19387/dsh-skill-center/api" `
  -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

非回环来源一律 403。

### 开发

| 改动 | 生效方式 |
|---|---|
| `client/client.js` | **刷新页面**即可（宿主的 `/plugins/<id>/client.js` 路由每次请求都读盘，文件 ctime/size 变化会合成新的 rev URL） |
| `lib/index.js`（宿主） | 需要**重启宿主**。模块源码热替换必须在**启动前**配置：profile patch 里给 `hmr` 行加 `config: { root: ['.', '<本仓库绝对路径>'] }`；运行中改这项无效（见 `@deepseek-ai/dsh-hmr` README「before launching」） |
| `package.json` 的 `dsh.*` | 同样需要重启 |

自检脚本：

```powershell
$env:ELECTRON_RUN_AS_NODE = 1
$exe = "C:\path\to\DeepSeek Harness.exe"; $here = "D:\path\to\dsh-skill-center"
# 客户端半侧:迷你 React 装载真实 bundle,并真的打本机宿主路由
$env:DSH_SMOKE_SESSION = "<session-id>"; & $exe "$here\client-smoke.mjs"
# 客户端半侧是否会被浏览器模块图接受(复现 dsh-client-modules 的合成校验)
& $exe "$here\verify-compose.mjs"
```

> 搬迁/改名注意：客户端模块表按 `(loader baseUrl, loader 行名)` 缓存包元信息，不含文件时间戳。
> 把包挪到别处后，运行中的宿主仍握着旧路径；浏览器端用的是激活时读进内存的快照，
> 所以刷新页面照常可用，**下次重启宿主**才会解析新路径。

### 已知边界

- 面板占中央区域时，右栏的 `dsh-resource://` 预览不可用（宿主规定：无会话面时 `sidebarRight.openResource` 抛错）。
  因此正文预览走本插件自己的路由，在面板内渲染原文。
- 只能管理**文件系统来源**的技能；插件内嵌技能只读。
- 没有选中会话时退化为「按工作目录读取」，此时只能看到内嵌技能 + 该 cwd 的项目技能；
  面板底栏会显示实际使用的 cwd 与作用域级别。
- 目录整体替换制：一次开关改动会让模型的技能目录消息整条重发（这是 Harness 自身的设计）。

### 许可

[MIT](./LICENSE)
