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
| Invocation switches | Flips `disable-model-invocation` / `user-invocable` locally — the switch moves at once, with no round trip — and writes them into the frontmatter when you press **Save** beside *Back to session* (the button reads 未修改 → 保存 → 已保存); the host pushes the refreshed catalog to the model immediately |
| Create | Creates `<name>/SKILL.md` under the user Agents or user DSH skills root |
| Delete | Moves the skill to `.trash/<timestamp>-<name>` in the same root — recoverable, never a hard delete; the confirmation puts **取消 / Cancel** to the left of **确认删除? / Confirm delete?** |
| Trash | The **Trash** button in the toolbar lists every `.trash` entry across the managed roots, with its root and deletion time. **Restore** renames one back into its original root (refusing to overwrite a skill that already exists there); **Delete** in the detail pane removes the selected entry permanently (after **确认删除?**, Cancel on its left). **Empty trash** sits in the top toolbar and clears every entry, also behind a **确认清空?** step that pairs a **取消 / Cancel** on its left |
| No success toasts | The panel shows no "saved / created / deleted / restored" notice: the state change itself is the feedback (the save button's three states, a row appearing in or leaving the list, a trash entry leaving the trash). Only failures render, as a red bar with a retry button |
| Read-only guard | Skills embedded in plugins (e.g. `office-docx`) are labelled *embedded* and their switches/deletion are disabled |
| Bundled skill | Ships an embedded **`skill-authoring`** skill (guidance + `references/` + a starter template) that teaches the agent which root a skill belongs in, what the frontmatter contract is, and where a skill's resource files go |
| Model tool | Registers **`skill_create`**, which writes `<root>/<name>/SKILL.md` plus any resource files in one call — the path that works for skill roots outside the session workspace, where the file-write tools are sandboxed |
| Security | Every write is confined to managed skill roots that really exist on disk; requests from non-loopback origins get `403` |

## Bundled skill and model tool

Beyond the panel, the host half publishes its own guidance for agents and one tool that acts on it.

### `skill-authoring` (embedded skill)

The package ships `skills/skill-authoring/` and registers it with `ctx.skills.registerProvider()`,
so it appears in the session catalog exactly like the built-in skills — the model can load it with
the `skill` tool, and the panel lists it as *embedded* (read-only, because the file belongs to the
package, not to a managed root).

```
skills/skill-authoring/
  SKILL.md                        routing + the five-step short path
  references/roots.md             the root table, ranks, precedence, project-root detection
  references/frontmatter.md       every field, the boolean spellings, why a skill silently does not load
  references/resources.md         where resource files go and how the model is told to find them
  references/plugin-bundled.md    shipping skill content inside a plugin package
  templates/minimal/SKILL.md      starter bundle
```

Because the candidate carries `resourceBase: { kind: 'directory', path }`, the loaded skill arrives
with `Base directory for this skill: <abs path>` in its `<skill_resources>` block, so the agent can
read `references/*.md` with ordinary file tools. Rank 600 means any project or user skill named
`skill-authoring` shadows this one — override it by writing your own.

### `skill_create` (model tool)

```
skill_create({ name, description, whenToUse?, body?, root?, resources?, modelInvocable?, userInvocable?, overwrite? })
```

| Argument | Meaning |
|---|---|
| `name` | kebab-case skill name; also the bundle directory name |
| `description` | frontmatter description — the only routing signal the catalog shows |
| `whenToUse` | optional `whenToUse` frontmatter field |
| `body` | the Markdown after the frontmatter; defaults to a `# <name>` heading |
| `root` | `project-dsh` \| `project-agents` \| `user-dsh` \| `user-agents`; defaults to `user-agents` |
| `resources` | `[{ path, content }]` written inside the same bundle directory (e.g. `references/roots.md`) |
| `modelInvocable` / `userInvocable` | `false` writes `disable-model-invocation: true` / `user-invocable: false` |
| `overwrite` | required to replace an existing skill; the default fails instead of clobbering |

It exists because of a real obstacle: the file-write tools are sandboxed to the session workspace,
while `$DSH_HOME/skills` and `$DSH_AGENTS_HOME/skills` are not in it, so an agent asked to "make me
a skill" could only fail there. The tool writes with the same confinement as the panel — only the
four managed roots, only inside `<root>/<name>/` — and rejects absolute resource paths, `..`
segments, a resource that would overwrite `SKILL.md`, and a name that collides with an embedded
skill. It registers through `ctx.inject(['tools'], …)`, so a composition without `ctx.tools` simply
loses the tool instead of failing to mount.

> [!NOTE]
> The tool is registered globally, so **every agent on the host sees `skill_create`** (one extra
> tool schema in the prompt). Removing the plugin removes it; there is no switch.

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
  "dependencies": { "@restregular/dsh-skill-center": "^0.3.4" }
}
```

The package ships its own `cordis.patch.yml`, so no manual loader edit is required — it inserts the
host plugin (`id: skill-center`) and the client half. The sidebar row appears **below Plugins**,
because the client registers `sidebar.panellist` with `order: 1`.

> [!IMPORTANT]
> The loader row's `name` **must equal the package name verbatim**
> (`@restregular/dsh-skill-center`). `@deepseek-ai/dsh-client-modules` locates a row's
> `package.json` by that name and compares it strictly (`nearestPackage`). With a bare
> `dsh-skill-center` the host half still mounts, but the client half is dropped **silently**:
> no sidebar row, `op=diagnose` reports `client.inGraph: false` with no `client.url`, and nothing is
> logged. 0.2.1 fixed exactly this; 0.2.0 shipped the bare name.

> [!IMPORTANT]
> The client bundle must also call `__ModuleLoader__.load({ id: '@restregular/dsh-skill-center' })` —
> **the package name, not the plugin id**. The browser module graph numbers rows by package name, and
> `ClientModuleSystem.invalidate(id, rev)` (what the HMR `rebuilt` frame and `entries.reload` use)
> deletes factory entries **by row id only**. A registration id that differs from the row id leaves
> the stale factory in place, so the next bundle revision throws
> `client-modules: duplicate factory registration … (bundle executed twice without invalidate?)`
> and the whole web boot reports `1 entry did not activate`. 0.2.2 fixed this; 0.2.0/0.2.1 used the
> bare plugin id. The bundle additionally skips registration when that id is already present, so a
> double execution can no longer take the boot down.

To uninstall: remove the bundle entry and the dependency, then restart.

> [!WARNING]
> Do not leave a bare-name junction/link for this package in the profile's `node_modules`
> (e.g. `node_modules\dsh-skill-center` → the repo). Both the link and the scoped package register
> the same plugin, which is exactly the two-sources situation behind the duplicate-registration
> crash. Install the scoped package and nothing else.

## Troubleshooting

Nothing appears in the sidebar after install + restart? Check in this order:

1. **Is the host half alive?** `http://127.0.0.1:19387/dsh-skill-center/api?op=ping` should answer
   `{"ok":true,…}`. A `404` means the loader row never mounted — the package is not in the profile's
   `dsh.profile.bundles`, or is not installed under the profile's `node_modules`.
