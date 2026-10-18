/**
 * dsh-skill-center — Host half.
 *
 * 宿主半边做两件事:
 *   1. 把"当前会话能看到的技能"读出来(走 ctx.skills 注册表,作用域解析与
 *      @deepseek-ai/dsh-api-session-controller 的 skills Remote 同源);
 *   2. 对**文件系统来源**的技能提供写操作:改 frontmatter 调用开关、新建、删除(移入 .trash),
 *      以及回收站的三件事:列出、恢复、清空。
 *
 * 浏览器半边(client/client.js)通过同源回环路由 /dsh-skill-center/api 调用,
 * 与本机其它第三方插件的做法一致(dsh-meme 的 /dsh-memes-api)。
 *
 * @module dsh-skill-center
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Loader identity of the Host half. */
export const name = 'skill-center';

/**
 * Services this plugin needs. `webServer` is *not* listed here: the loopback
 * route is mounted through `ctx.inject(['webServer'], …)` so a deployment
 * without a web server still gets the bundled skill and the `skill_create`
 * tool instead of an inert plugin.
 */
export const inject = ['skills'];

/** Loopback route prefix owned by this plugin. */
const ROUTE = '/dsh-skill-center';

/** 技能名文法,与 @deepseek-ai/dsh-skill 的 SKILL_NAME 一致。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** 每个受管根目录下的回收站目录名。 */
const TRASH_DIR = '.trash';

/** 回收站条目名:`<毫秒时间戳>-<技能名>`(平坦技能再带 `.md`)。 */
const TRASH_ENTRY = /^(\d{10,16})-(.+)$/u;

/** frontmatter 里与调用策略相关的键(frontmatter 侧规范名 + 需要清掉的遗留驼峰名)。 */
const INVOCATION_KEYS = new Set([
  'disable-model-invocation',
  'disableModelInvocation',
  'user-invocable',
  'userInvocable',
  'modelInvocable',
]);

/** 默认根的标签与 rank(与 dsh-skill-filesystem 的根表一致)。 */
const ROOT_LABELS = {
  'project-dsh': { label: '项目 .dsh/skills', rank: 100 },
  'project-agents': { label: '项目 .agents/skills', rank: 200 },
  'user-dsh': { label: '用户 DSH 技能', rank: 400 },
  'user-agents': { label: '用户 Agents 技能', rank: 500 },
};

/**
 * 随包(内嵌)技能:目录名 == frontmatter name,正文与资源都在本包 `skills/` 下。
 * 这些技能以 provider 形式注册,资源通过 `resourceBase` 目录暴露给模型 ——
 * 与第一方的 `@deepseek-ai/dsh-skill-office` 同一形态。
 */
const BUNDLED_SKILL_ROOT = fileURLToPath(new URL('../skills/', import.meta.url));

/** 随包技能的名字列表。 */
const BUNDLED_SKILL_NAMES = ['skill-authoring'];

/** provider 名:面板的 provider 列显示这个名字。 */
const BUNDLED_SKILL_PROVIDER = 'dsh-skill-center';

/**
 * 浏览器模块图里本插件那一行的 id 候选:图按**包名**编号,插件 id 只是宿主侧名字。
 * 两个都收,免得 loader 行名或注册 id 变一处就误报。
 */
const BROWSER_ENTRY_IDS = new Set([
  '@restregular/dsh-skill-center',
  'dsh-skill-center',
]);

/**
 * 随包技能的 rank,与 `@deepseek-ai/dsh-skill` 的 `BUNDLED_SKILL_RANK` 一致:
 * 项目根(100/200)与用户根(400/500)的同名技能都能盖过它。
 * 这里写字面量而不是 import,是为了让本插件保持零运行时依赖。
 */
const BUNDLED_SKILL_RANK = 600;

// ---------------------------------------------------------------------------
// HTTP 小工具
// ---------------------------------------------------------------------------

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        rejectPromise(new Error('请求体过大'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectPromise);
  });
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? '';
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function denyNonLoopback(req, res) {
  if (isLoopbackRequest(req)) return false;
  sendJson(res, { ok: false, error: '只接受本机(回环地址)请求' }, 403);
  return true;
}

// ---------------------------------------------------------------------------
// frontmatter:只做字符串级改写,其余内容逐字保留
// ---------------------------------------------------------------------------

/**
 * 把一个 SKILL.md 文本切成 frontmatter 与正文。
 * @param text - 文件全文。
 * @returns 匹配结果,或 undefined(没有合法的 `---` 围栏)。
 */
function matchFrontmatter(text) {
  return /^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/u.exec(text);
}

/**
 * 改写 frontmatter 内的行,保留正文与行尾风格。
 * @param text - 文件全文。
 * @param mutate - 接收 frontmatter 行数组,返回新行数组。
 * @returns 新全文,或 undefined(没有 frontmatter)。
 */
function rewriteFrontmatter(text, mutate) {
  const match = matchFrontmatter(text);
  if (match === undefined) return undefined;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = match[2].split(/\r?\n/u);
  const next = mutate(lines);
  const head = `${match[1]}---${eol}${next.join(eol)}${eol}---`;
  return head + text.slice(match[0].length);
}

/**
 * 取一行 frontmatter 的键名。
 * @param line - 一行文本。
 * @returns 键名,或 undefined。
 */
function lineKey(line) {
  const match = /^([A-Za-z0-9_.-]+)\s*:/u.exec(line);
  return match?.[1];
}

/**
 * 按调用策略重写 frontmatter:默认值不落键,非默认值写显式布尔。
 * @param text - 文件全文。
 * @param invocation - 目标调用策略。
 * @returns 新全文。
 * @throws 当文件没有 frontmatter 时。
 */
