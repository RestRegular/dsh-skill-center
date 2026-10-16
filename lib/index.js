/**
 * dsh-skill-center — Host half.
 *
 * 宿主半边只做两件事:
 *   1. 把"当前会话能看到的技能"读出来(走 ctx.skills 注册表,作用域解析与
 *      @deepseek-ai/dsh-api-session-controller 的 skills Remote 同源);
 *   2. 对**文件系统来源**的技能提供写操作:改 frontmatter 调用开关、新建、删除(移入 .trash)。
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
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/** Loader identity of the Host half. */
export const name = 'skill-center';

/** Services this plugin needs; absent `webServer` keeps it inert instead of throwing. */
export const inject = ['skills', 'webServer'];

/** Loopback route prefix owned by this plugin. */
const ROUTE = '/dsh-skill-center';

/** 技能名文法,与 @deepseek-ai/dsh-skill 的 SKILL_NAME 一致。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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
  if (onDisk) {
    try {
      bytes = statSync(path).size;
    } catch {
      bytes = undefined;
    }
  }
  return {
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    provider: skill.provider,
    source: skill.source,
    path,
    directory: path === undefined ? undefined : dirname(path),
    modelInvocable: skill.invocation?.modelInvocable !== false,
    userInvocable: skill.invocation?.userInvocable !== false,
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
  const mine = entries.find((entry) => entry.id === 'dsh-skill-center');
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
 * 新建一个技能目录包。
 * @param ctx - 宿主上下文。
 * @param request - `{ sessionId, cwd, name, description, body, rootId, modelInvocable, userInvocable }`。
 * @returns 响应体。
 */
async function opCreate(ctx, request) {
  const skillName = String(request.name ?? '').trim();
  if (!SKILL_NAME.test(skillName)) {
    return { ok: false, error: `技能名 "${skillName}" 不合法:只允许小写字母、数字与单个连字符(kebab-case)` };
  }
  const description = String(request.description ?? '').trim();
  if (description === '') return { ok: false, error: 'description 必填' };

  const catalog = await readCatalog(ctx, request);
  if (catalog.skills.some((skill) => skill.name === skillName)) {
    return { ok: false, error: `技能 "${skillName}" 已存在` };
  }
  const roots = catalog.roots.filter((root) => root.exists || root.id.startsWith('user-'));
  const root = roots.find((candidate) => candidate.id === request.rootId)
    ?? roots.find((candidate) => candidate.id === 'user-agents')
    ?? roots[0];
  if (root === undefined) return { ok: false, error: '没有可用的技能根目录' };

  const dir = join(root.path, skillName);
  if (existsSync(dir)) return { ok: false, error: `目录已存在:${dir}` };
  const invocation = {
    modelInvocable: request.modelInvocable !== false,
    userInvocable: request.userInvocable !== false,
  };
  const lines = ['---', `name: ${skillName}`, `description: ${JSON.stringify(description)}`];
  if (invocation.modelInvocable === false) lines.push('disable-model-invocation: true');
  if (invocation.userInvocable === false) lines.push('user-invocable: false');
  lines.push('---', '');
  const body = String(request.body ?? '').trim();
  lines.push(body === '' ? `# ${skillName}` : body, '');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'SKILL.md');
  writeFileSync(path, lines.join('\n'), 'utf8');
  return { ok: true, name: skillName, path, rootId: root.id };
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
  const trash = join(entry.root.path, '.trash');
  mkdirSync(trash, { recursive: true });
  const stamp = Date.now();
  const target = entry.flat
    ? join(trash, `${stamp}-${request.name}.md`)
    : join(trash, `${stamp}-${request.name}`);
  renameSync(entry.dir, target);
  return { ok: true, name: request.name, movedTo: target, rootId: entry.root.id };
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
};

// ---------------------------------------------------------------------------
// 插件体
// ---------------------------------------------------------------------------

/**
 * 挂载回环路由,向客户端暴露技能目录与管理操作。
 * @param ctx - 宿主上下文(已保证 skills 与 webServer 就绪)。
 */
export function apply(ctx) {
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