2. **Did the client half reach the browser module graph?**
   `http://127.0.0.1:19387/dsh-skill-center/api?op=diagnose` — `client.inGraph` must be `true`.
   `false` while `host.mounted` is `true` is the loader-row-name / package-name mismatch above.
3. **Is the bundle served?** The browser is only ever handed a **revisioned** URL
   (`/plugins/@restregular/dsh-skill-center/client.js?rev=<12 hex>`), and the route deliberately rejects a
   mismatched revision, so requesting the bare path answers `404` even on a healthy install. Read
   `client.url` from `op=diagnose` (it now reports the row it matched in `client.entryId`) and fetch that
   URL instead.
4. **Re-run the offline composition check** (no host restart needed):
   `node verify-compose.mjs <profileDir>` — it now fails loudly on a loader row name that cannot be
   resolved back to the package.
5. `pnpm add` inside the profile is what makes the package resolvable; installing it elsewhere
   (a global `npm i -g`, an unrelated directory) installs nothing the profile can compose.

## Usage

1. Open a session (or stay on the home screen — see *Known limits*).
2. Click **Skill Center** in the sidebar.
3. Pick a skill on the left; the right pane shows provider, source, path, size and the two invocation switches.
4. Flip switches as you like: they move immediately and stay staged in the panel. The button to the left of
   *Back to session* tracks the state — **未修改** (greyed, nothing staged) → **保存** (active, changes staged;
   a count appears when several skills are staged) → **已保存** (greyed, written). Editing anything again puts
   it back to 保存. Press **Read body** for the Markdown, **Create** for a new skill, or **Delete** — whose
   confirmation pairs **取消** with **确认删除?**, cancel sitting on the left. Successful actions print no
   notice; only failures show a red bar with a retry button.