function applyInvocation(text, invocation) {
  const next = rewriteFrontmatter(text, (lines) => {
    const kept = lines.filter((line) => {
      const key = lineKey(line);
      return key === undefined || !INVOCATION_KEYS.has(key);
    });
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
    if (invocation.modelInvocable === false) kept.push('disable-model-invocation: true');
    if (invocation.userInvocable === false) kept.push('user-invocable: false');
    return kept;
  });
  if (next === undefined) throw new Error('该技能的 SKILL.md 没有 YAML frontmatter,无法改写');
  return next;
}

/**
 * 读 frontmatter 里的标量字符串字段。
 * @param text - 文件全文。
 * @param key - 字段名。
 * @returns 字段值,或 undefined。
 */
function frontmatterField(text, key) {
  const match = matchFrontmatter(text);
  if (match === undefined) return undefined;
  const line = match[2]
    .split(/\r?\n/u)
    .find((candidate) => lineKey(candidate) === key);
  if (line === undefined) return undefined;
  const raw = line.slice(line.indexOf(':') + 1).trim();
  if (raw === '') return undefined;
  return raw.replace(/^["']/u, '').replace(/["']$/u, '');
}

/**
 * 读 frontmatter 里的布尔字段,取值规则与 dsh-skill-filesystem 的
 * `frontmatterBoolean` 一致(true/false/1/0/yes/no/on/off,大小写不敏感)。
 * @param text - 文件全文。
 * @param key - 字段名。
 * @returns 布尔值,或 undefined(缺字段或值非法)。
 */
function frontmatterBoolean(text, key) {
  const raw = frontmatterField(text, key);
  if (raw === undefined) return undefined;
  const value = raw.toLowerCase();
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') return true;
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// 随包技能:注册成 provider,资源用 resourceBase 目录暴露
// ---------------------------------------------------------------------------

/**
 * 把本包 `skills/<name>/` 读成注册表候选。
 *
 * `resourceBase` 是模型能不能用上这个技能资源的关键:注册表会把
 * "Base directory for this skill: <绝对路径>" 渲染进 `<skill_resources>`,
 * 并告诉模型把正文里的相对路径解析到这个目录。缺了它,资源引用就只是空话。
 *
 * @param name - 技能名(等于目录名)。
 * @returns 注册表候选。
 * @throws 当 SKILL.md 缺失或没有 description 时(属于打包错误,要立刻看见)。
 */
function bundledSkillCandidate(name) {
  const directory = join(BUNDLED_SKILL_ROOT, name);
  const path = join(directory, 'SKILL.md');
  const text = readFileSync(path, 'utf8');
  const description = frontmatterField(text, 'description');
  if (description === undefined) {
    throw new Error(`随包技能 "${name}" 的 SKILL.md 缺少 description:${path}`);
  }
  return {
    name,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: BUNDLED_SKILL_PROVIDER,
    source: 'bundled',
    rank: BUNDLED_SKILL_RANK,
    resourceBase: { kind: 'directory', path: directory },
    locator: path,
    path,
  };
}

/**
 * 读随包技能的正文(frontmatter 之后的部分)。
 * @param name - 技能名。
 * @returns 已 trim 的 Markdown 正文。
 */
function bundledSkillBody(name) {
  const text = readFileSync(join(BUNDLED_SKILL_ROOT, name, 'SKILL.md'), 'utf8');
  const match = matchFrontmatter(text);
  return (match === undefined ? text : text.slice(match[0].length)).trim();
}

/**
 * 构造随包技能的 provider。
 *
 * `list()` 只回目录摘要;正文每次 `get()` 现读,所以仓库里的 SKILL.md 改完
 * 下一次加载就生效(注册表只缓存目录,不缓存正文)。
 *
 * @returns skill provider 对象。
 */
function createBundledSkillProvider() {
  const candidates = BUNDLED_SKILL_NAMES.map((name) => bundledSkillCandidate(name));
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  return {
    name: BUNDLED_SKILL_PROVIDER,
    list: () => Promise.resolve(candidates),
    get(winner) {
      const known = byName.get(winner?.name);
      if (known === undefined) throw new Error(`随包技能 "${String(winner?.name)}" 不存在`);
      const { rank: _rank, locator: _locator, ...summary } = known;
      return Promise.resolve({ ...summary, content: bundledSkillBody(known.name) });
    },
  };
}

/**
 * 注册随包技能。失败只记一行日志:技能资产出问题不该把整个插件(含面板)带下水。
 * @param ctx - 宿主上下文。
 */
function mountBundledSkills(ctx) {
  const skills = ctx.skills ?? ctx.get('skills');
  if (skills === undefined) return;
  try {
    ctx.effect(
      () => skills.registerProvider(createBundledSkillProvider),
      'skill-center: bundled skills',
    );
  } catch (error) {
    ctx.logger?.warn?.(`skill-center: 随包技能未能注册:${error?.message ?? error}`);
  }
}

// ---------------------------------------------------------------------------
// 技能根目录
// ---------------------------------------------------------------------------

function envPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return isAbsolute(value) ? value : resolve(value);
}

function dshHomeDir() {
  return envPath(process.env.DSH_HOME) ?? join(homedir(), '.dsh');
}

function agentsHomeDir() {
  return envPath(process.env.DSH_AGENTS_HOME) ?? join(homedir(), '.agents');
}

/**
 * 项目根 = 最近的含 `.git` 的祖先,与 dsh-skill-filesystem 的 findProjectRoot 一致。
 * @param cwd - 起始目录。
 * @returns 项目根目录。
 */
function findProjectRoot(cwd) {
  let current = resolve(cwd);
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

/**
 * 本插件可以新建/删除技能的根目录表(rank 升序)。
 * @param cwd - 解析项目根的起始目录。
 * @returns 根目录描述数组。
 */
function managedRoots(cwd) {
  const projectRoot = findProjectRoot(cwd);
  const roots = [
    { id: 'project-dsh', path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh' },
    { id: 'project-agents', path: join(projectRoot, '.agents', 'skills'), source: 'project-agents' },
    { id: 'user-dsh', path: join(dshHomeDir(), 'skills'), source: 'user-dsh' },
    { id: 'user-agents', path: join(agentsHomeDir(), 'skills'), source: 'user-agents' },
  ];
  return roots.map((root) => ({
    ...root,
    label: ROOT_LABELS[root.source]?.label ?? root.source,
    rank: ROOT_LABELS[root.source]?.rank ?? 999,
    exists: existsSync(root.path),
  }));
}

/**
 * 判断一个路径是否落在某个受管根目录之下。
 * @param path - 目标路径。
 * @param roots - managedRoots 的结果。
 * @returns 命中的根目录,或 undefined。
 */
function rootOfPath(path, roots) {
  if (typeof path !== 'string' || path === '') return undefined;
  const target = resolve(path);
  return roots.find((root) => {
    const base = resolve(root.path);
    return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
  });
}

// ---------------------------------------------------------------------------
// 回收站:列出 / 恢复 / 清空
// ---------------------------------------------------------------------------

/**
 * 解析一个回收站条目名(`<时间戳>-<名字>`,平坦技能是 `<时间戳>-<名字>.md`)。
 * @param entryName - `.trash` 下的直接子项名。
 * @param directory - 该根的 `.trash` 目录。
 * @returns 条目描述,或 undefined(不是本插件写出的条目)。
 */
function parseTrashEntry(entryName, directory) {
  const match = TRASH_ENTRY.exec(entryName);
  if (match === undefined) return undefined;
  const stamp = Number(match[1]);
  if (!Number.isFinite(stamp)) return undefined;
  const path = join(directory, entryName);
  if (!existsSync(path)) return undefined;
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return undefined;
  }
  const kind = stats.isDirectory() ? 'directory' : 'file';
  let name = match[2];
  if (kind === 'file') {
    if (!name.endsWith('.md')) return undefined;
    name = name.slice(0, -3);
  }
  if (!SKILL_NAME.test(name)) return undefined;
  return {
    name,
    entry: entryName,
    kind,
    stamp,
    deletedAt: new Date(stamp).toISOString(),
    path,
  };
}

/**
 * 列出一个受管根目录的回收站条目。
 * @param root - 受管根目录。
 * @returns 条目数组(未排序)。
 */
function trashEntriesOf(root) {
  const directory = join(root.path, TRASH_DIR);
  if (!existsSync(directory)) return [];
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const entries = [];
  for (const entryName of names) {
    const parsed = parseTrashEntry(entryName, directory);
    if (parsed === undefined) continue;
    entries.push({
      rootId: root.id,
      rootLabel: root.label,
      ...parsed,
    });
  }
  return entries;
}

/**
 * 解析本次请求的工作目录;回收站操作不需要技能注册表,所以不读目录快照。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd }`。
 * @returns 工作目录。
 */
async function resolveCwd(ctx, request) {
  const live = request.sessionId === undefined ? undefined : ctx.get('agents')?.get?.(request.sessionId);
  if (live !== undefined) {
    return live?.session?.header?.cwd ?? request.cwd ?? process.cwd();
  }
  const observed = await observeSession(ctx, request.sessionId);
  return observed.cwd ?? request.cwd ?? process.cwd();
}

// ---------------------------------------------------------------------------
// 技能目录解析(与 shipped skills Remote 同源的三级兜底)
// ---------------------------------------------------------------------------

/**
 * 读一个会话记录的 cwd 与预设,不激活冷 Agent。
 * @param ctx - 宿主上下文。
 * @param sessionId - 会话 id。
 * @returns `{ cwd, agentPreset }`;读不到时字段为 undefined。
 */
async function observeSession(ctx, sessionId) {
  const sessionQuery = ctx.get('sessionQuery');
  if (sessionQuery === undefined || sessionId === undefined) return {};
  let observation;
  try {
    observation = await sessionQuery.observeSession(sessionId);
  } catch {
    return {};
  }
  try {
    return {
      cwd: observation?.header?.cwd,
      agentPreset: observation?.projections?.values?.agentPreset ?? undefined,
    };
  } finally {
    try {
      await observation?.[Symbol.asyncDispose]?.();
    } catch {
      /* 观察句柄释放失败不影响读取结果 */
    }
  }
}

/**
 * 解析"这次读取用哪个注册表、哪个作用域、哪个 cwd"。
 *
 * 三级兜底:活 Agent(最准) → 会话记录的预设作用域 → 全局注册表。
 * 第一级决定了预设内挂载的 skill-filesystem 是否可见。
 *
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd }`。
 * @returns `{ registry, scope, cwd, tier, release }`。
 */
async function resolveView(ctx, request) {
  const globalRegistry = ctx.get('skills');
  if (globalRegistry === undefined) throw new Error('技能注册表不存在:当前组合没有挂载 @deepseek-ai/dsh-skill');

  const agents = ctx.get('agents');
  const presets = ctx.get('agentPresets');
  const live = request.sessionId === undefined ? undefined : agents?.get?.(request.sessionId);

  if (live !== undefined) {
    const scoped = presets?.serviceFor?.(live, 'skills');
    return {
      registry: scoped ?? globalRegistry,
      scope: live,
      cwd: live?.session?.header?.cwd ?? request.cwd ?? process.cwd(),
      tier: 'live-agent',
      release: undefined,
    };
  }

  const observed = await observeSession(ctx, request.sessionId);
  const cwd = observed.cwd ?? request.cwd ?? process.cwd();

  if (presets !== undefined && observed.agentPreset !== undefined) {
    let lease;
    try {
      lease = await presets.acquireScope(observed.agentPreset);
    } catch {
      lease = undefined;
    }
    if (lease !== undefined) {
      return {
        registry: globalRegistry,
        scope: lease.key,
        cwd,
        tier: 'preset-scope',
        release: async () => {
          try {
            await lease[Symbol.asyncDispose]?.();
          } catch {
            /* 释放失败不影响读取结果 */
          }
        },
      };
    }
  }

  return {
    registry: globalRegistry,
    scope: undefined,
    cwd,
    tier: observed.cwd === undefined && request.cwd === undefined ? 'process-cwd' : 'global',
    release: undefined,
  };
}

/**
 * 读技能目录快照。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd }`。
 * @returns 归一化后的技能数组与元信息。
 */
async function readCatalog(ctx, request) {
  const view = await resolveView(ctx, request);
  try {
    const snapshot = await view.registry.snapshot({ cwd: view.cwd, scope: view.scope });
    const roots = managedRoots(view.cwd);
    return {
      cwd: view.cwd,
      tier: view.tier,
      complete: snapshot.complete !== false,
      roots,
      skills: snapshot.skills.map((skill) => describeSkill(skill, roots)),
    };
  } finally {
    await view.release?.();
  }
}

/**
 * 把注册表摘要转成面板需要的形状。
 * @param skill - 注册表 Summary。
 * @param roots - 受管根目录。
 * @returns 面板条目。
 */
function describeSkill(skill, roots) {
  const path = typeof skill.path === 'string' ? skill.path : undefined;
  const root = rootOfPath(path, roots);
  const onDisk = path !== undefined && existsSync(path) && statSync(path).isFile();
  let bytes;
  let invocation;
  if (onDisk) {
    try {
      bytes = statSync(path).size;
    } catch {
      bytes = undefined;
    }
    // 受管根里的技能以**磁盘为准**:技能目录是缓存的,写完盘之后 watcher 的失效
    // 事件到达之前,快照里的调用策略还是旧值 —— 面板若照抄快照,刚拨完开关的界面
    // 会被自己重读回来的旧值弹回去(手动刷新才会变)。这里现读一次 frontmatter 求解。
    if (root !== undefined) {
      try {
        const text = readFileSync(path, 'utf8');
        invocation = {
          modelInvocable: frontmatterBoolean(text, 'disable-model-invocation') !== true,
          userInvocable: frontmatterBoolean(text, 'user-invocable') !== false,
        };
      } catch {
        invocation = undefined;
      }
    }
  }
  const effective = invocation ?? skill.invocation;
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    provider: skill.provider,
    source: skill.source,
    path,
    directory: path === undefined ? undefined : dirname(path),
    modelInvocable: effective?.modelInvocable !== false,
    userInvocable: effective?.userInvocable !== false,
    rootId: root?.id,
    rootLabel: root?.label,
    writable: root !== undefined && onDisk,
    bytes,
    resourceKind: skill.resourceBase?.kind,
  };
}

/**
 * 在受管根目录里定位一个技能的 SKILL.md,用于写操作。
 * @param name - 技能名。
 * @param roots - 受管根目录。
 * @returns `{ root, dir, path, flat }`,或 undefined。
 */
function locateOnDisk(name, roots) {
  for (const root of roots) {
    if (!existsSync(root.path)) continue;
    const bundle = join(root.path, name, 'SKILL.md');
    if (existsSync(bundle) && statSync(bundle).isFile()) {
      return { root, dir: join(root.path, name), path: bundle, flat: false };
    }
    const flat = join(root.path, `${name}.md`);
    if (existsSync(flat) && statSync(flat).isFile()) {
      return { root, dir: root.path, path: flat, flat: true };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

/**
 * 诊断:本插件的宿主/客户端两半是否都已挂载,以及技能根的解析结果。
 *
 * 客户端半侧是否进了浏览器模块图由 `clientModules` 的合成图决定,
 * 这里直接把它读出来,省得靠页面表现猜。
 *
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd }`。
 * @returns 响应体。
 */
async function opDiagnose(ctx, request) {
  const clientModules = ctx.get('clientModules');
  const graph = clientModules?.graph?.();
  const entries = Array.isArray(graph?.entries) ? graph.entries : [];
  // 浏览器模块图按**包名**给行编号(客户端 bundle 的注册 id 也是包名),
  // 插件 id 只是宿主侧的 loader 名字:只按 'dsh-skill-center' 找会永远找不到,
  // diagnose 就会把"客户端半边好好地挂在图里"误报成 inGraph: false。
  const mine = entries.find((entry) => BROWSER_ENTRY_IDS.has(entry.id));
  let catalog;
  try {
    const catalogRead = await readCatalog(ctx, request);
    catalog = { cwd: catalogRead.cwd, tier: catalogRead.tier, total: catalogRead.skills.length };
  } catch (error) {
    catalog = { error: String(error?.message ?? error) };
  }
  return {
    ok: true,
    host: { mounted: true, route: ROUTE },
    client: {
      inGraph: mine !== undefined,
      entryId: mine?.id,
      graphRevision: graph?.rev,
      graphEntryCount: entries.length,
      url: mine?.url,
    },
    catalog,
    roots: managedRoots(request.cwd ?? process.cwd()),
  };
}

/**
 * 列出当前会话可见的技能。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd }`。
 * @returns 响应体。
 */
async function opList(ctx, request) {
  const catalog = await readCatalog(ctx, request);
  const writable = catalog.skills.filter((skill) => skill.writable).length;
  const trash = catalog.roots.reduce((total, root) => total + trashEntriesOf(root).length, 0);
  return {
    ok: true,
    encoding: 'utf8',
    cwd: catalog.cwd,
    tier: catalog.tier,
    complete: catalog.complete,
    roots: catalog.roots,
    counts: {
      total: catalog.skills.length,
      writable,
      embedded: catalog.skills.length - writable,
      trash,
    },
    skills: catalog.skills,
  };
}

/**
 * 读一个技能的 SKILL.md 原文。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd, name }`。
 * @returns 响应体。
 */
async function opRead(ctx, request) {
  const catalog = await readCatalog(ctx, request);
  const skill = catalog.skills.find((candidate) => candidate.name === request.name);
  if (skill === undefined) return { ok: false, error: `技能 "${request.name}" 不在当前技能目录中` };
  const entry = locateOnDisk(request.name, catalog.roots);
  if (entry === undefined) {
    return {
      ok: false,
      error: skill.rootId === undefined
        ? `技能 "${request.name}" 由插件内嵌提供(${skill.provider}),没有可读的本地文件`
        : `技能 "${request.name}" 的文件不在可管理的技能根目录内`,
    };
  }
  const text = readFileSync(entry.path, 'utf8');
  return {
    ok: true,
    name: request.name,
    path: entry.path,
    rootId: entry.root.id,
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/**
 * 改写一个技能的调用策略(模型可调用 / 用户可调用)。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd, name, modelInvocable, userInvocable }`。
 * @returns 响应体。
 */
async function opSetInvocation(ctx, request) {
  const invocation = {
    modelInvocable: request.modelInvocable !== false,
    userInvocable: request.userInvocable !== false,
  };
  if (request.modelInvocable === undefined && request.userInvocable === undefined) {
    return { ok: false, error: '至少要指定 modelInvocable 或 userInvocable' };
  }
  const catalog = await readCatalog(ctx, request);
  const entry = locateOnDisk(request.name, catalog.roots);
  if (entry === undefined) {
    return { ok: false, error: `技能 "${request.name}" 没有可写的本地文件(插件内嵌技能无法改写)` };
  }
  const before = readFileSync(entry.path, 'utf8');
  const after = applyInvocation(before, invocation);
  if (after !== before) writeFileSync(entry.path, after, 'utf8');
  return {
    ok: true,
    name: request.name,
    path: entry.path,
    changed: after !== before,
    modelInvocable: invocation.modelInvocable,
    userInvocable: invocation.userInvocable,
  };
}

/**
 * 归一化资源相对路径:必须是技能包目录内的相对路径,拒绝绝对路径、`.`/`..` 段与
 * 二次写入 SKILL.md。面板与模型工具都走这道闸。
 *
 * @param raw - 原始路径(允许 `\` 分隔)。
 * @param directory - 技能包目录。
 * @returns 归一化后的 posix 相对路径,或 undefined(非法)。
 */
function normalizeResourcePath(raw, directory) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.replace(/\\/gu, '/').trim();
  if (value === '' || value.startsWith('/') || /^[A-Za-z]:/u.test(value)) return undefined;
  const segments = value.split('/').filter((segment) => segment !== '');
  if (segments.length === 0) return undefined;
  if (segments.some((segment) => segment === '.' || segment === '..')) return undefined;
  const relative = segments.join('/');
  if (relative.toLowerCase() === 'skill.md') return undefined;
  const base = resolve(directory);
  const target = resolve(base, ...segments);
  if (target !== base && !target.startsWith(base.endsWith(sep) ? base : base + sep)) return undefined;
  return relative;
}

/**
 * 新建(或按 `overwrite` 覆盖)一个技能包:写 frontmatter + 正文,再把资源文件落到
 * 同一个技能目录里。面板的 `create` 与模型工具 `skill_create` 共用这一份实现。
 *
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd, name, description, whenToUse, body, rootId, resources, overwrite, modelInvocable, userInvocable }`。
 * @returns 响应体;`ok` 为 false 时带 `error`。
 */
async function createSkillBundle(ctx, request) {
  const skillName = String(request.name ?? '').trim();
  if (!SKILL_NAME.test(skillName)) {
    return { ok: false, error: `技能名 "${skillName}" 不合法:只允许小写字母、数字与单个连字符(kebab-case)` };
  }
  const description = String(request.description ?? '').replace(/\s+/gu, ' ').trim();
  if (description === '') return { ok: false, error: 'description 必填' };
  const whenToUse = String(request.whenToUse ?? '').replace(/\s+/gu, ' ').trim();
  const overwrite = request.overwrite === true;
  const rawResources = Array.isArray(request.resources) ? request.resources : [];

  const catalog = await readCatalog(ctx, request);
  const existing = locateOnDisk(skillName, catalog.roots);
  if (existing === undefined && catalog.skills.some((skill) => skill.name === skillName)) {
    return {
      ok: false,
      error: `技能 "${skillName}" 已存在,但由插件内嵌或其它来源提供,不在可管理的技能根目录里`,
    };
  }
  if (existing !== undefined && !overwrite) {
    return { ok: false, error: `技能 "${skillName}" 已存在:${existing.path}(需要覆盖请传 overwrite)` };
  }

  let root = existing?.root;
  let directory = existing?.dir;
  if (existing === undefined) {
    if (request.rootId !== undefined && request.rootId !== '') {
      // 显式指定的根允许尚不存在(mkdir 会补上):项目根就在工作区里,
      // 由调用方明确点名比"静默换到用户根"更可预期。
      root = catalog.roots.find((candidate) => candidate.id === request.rootId);
      if (root === undefined) {
        return {
          ok: false,
          error: `未知的技能根 "${request.rootId}";可选:${catalog.roots.map((candidate) => candidate.id).join('、')}`,
        };
      }
    } else {
      const usable = catalog.roots.filter((candidate) => candidate.exists || candidate.id.startsWith('user-'));
      root = usable.find((candidate) => candidate.id === 'user-agents') ?? usable[0];
    }
    if (root === undefined) return { ok: false, error: '没有可用的技能根目录' };
    directory = join(root.path, skillName);
    if (existsSync(directory) && !overwrite) {
      return { ok: false, error: `目录已存在:${directory}(需要覆盖请传 overwrite)` };
    }
  }

  const resources = [];
  if (existing?.flat === true) {
    if (rawResources.length > 0) {
      return {
        ok: false,
        error: `技能 "${skillName}" 是平坦文件 ${existing.path},无法承载资源文件;请改用目录包`,
      };
    }
  } else {
    for (const entry of rawResources) {
      const relative = normalizeResourcePath(entry?.path, directory);
      if (relative === undefined) {
        return {
          ok: false,
          error: `资源路径 "${String(entry?.path ?? '')}" 不合法:必须是技能目录内的相对路径,不能是 SKILL.md,也不能含 . 或 .. 段`,
        };
      }
      if (typeof entry?.content !== 'string') {
        return { ok: false, error: `资源 "${relative}" 缺少 content` };
      }
      resources.push({
        relative,
        content: entry.content,
        target: join(directory, ...relative.split('/')),
      });
    }
  }

  const invocation = {
    modelInvocable: request.modelInvocable !== false,
    userInvocable: request.userInvocable !== false,
  };
  const lines = ['---', `name: ${skillName}`, `description: ${JSON.stringify(description)}`];
  if (whenToUse !== '') lines.push(`whenToUse: ${JSON.stringify(whenToUse)}`);
  if (invocation.modelInvocable === false) lines.push('disable-model-invocation: true');
  if (invocation.userInvocable === false) lines.push('user-invocable: false');
  lines.push('---', '');
  const body = String(request.body ?? '').trim();
  lines.push(body === '' ? `# ${skillName}` : body, '');

  const flat = existing?.flat === true;
  const path = flat ? existing.path : join(directory, 'SKILL.md');
  mkdirSync(flat ? dirname(path) : directory, { recursive: true });
  writeFileSync(path, lines.join('\n'), 'utf8');
  for (const resource of resources) {
    mkdirSync(dirname(resource.target), { recursive: true });
    writeFileSync(resource.target, resource.content, 'utf8');
  }

  return {
    ok: true,
    name: skillName,
    path,
    directory: flat ? dirname(path) : directory,
    rootId: root?.id,
    rootLabel: root?.label,
    replaced: existing !== undefined,
    resources: resources.map((resource) => resource.relative),
  };
}

/**
 * 新建一个技能目录包(HTTP `op=create`)。
 * @param ctx - 宿主上下文。
 * @param request - 见 createSkillBundle。
 * @returns 响应体。
 */
async function opCreate(ctx, request) {
  const created = await createSkillBundle(ctx, request);
  if (created.ok !== true) return created;
  return {
    ok: true,
    name: created.name,
    path: created.path,
    directory: created.directory,
    rootId: created.rootId,
    rootLabel: created.rootLabel,
    replaced: created.replaced,
    resources: created.resources,
  };
}

/**
 * 删除一个技能:移动进同根的 `.trash/<时间戳>-<名字>`(可恢复,不硬删)。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd, name }`。
 * @returns 响应体。
 */
async function opDelete(ctx, request) {
  const catalog = await readCatalog(ctx, request);
  if (!catalog.skills.some((skill) => skill.name === request.name)) {
    return { ok: false, error: `技能 "${request.name}" 不在当前技能目录中` };
  }
  const entry = locateOnDisk(request.name, catalog.roots);
  if (entry === undefined) {
    return { ok: false, error: `技能 "${request.name}" 没有可删除的本地文件(插件内嵌技能无法删除)` };
  }
  const trash = join(entry.root.path, TRASH_DIR);
  mkdirSync(trash, { recursive: true });
  const stamp = Date.now();
  const target = entry.flat
    ? join(trash, `${stamp}-${request.name}.md`)
    : join(trash, `${stamp}-${request.name}`);
  // 平坦技能要搬的是那个 `.md` 文件本身;搬 entry.dir 会把整个技能根挪走。
  renameSync(entry.flat ? entry.path : entry.dir, target);
  return { ok: true, name: request.name, movedTo: target, rootId: entry.root.id };
}

/**
 * 列出所有受管根目录的回收站条目(新的在前)。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd }`。
 * @returns 响应体。
 */
async function opTrash(ctx, request) {
  const cwd = await resolveCwd(ctx, request);
  const entries = managedRoots(cwd)
    .flatMap((root) => trashEntriesOf(root))
    .sort((left, right) => right.stamp - left.stamp);
  return { ok: true, cwd, entries };
}

/**
 * 把一条回收站条目移回它原来的技能根。目标已存在时拒绝覆盖。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd, rootId, entry }`。
 * @returns 响应体。
 */
async function opRestore(ctx, request) {
  const rootId = String(request.rootId ?? '');
  const entryName = String(request.entry ?? '');
  // 只接受 `.trash` 的直接子项名:挡住 `../x`、绝对路径与分隔符。
  if (entryName === '' || entryName === '.' || entryName === '..' || basename(entryName) !== entryName) {
    return { ok: false, error: '非法的回收站条目名' };
  }
  const roots = managedRoots(await resolveCwd(ctx, request));
  const root = roots.find((candidate) => candidate.id === rootId);
  if (root === undefined) return { ok: false, error: `未知的技能根 "${rootId}"` };
  const parsed = parseTrashEntry(entryName, join(root.path, TRASH_DIR));
  if (parsed === undefined) {
    return { ok: false, error: `回收站里没有 "${entryName}"(可能已被恢复或清空)` };
  }
  const target = parsed.kind === 'directory'
    ? join(root.path, parsed.name)
    : join(root.path, `${parsed.name}.md`);
  if (existsSync(target)) {
    return { ok: false, error: `技能 "${parsed.name}" 已存在,未覆盖:${target}` };
  }
  renameSync(parsed.path, target);
  return {
    ok: true,
    name: parsed.name,
    path: target,
    directory: parsed.kind === 'directory' ? target : root.path,
    rootId: root.id,
    rootLabel: root.label,
  };
}

/**
 * 永久清空回收站。不传 `rootId` 时清空全部受管根;传了只清那个根。
 * 只删除各根 `.trash` 的直接子项,不会碰技能目录本身。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd, rootId? }`。
 * @returns 响应体。
 */
async function opEmptyTrash(ctx, request) {
  const rootId = typeof request.rootId === 'string' && request.rootId !== '' ? request.rootId : undefined;
  const roots = managedRoots(await resolveCwd(ctx, request));
  const targets = rootId === undefined ? roots : roots.filter((root) => root.id === rootId);
  if (targets.length === 0) return { ok: false, error: `未知的技能根 "${rootId}"` };
  let removed = 0;
  const failures = [];
  for (const root of targets) {
    const directory = join(root.path, TRASH_DIR);
    if (!existsSync(directory)) continue;
    let names;
    try {
      names = readdirSync(directory);
    } catch (error) {
      failures.push(`${root.id}: ${String(error?.message ?? error)}`);
      continue;
    }
    for (const entryName of names) {
      try {
        rmSync(join(directory, entryName), { recursive: true, force: true });
        removed += 1;
      } catch (error) {
        failures.push(`${root.id}/${entryName}: ${String(error?.message ?? error)}`);
      }
    }
  }
  if (failures.length > 0) {
    return { ok: false, error: `部分条目未能删除:${failures.join('; ')}`, removed };
  }
  return { ok: true, removed };
}

// ---------------------------------------------------------------------------
// 模型工具:skill_create
// ---------------------------------------------------------------------------

/**
 * `skill_create` 的参数 schema。
 *
 * 这里手写**原始 JSON Schema**,而不是 import `@deepseek-ai/dsh-tools` 的
 * `defineTool`:本包因此保持零运行时依赖,也不依赖宿主 node_modules 的解析路径。
 * 只使用注册表支持的子集:type/oneOf/properties/required/additionalProperties/
 * items/enum/const 加注解键(description/title…)。
 */
const SKILL_CREATE_PARAMETERS = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Kebab-case skill name; it is also the bundle directory name.',
    },
    description: {
      type: 'string',
      description: 'Frontmatter description — the only routing signal the model catalog shows. Write it as "Use when …".',
    },
    whenToUse: {
      type: 'string',
      description: 'Optional "whenToUse" frontmatter field (provider metadata; not rendered into the catalog).',
    },
    body: {
      type: 'string',
      description: 'Full Markdown body that follows the frontmatter. Omit to write a placeholder "# <name>" heading.',
    },
    root: {
      type: 'string',
      enum: ['project-dsh', 'project-agents', 'user-dsh', 'user-agents'],
      description: 'Target skill root. Defaults to user-agents (~/.agents/skills); pass a project root for a repository-scoped skill.',
    },
    resources: {
      type: 'array',
      description: 'Extra files written inside the same bundle directory, e.g. references/roots.md or scripts/check.py.',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path inside the bundle directory.' },
          content: { type: 'string', description: 'Full UTF-8 file content.' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    modelInvocable: {
      type: 'boolean',
      description: 'Default true; false writes disable-model-invocation: true, keeping the skill out of the model catalog.',
    },
    userInvocable: {
      type: 'boolean',
      description: 'Default true; false writes user-invocable: false, disabling the user-facing /name entry point.',
    },
    overwrite: {
      type: 'boolean',
      description: 'Default false: fail when the skill already exists. true rewrites SKILL.md and the listed resources in place.',
    },
  },
  required: ['name', 'description'],
  additionalProperties: false,
};

/** `skill_create` 的返回值 schema,与 execute 的返回字段一一对应。 */
const SKILL_CREATE_OUTPUT = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    directory: { type: 'string' },
    skillFile: { type: 'string' },
    rootId: { type: 'string' },
    rootLabel: { type: 'string' },
    resources: { type: 'array', items: { type: 'string' } },
    replaced: { type: 'boolean' },
  },
  required: ['name', 'directory', 'skillFile', 'resources', 'replaced'],
  additionalProperties: false,
};

/**
 * 构造 `skill_create` 工具定义:把面板的"新建"能力交给模型,并顺带解决
 * "技能根目录在工作区之外"这个真实障碍 —— 文件写入工具被沙箱限制在工作区内,
 * 而受管技能根不在工作区。
 *
 * @param ctx - 宿主上下文。
 * @returns 可交给 `ctx.tools.register()` 的定义。
 */
function skillCreateTool(ctx) {
  return {
    name: 'skill_create',
    description: 'Create a Harness skill bundle: writes <root>/<name>/SKILL.md with the given frontmatter and body, plus any extra files listed in resources, inside that same directory. Use it to author or scaffold a skill, especially when the target skill root is outside the session workspace (~/.agents/skills, ~/.dsh/skills), where the file-write tools are sandboxed and cannot write. Put long-form detail in resources (for example references/<topic>.md, scripts/<tool>.py) and refer to those files by relative path from the body. Fails when a skill of that name already exists unless overwrite is true.',
    parameters: SKILL_CREATE_PARAMETERS,
    output: {
      schema: SKILL_CREATE_OUTPUT,
      render(_args, value) {
        const lines = [
          `${value.replaced === true ? 'Replaced' : 'Created'} skill "${value.name}"`,
          `directory: ${value.directory}`,
          `SKILL.md: ${value.skillFile}`,
          `root: ${value.rootLabel} (${value.rootId})`,
          value.resources.length === 0 ? 'resources: none' : `resources: ${value.resources.join(', ')}`,
        ];
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      const session = exec?.agent?.session;
      const created = await createSkillBundle(ctx, {
        sessionId: session?.id,
        cwd: session?.header?.cwd,
        name: args.name,
        description: args.description,
        whenToUse: args.whenToUse,
        body: args.body,
        rootId: args.root,
        resources: args.resources,
        overwrite: args.overwrite,
        modelInvocable: args.modelInvocable,
        userInvocable: args.userInvocable,
      });
      if (created.ok !== true) throw new Error(created.error);
      return {
        name: created.name,
        directory: created.directory,
        skillFile: created.path,
        rootId: created.rootId,
        rootLabel: created.rootLabel,
        resources: created.resources,
        replaced: created.replaced,
      };
    },
  };
}

/**
 * 注册 `skill_create`。没有 tools 服务的组合里只是少一个工具,
 * 面板与随包技能照常工作。
 * @param ctx - 宿主上下文。
 */
function mountSkillTools(ctx) {
  ctx.inject(['tools'], (scoped) => {
    try {
      scoped.effect(
        () => scoped.tools.register(skillCreateTool(scoped)),
        'skill-center: skill_create tool',
      );
    } catch (error) {
      scoped.logger?.warn?.(`skill-center: skill_create 未能注册:${error?.message ?? error}`);
    }
  });
}

/** 路由表:op → 处理器。 */
const OPERATIONS = {
  ping: async () => ({ ok: true, plugin: 'dsh-skill-center', version: 1 }),
  diagnose: opDiagnose,
  list: opList,
  read: opRead,
  setInvocation: opSetInvocation,
  create: opCreate,
  delete: opDelete,
  trash: opTrash,
  restore: opRestore,
  emptyTrash: opEmptyTrash,
};

// ---------------------------------------------------------------------------
// 插件体
// ---------------------------------------------------------------------------

/**
 * 挂载回环路由,向客户端暴露技能目录与管理操作。
 * @param ctx - 宿主上下文(已保证 webServer 就绪)。
 */
function mountRoutes(ctx) {
  const webServer = ctx.webServer ?? ctx.get('webServer');
  if (webServer === undefined) return;

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE,
    async handler(req, res) {
      if (denyNonLoopback(req, res)) return;
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname.startsWith(ROUTE) ? url.pathname.slice(ROUTE.length) : '';

      try {
        if (req.method === 'GET') {
          const op = pathname === '/api' || pathname === '' ? url.searchParams.get('op') ?? 'list' : pathname.replace(/^\//u, '');
          const handler = OPERATIONS[op];
          if (handler === undefined) {
            sendJson(res, { ok: false, error: `未知操作 "${op}"` }, 404);
            return;
          }
          const payload = await handler(ctx, {
            sessionId: url.searchParams.get('sessionId') ?? undefined,
            cwd: url.searchParams.get('cwd') ?? undefined,
            name: url.searchParams.get('name') ?? undefined,
          });
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        if (req.method === 'POST') {
          let body;
          try {
            body = JSON.parse(await readBody(req));
          } catch {
            sendJson(res, { ok: false, error: '无效的 JSON 请求体' }, 400);
            return;
          }
          const op = String(body?.op ?? pathname.replace(/^\//u, ''));
          const handler = OPERATIONS[op];
          if (handler === undefined) {
            sendJson(res, { ok: false, error: `未知操作 "${op}"` }, 404);
            return;
          }
          const payload = await handler(ctx, body ?? {});
          sendJson(res, payload, payload.ok ? 200 : 400);
          return;
        }

        sendJson(res, { ok: false, error: '只支持 GET 与 POST' }, 405);
      } catch (error) {
        ctx.logger?.warn?.(`skill-center: ${error?.stack ?? error}`);
        sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500);
      }
    },
  }), 'skill-center: loopback routes');
}

/**
 * 插件体:随包技能、模型工具、回环路由三块互相独立降级 ——
 * 任何一块失败都只记日志,不会让宿主启动失败,也不会拖垮另外两块。
 * @param ctx - 宿主上下文(已保证 skills 就绪)。
 */
export function apply(ctx) {
  mountBundledSkills(ctx);
  mountSkillTools(ctx);
  ctx.inject(['webServer'], (scoped) => mountRoutes(scoped));
}