## HTTP API

The host half mounts a **loopback-only** route at `/dsh-skill-center/api`:

| Method | `op` | Parameters | Purpose |
|---|---|---|---|
| GET | `ping` | — | liveness probe |
| GET | `diagnose` | `sessionId?` `cwd?` | is the host mounted, did the client half reach the browser module graph, resolved skill roots |
| GET | `list` | `sessionId?` `cwd?` | skill catalog + read metadata |
| POST | `read` | `name` | raw `SKILL.md` text |
| POST | `setInvocation` | `name` `modelInvocable?` `userInvocable?` | rewrite invocation policy |
| POST | `create` | `name` `description` `body?` `rootId?` `whenToUse?` `resources?` `overwrite?` `modelInvocable?` `userInvocable?` | create (or, with `overwrite`, replace) a skill bundle and its resource files; shares one implementation with `skill_create` |
| POST | `delete` | `name` | move to `.trash` |
| GET | `trash` | `sessionId?` `cwd?` | list `.trash` entries across the managed roots (newest first) |
| POST | `restore` | `rootId` `entry` | rename one `.trash` entry back into its original root; fails instead of overwriting |
| POST | `deleteTrash` | `rootId` `entry` | permanently delete one `.trash` entry |
| POST | `emptyTrash` | `sessionId?` `cwd?` `rootId?` | permanently delete trash entries (all managed roots unless `rootId` is given) |

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
- For skills inside a managed root, `list` takes the invocation policy **from the file on disk** instead of
  the registry snapshot. The skill catalog is cached and the filesystem watcher invalidates it a moment
  after a write, so a panel that trusted the snapshot would show its own stale value right after a save —
  which is exactly what made a flipped switch snap back until a manual refresh.
- Delete is a `rename` into `.trash`; `trash` lists those entries, `restore` renames one back (never
  overwriting an existing skill), `deleteTrash` removes one for good, and `emptyTrash` clears them all.
  Trash operations resolve only the working directory — they do not need the skill registry, so they
  keep working when the catalog read fails.
- Also registers an embedded skill provider (`ctx.skills.registerProvider`) for `skills/skill-authoring/`
  and the `skill_create` tool (`ctx.inject(['tools'], …)` + `ctx.tools.register`). The tool schema is a
  hand-written JSON Schema using only the subset `@deepseek-ai/dsh-tools` accepts, so the package keeps
  zero runtime dependencies and needs no host-side module resolution.
- The three parts degrade independently: a missing `tools` or `webServer` service, or a bundled-skill
  asset that fails to parse, only logs a warning and leaves the rest mounted.

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

Switch edits are staged in component state: the switch reads a local override first and the catalog
second, and the Save button's three states are derived from the staged set (`pendingEdits`) plus a
"saved once" flag. After a save the overrides are kept until a fresh catalog actually agrees with them
(`load()` drops the ones that match), so a lagging host snapshot can never bounce the UI back.

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

Self-checks (the first two run against the local host route with a mini React shim; the third is
fully offline):

```powershell
$env:ELECTRON_RUN_AS_NODE = 1
$exe  = "C:\path\to\DeepSeek Harness.exe"
$here = "D:\path\to\dsh-skill-center"
$env:DSH_SMOKE_SESSION = "<session-id>"; & $exe "$here\client-smoke.mjs"   # client half + real loopback route
& $exe "$here\verify-compose.mjs"                                          # client half accepted by the module graph
node "$here\verify-skill.mjs"                                              # bundled skill + skill_create, offline
```

`verify-compose.mjs` must run through the Electron binary: it reads the shipped `@deepseek-ai`
packages out of `app.asar`, which plain `node` cannot open. `verify-skill.mjs` is the opposite — it
imports `lib/index.js` with a stub context and needs no host at all. It checks the bundled skill's
contract (directory name vs frontmatter, non-empty description, `resourceBase` directory, every
`references/`-style path cited in a table or link actually existing), the tool's JSON Schema against
the subset `@deepseek-ai/dsh-tools` accepts, and then **really runs** `skill_create` inside a temp
dir: create, resource placement, overwrite, duplicate names, illegal names, path traversal, flat
files, explicit project roots, and the three degraded mount paths. It also asserts that a managed-root
skill's invocation policy comes from the file on disk even when the registry snapshot disagrees, and
walks the trash round trip through the loopback route: `delete` → `trash` lists the entry with its
root, `restore` puts a directory bundle and a flat `.md` back, a path-traversal `entry` and an
existing target are both refused, `deleteTrash` removes exactly one entry (and reports a missing one),
and `emptyTrash` clears the rest.

`client-smoke.mjs` renders the real panel against the live loopback route through a mini React shim,
and then drives the staged-save flow: the switch flips with no write request, Save issues exactly one
`setInvocation` carrying both flags, the button steps 未修改 → 保存 → 已保存 (and back to 保存 on the
next edit), and a lagging catalog snapshot cannot bounce the switch back. It then walks the delete
confirmation — 取消 sits to the left of 确认删除?, cancelling returns to 删除 and sends no request. The
trash flow is stubbed (GET `trash` answers from a fake entry list; `restore` / `deleteTrash` /
`emptyTrash` only change it): opening the trash lists the entry, **Restore** sends one `restore` with
`rootId` + `entry` and leaves the trash empty, leaving and re-entering the trash reloads it, the
detail's **Delete** needs a 确认删除? with 取消 on its left (cancelling sends nothing, confirming sends
one `deleteTrash`), and the toolbar's **Empty trash** needs 确认清空? the same way (one `emptyTrash`
only after confirming). It intercepts POSTs (and throws on `create` / `delete`), so the run never
rewrites a real `SKILL.md`.

> Renaming or relocating the package: the client module table caches package metadata by
> `(loader baseUrl, loader line name)` — no file timestamps — so a running host keeps the old path.
> The browser side uses the in-memory snapshot taken at activation and keeps working after a reload;
> the new path is only resolved after a host restart.

### Releasing

Bump `version`, commit, push, then `npm publish` from the repo root with a token that has publish
rights for the scope. The registry answers a successful publish with `202 {"success":true}` and then
holds the version in a **validating** state: until validation passes, both
`/@restregular/dsh-skill-center/<version>` and the tarball URL answer `404`, and `dist-tags` still
points at the previous release. That is the normal window, not a failure. Re-probe the version URL
with a cache-busting query (`?t=<ticks>`) rather than publishing again: a second attempt for the same
version fails with `E409 Cannot publish over previously staged version <version>` (and
`npm stage publish` with `E409 Cannot stage previously published version <version>`), while
`npm stage list` may show nothing at all.

## Known limits

- While the panel occupies the main area, the right-hand `dsh-resource://` preview is unavailable
  (the host throws when `sidebarRight.openResource` is called without a session surface), so body
  preview goes through this plugin's own route and renders raw Markdown in-panel.
- Only **filesystem-backed** skills can be managed; skills embedded in plugins are read-only.
- With no session selected the panel degrades to "read by working directory" and can only see
  embedded skills plus that cwd's project skills; the footer shows the effective cwd and scope tier.
- Catalog replacement is all-or-nothing: one switch change makes the host resend the whole skill
  catalog message (a Harness design choice, not this plugin's).
- `skill_create` is registered host-wide, so every agent sees one more tool schema; it has no
  per-agent switch, and only uninstalling the plugin removes it.
- The bundled `skill-authoring` skill is embedded and therefore read-only in the panel. Because it
  sits at rank 600, a project or user skill with the same name replaces it entirely — that is the
  intended way to customize it.

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
| 调用开关 | 开关先改本地状态（**点了立刻切换**，不发请求），再按「返回会话」左边的 **保存** 按钮写回 frontmatter（按钮三态：未修改 → 保存 → 已保存，多个技能待保存时显示「保存 (n)」）；写盘后监听器立刻把新目录推给模型 |
| 新建 | 在「用户 Agents 技能」或「用户 DSH 技能」根下创建 `<name>/SKILL.md` |
| 删除 | 移动到同根目录的 `.trash/<时间戳>-<名字>`（不硬删）；确认时「取消」排在「确认删除?」**左边** |
| 回收站 | 工具栏「回收站」列出所有受管根下的 `.trash` 条目（带原技能根与删除时间）；**恢复**把条目移回原技能根（目标已存在时拒绝覆盖），详情区 **删除** 在「取消」+「确认删除?」后永久删除这一条，顶部工具栏 **清空回收站** 在「取消」+「确认清空?」后永久删除全部条目 |
| 无成功提示 | 面板不再弹「已保存 / 已创建 / 已移动到 .trash / 已恢复」这类提示：状态变化本身就是反馈（保存按钮三态、列表增删一行、回收站条目消失）。只有失败才渲染成红色条 + 重试按钮 |
| 只读保护 | 插件内嵌技能（如 `office-docx`、`diagnose-windows-sandbox-acl`）标注「内嵌」，开关与删除按钮禁用 |
| 随包技能 | 附带一个内嵌的 **`skill-authoring`** 指导技能（正文 + `references/` + 起步模板）：技能该放哪个根、frontmatter 契约是什么、资源文件放哪、怎么把技能打进插件包 |
| 模型工具 | 注册 **`skill_create`**：一次调用写出 `<root>/<name>/SKILL.md` 与全部资源文件 —— 技能根在工作区之外时（文件写入工具被沙箱挡住）这是唯一走得通的路径 |
| 安全 | 写操作只落在**真实存在于磁盘**的受管技能根内；非回环来源一律 `403` |

### 随包技能与模型工具

除了面板，宿主半边还会给 Agent 发一份指导技能和一个真正能动手的工具。

**`skill-authoring`（内嵌技能）**：包内 `skills/skill-authoring/` 通过
`ctx.skills.registerProvider()` 注册，和第一方内嵌技能一样出现在会话技能目录里 ——
模型可以用 `skill` 工具加载它，面板把它标成「内嵌」（只读，因为它属于包，不属于受管根）。

```
skills/skill-authoring/
  SKILL.md                        路由 + 五步短路径
  references/roots.md             根表、rank、优先级、项目根判定
  references/frontmatter.md       每个字段、布尔写法、为什么技能会静默不加载
  references/resources.md         资源文件放哪、模型怎么被告知去找
  references/plugin-bundled.md    把技能打进插件包的两种注册方式
  templates/minimal/SKILL.md      起步模板
```

候选带上 `resourceBase: { kind: 'directory', path }` 之后，加载出来的
`<skill_resources>` 里会写明 `Base directory for this skill: <绝对路径>`，
Agent 因此能用普通文件工具去读 `references/*.md`。rank 600 意味着任何项目级/用户级同名技能都能盖过它 ——
想改写它就自己建一个同名技能。

**`skill_create`（模型工具）**：

| 参数 | 含义 |
|---|---|
| `name` | kebab-case 技能名，同时是目录名 |
| `description` | frontmatter 的 description：目录里唯一的路由信号 |
| `whenToUse` | 可选，写进 frontmatter |
| `body` | frontmatter 之后的 Markdown 正文；省略则写一个 `# <name>` 标题 |
| `root` | `project-dsh` / `project-agents` / `user-dsh` / `user-agents`，默认 `user-agents` |
| `resources` | `[{ path, content }]`，写进同一个技能目录（如 `references/roots.md`） |
| `modelInvocable` / `userInvocable` | 传 `false` 分别写 `disable-model-invocation: true` / `user-invocable: false` |
| `overwrite` | 覆盖已存在的技能必须显式传，默认宁可失败也不覆盖 |

它存在的理由很具体：文件写入工具被沙箱限制在会话工作区内，而 `$DSH_HOME/skills`、
`$DSH_AGENTS_HOME/skills` 不在工作区里 —— 用户说「给我做个技能」时，Agent 在那里根本写不进去。
这个工具用的是和面板同一套落盘实现：只写四个受管根、只写 `<root>/<name>/` 之内，
并拒绝绝对资源路径、`..` 段、会覆盖 `SKILL.md` 的资源，以及与内嵌技能重名。
它通过 `ctx.inject(['tools'], …)` 注册，所以没有 `ctx.tools` 的组合只是少这个工具，不会挂不上。

> [!NOTE]
> 工具是**宿主级全局注册**：同一宿主上每个 Agent 都会多看到 `skill_create`（多一份工具 schema）。
> 没有开关，卸载插件才会消失。


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
  "dependencies": { "@restregular/dsh-skill-center": "^0.3.4" }
}
```

包自带 `cordis.patch.yml`，**不需要**手改 loader：它会插入宿主半边（`id: skill-center`）与浏览器半边。
侧栏那一行排在「插件」下方，因为客户端以 `order: 1` 注册 `sidebar.panellist`。

> [!IMPORTANT]
> patch 里那条 loader 行的 `name` **必须逐字等于包名**（`@restregular/dsh-skill-center`）。
> 宿主 `@deepseek-ai/dsh-client-modules` 是按这个行名去定位该行的 `package.json` 并**严格比对**
> `name` 的（`nearestPackage`）。写成裸名 `dsh-skill-center` 时：宿主半边照样挂得上，
> 但浏览器半边会被**静默丢弃** —— 侧栏没有「技能中心」、`op=diagnose` 里 `client.inGraph` 是 `false`
> 且没有 `client.url`，而且日志里一个字都没有。0.2.1 修的就是这个；0.2.0 发出去的是裸名。

> [!IMPORTANT]
> 客户端 bundle 还必须用**包名**注册：`__ModuleLoader__.load({ id: '@restregular/dsh-skill-center' })`，
> 不能用插件 id `dsh-skill-center`。浏览器模块图是按包名给行编号的，而
> `ClientModuleSystem.invalidate(id, rev)`（HMR 的 `rebuilt` 帧 → `entries.reload` 走的正是它）
> **只按行 id** 删工厂表里的条目：注册 id 与行 id 不一致 → 旧工厂删不掉 → 下一版 bundle 一执行就
> `client-modules: duplicate factory registration … (bundle executed twice without invalidate?)`，
> 整条 web boot 变成「1 entry did not activate」并弹「应用无法启动或已意外停止」。
> 0.2.2 修的就是这个。bundle 另外加了一道幂等保护：该 id 已在工厂表里就跳过注册，
> 重复执行最多是空转，不会再打挂启动。

卸载：删掉上面两处清单项，重启即可。

> [!WARNING]
> 不要在 profile 的 `node_modules` 里给这个包留裸名链接/junction
> （例如 `node_modules\dsh-skill-center` → 本仓库）。链接和真正的 scoped 包会各自注册同一个插件，
> 正好构成「同一插件两个来源」——也就是上面那个 duplicate registration 崩溃的现场。
> 只装 scoped 包，别的都清掉。

### 装完侧栏没出现？按顺序查这五步

1. **宿主半边活着吗**：`http://127.0.0.1:19387/dsh-skill-center/api?op=ping` 应回 `{"ok":true,…}`。
   回 `404` 说明 loader 行压根没挂上 —— 包不在 profile 的 `dsh.profile.bundles` 里，或者没装进
   profile 的 `node_modules`。
2. **浏览器半边进模块图了吗**：`…/api?op=diagnose` 里的 `client.inGraph` 必须是 `true`。
   若 `host.mounted` 为 `true` 而它是 `false`，就是上面那个「行名 ≠ 包名」。
3. **bundle 有没有被服务**：浏览器只会拿到**带版本号**的地址
   （`/plugins/@restregular/dsh-skill-center/client.js?rev=<12 位十六进制>`），而路由**故意拒绝**
   版本不匹配的请求 —— 所以即使一切正常，直接要裸路径也会回 `404`。请从 `op=diagnose` 的
   `client.url` 取地址（现在它还会在 `client.entryId` 里告诉你命中哪一行），再取那个地址。
4. **跑离线合成自检**（不用重启宿主）：`node verify-compose.mjs <profileDir>`，
   现在它会因为「行名解析不回本包」直接 FAIL。
5. `pnpm add` 必须**在 profile 目录里**执行；装到别处（全局 `npm i -g`、别的目录）profile 合成不到。

### 它怎么接进 Harness

**宿主半边**（`lib/index.js`）挂载一条**仅回环**的 HTTP 路由 `/dsh-skill-center/api`：

- 用 `ctx.skills` 读目录，作用域解析与官方 `ctx.remote.skills` 同源三级兜底：
  活 Agent → 会话记录的预设作用域（`agentPresets.acquireScope`）→ 全局层。
  前两级决定预设内挂载的 `skill-filesystem` 是否可见（只有全局层时只能看到内嵌技能）。
- 写操作只针对**落在受管技能根里、真实存在于磁盘**的文件：
  `<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、`$DSH_HOME/skills`、`$DSH_AGENTS_HOME/skills`。
- frontmatter 改写是字符串级编辑，只动与调用策略相关的键，其余逐字保留（含行尾风格）。
- 受管根内的技能，`list` 的调用策略**以磁盘上的文件为准**，不照抄注册表快照：技能目录是缓存的，
  而 watcher 的失效事件总在写盘之后一小会儿才到 —— 只信快照的面板会在刚保存完的瞬间把界面弹回
  旧值，这正是「拨完开关又自己跳回去、手动刷新才变」的根因。
- 删除只 rename 进 `.trash`;回收站各操作独立:`trash` 列出条目、`restore` 把条目 rename 回原根
  (目标已存在就失败,绝不覆盖)、`deleteTrash` 永久删除单条、`emptyTrash` 清空。回收站操作只解析
  工作目录、不读技能注册表,所以目录读取失败时它照样能用。
- 另注册一个内嵌技能提供方（`ctx.skills.registerProvider`，指向包内 `skills/skill-authoring/`）
  和 `skill_create` 工具（`ctx.inject(['tools'], …)` + `ctx.tools.register`）。
  工具 schema 是手写的原始 JSON Schema，只使用 `@deepseek-ai/dsh-tools` 接受的子集 ——
  本包因此保持零运行时依赖，也不需要宿主侧的模块解析。
- 三块各自独立降级：缺 `tools` / `webServer`，或者随包技能的资产解析失败，
  都只写一行日志，其余部分照常挂载。

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

开关的改动先落在组件状态里：开关的值取「本地覆盖 → 目录快照」的先后顺序，
保存按钮的三态由「待保存集合 + 是否保存过」推出。保存之后本地覆盖会继续留着，
直到某次 `list` 的快照真的与它一致（`load()` 只撤销已经追平的那些）——
所以宿主的目录快照慢半拍也不会把界面弹回去。

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

`create` 与模型工具 `skill_create` 共用一份实现：除 `name` / `description` / `body` / `rootId` 外，
还接受 `whenToUse`、`resources: [{ path, content }]`、`overwrite`、`modelInvocable`、`userInvocable`。

回收站操作：`GET ?op=trash`（列全部条目）、`POST {"op":"restore","rootId":"user-agents","entry":"<条目名>"}`
（条目名就是 `.trash` 下的直接子项名，形如 `1792173890269-daylog`）、
`POST {"op":"deleteTrash","rootId":"user-agents","entry":"<条目名>"}`（永久删这一条）、
`POST {"op":"emptyTrash"}`（不传 `rootId` 清空全部受管根，传了只清那一个）。

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
# 随包技能 + skill_create:纯离线,不碰宿主也不碰真实用户技能根
node "$here\verify-skill.mjs"
```

`verify-compose.mjs` 必须用 Electron 可执行文件跑:它要读 app.asar 里随发行版交付的
`@deepseek-ai` 包,普通 `node` 打不开 asar。`verify-skill.mjs` 正好相反 ——
它用桩 ctx 直接 import `lib/index.js`,完全不需要宿主:检查随包技能契约
（目录名 vs frontmatter、description 非空、`resourceBase` 目录真实存在、正文表格/链接里点到的
`references/` 等路径是否真的存在）、检查工具 schema 是否落在 `@deepseek-ai/dsh-tools` 支持的子集内,
然后**真的跑一遍** `skill_create`:新建、资源落盘、覆盖、重名、非法名、路径穿越、平坦文件、
显式项目根,以及三条降级路径;另外还断言：受管根技能的调用策略取自磁盘文件,即使注册表快照
给的是旧值;最后把回收站整条链路真跑一遍：`delete` 之后 `trash` 能列出条目（带原根）,
`restore` 能把目录包和平坦 `.md` 都移回去,路径穿越的 `entry` 与目标已存在都被拒绝,
`deleteTrash` 只删指定那一条（对已不存在的条目报错）,`emptyTrash` 清掉剩下的。

`client-smoke.mjs` 用迷你 React 把真实面板渲染在真宿主回环路由上,再驱动「暂存 + 保存」全流程:
拨开关不发任何写请求、点保存只发一次带两个策略字段的 `setInvocation`、按钮按
未修改 → 保存 → 已保存 走(再改一次回到保存)、宿主目录快照慢半拍也弹不回开关;
还走一遍删除确认:「取消」出现在「确认删除?」左边、点取消退回「删除」且不发任何 delete 请求;
接着走回收站流程（`trash` / `restore` / `deleteTrash` / `emptyTrash` 全部走桩）:打开回收站列出条目、
**恢复**只发一次带 `rootId` + `entry` 的 `restore` 且回收站变空、退出再进入会重新读,
详情区 **删除** 要先过「确认删除?」且「取消」在左边（取消不发请求,确认才发一次 `deleteTrash`）,
顶部 **清空回收站** 同样先过「确认清空?」（确认后才发一次 `emptyTrash`）。
它拦下了所有 POST(`create`/`delete` 直接抛错),所以跑一遍不会改动任何真实 `SKILL.md`。

> 搬迁/改名注意：客户端模块表按 `(loader baseUrl, loader 行名)` 缓存包元信息，不含文件时间戳。
> 把包挪到别处后，运行中的宿主仍握着旧路径；浏览器端用的是激活时读进内存的快照，
> 所以刷新页面照常可用，**下次重启宿主**才会解析新路径。

### 发版

改 `version` → 提交 → 推送 → 在仓库根用有该 scope 发布权限的 token 执行 `npm publish`。
注册表对成功的发布回 `202 {"success":true}`，随后该版本进入 **validating** 阶段：验证通过之前，
`/@restregular/dsh-skill-center/<版本>` 与 tarball 地址都回 `404`，`dist-tags` 仍指向上一个版本。
这是正常窗口，不是失败。**用带时间戳参数的版本地址重新探测**（`?t=<ticks>`）即可，
不要重复发布：同一版本再发一次会回
`E409 Cannot publish over previously staged version <版本>`（`npm stage publish` 则回
`E409 Cannot stage previously published version <版本>`），而 `npm stage list` 可能什么都不显示。

### 已知边界

- 面板占中央区域时，右栏的 `dsh-resource://` 预览不可用（宿主规定：无会话面时 `sidebarRight.openResource` 抛错）。
  因此正文预览走本插件自己的路由，在面板内渲染原文。
- 只能管理**文件系统来源**的技能；插件内嵌技能只读。
- 没有选中会话时退化为「按工作目录读取」，此时只能看到内嵌技能 + 该 cwd 的项目技能；
  面板底栏会显示实际使用的 cwd 与作用域级别。
- 目录整体替换制：一次开关改动会让模型的技能目录消息整条重发（这是 Harness 自身的设计）。
- `skill_create` 是宿主级全局注册：每个 Agent 都会多看到一份工具 schema，没有按 Agent 的开关，
  只有卸载插件才会消失。
- 随包 `skill-authoring` 是内嵌技能，面板里只读。它排在 rank 600，所以同名项目级/用户级技能会
  整体盖过它 —— 这正是定制它的正道。

### 许可

[MIT](./LICENSE)
