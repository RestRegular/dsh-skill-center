/**
 * 离线自检:随包技能(skills/skill-authoring)与模型工具 skill_create。
 * 不需要重启宿主,也不碰真实用户技能根 —— 所有写入都发生在临时目录里。
 *
 * 三组检查:
 *   1. 资产契约:包内每个技能 目录名 == frontmatter name、description 非空、
 *      resourceBase 目录真实存在、get() 返回去掉 frontmatter 的正文;
 *      并且每个文件里"表格行/链接"点到的 references|scripts|assets|templates 相对路径
 *      都真实存在(改了文件名却忘记同步正文,这里立刻 FAIL)。
 *   2. 工具契约:parameters / output.schema 只使用 dsh-tools 支持的 JSON Schema 子集
 *      (schema 是手写的,这条就是防手滑的护栏)、required 都在 properties 里、
 *      render() 返回文本内容块、execute() 的返回值符合 output.schema。
 *   3. 真实写入:用桩 ctx 真跑一遍 skill_create —— 新建、资源落盘、重名与覆盖、
 *      非法技能名、路径穿越、平坦文件拒收资源、显式项目根、内嵌技能重名;
 *      另外验证缺 tools / 缺 webServer / provider 注册抛错三种降级都不炸宿主。
 *
 * 运行: node verify-skill.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, inject, name } from './lib/index.js';

const failures = [];
let checks = 0;
/**
 * 记录一条检查结论。
 * @param label - 检查项。
 * @param ok - 是否通过。
 * @param detail - 失败时展示的细节。
 */
function check(label, ok, detail) {
  checks += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok || detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(label);
}

// ---------------------------------------------------------------------------
// dsh-tools 支持的 JSON Schema 子集(逐条对应 @deepseek-ai/dsh-tools 的
// CONSTRAINT_KEYWORDS / ANNOTATION_KEYWORDS / SCHEMA_TYPES)
// ---------------------------------------------------------------------------

const CONSTRAINT_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/**
 * 检查一份原始 JSON Schema 是否落在注册表支持的子集内。
 * @param schema - 待检查的 schema 节点。
 * @param path - 诊断路径。
 * @param problems - 违规收集器。
 */
function checkSchemaSubset(schema, path, problems) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    problems.push(`${path} must be a schema object`);
    return;
  }
  for (const key of Object.keys(schema)) {
    if (CONSTRAINT_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) continue;
    problems.push(`${path}.${key} is not in the supported keyword subset`);
  }
  if (Object.hasOwn(schema, 'type')) {
    if (!SCHEMA_TYPES.has(schema.type)) problems.push(`${path}.type "${String(schema.type)}" is unsupported`);
    if (Object.hasOwn(schema, 'oneOf')) problems.push(`${path} cannot declare both type and oneOf`);
  } else if (!Object.hasOwn(schema, 'oneOf')) {
    problems.push(`${path} must declare type or oneOf`);
  }
  if (Object.hasOwn(schema, 'additionalProperties') && typeof schema.additionalProperties !== 'boolean') {
    problems.push(`${path}.additionalProperties must be a boolean`);
  }
  if (Object.hasOwn(schema, 'required')) {
    if (!Array.isArray(schema.required) || schema.required.some((entry) => typeof entry !== 'string')) {
      problems.push(`${path}.required must be an array of strings`);
    } else {
      const declared = schema.properties ?? {};
      for (const key of schema.required) {
        if (!Object.hasOwn(declared, key)) problems.push(`${path}.required names "${key}", which is not in properties`);
      }
    }
  }
  if (Object.hasOwn(schema, 'enum') && !Array.isArray(schema.enum)) problems.push(`${path}.enum must be an array`);
  if (Object.hasOwn(schema, 'properties')) {
    if (typeof schema.properties !== 'object' || schema.properties === null || Array.isArray(schema.properties)) {
      problems.push(`${path}.properties must be an object`);
    } else {
      for (const [key, child] of Object.entries(schema.properties)) checkSchemaSubset(child, `${path}.properties.${key}`, problems);
    }
  }
  if (Object.hasOwn(schema, 'items')) checkSchemaSubset(schema.items, `${path}.items`, problems);
}

/**
 * 用一份 schema 校验一个值(object/array/标量),只覆盖本自检需要的子集。
 * @param schema - schema 节点。
 * @param value - 待校验的值。
 * @param path - 诊断路径。
 * @param problems - 违规收集器。
 */
function validateValue(schema, value, path, problems) {
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    problems.push(`${path} must be one of ${schema.enum.join(' | ')}`);
    return;
  }
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      problems.push(`${path} must be an object`);
      return;
    }
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) problems.push(`${path}.${key} is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(properties, key)) {
        if (schema.additionalProperties === false) problems.push(`${path}.${key} is not a declared property`);
        continue;
      }
      validateValue(properties[key], child, `${path}.${key}`, problems);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      problems.push(`${path} must be an array`);
      return;
    }
    for (const [index, item] of value.entries()) validateValue(schema.items ?? {}, item, `${path}[${index}]`, problems);
    return;
  }
  if (schema.type === 'string' && typeof value !== 'string') problems.push(`${path} must be a string`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') problems.push(`${path} must be a boolean`);
}

// ---------------------------------------------------------------------------
// 桩 ctx:复现 Cordis 的 skills / effect / inject 三种交互
// ---------------------------------------------------------------------------

/**
 * 造一个宿主上下文桩。
 * @param options - `tools`/`webServer` 传 false 表示该服务缺席;`rejectProvider` 让注册抛错;`catalogSkills` 是目录内容。
 * @returns `{ ctx, state }`。
 */
function createHarness(options = {}) {
  const state = { providers: [], tools: [], routes: [], effects: 0, warnings: [] };
  let catalogSkills = options.catalogSkills ?? [];
  const skills = {
    snapshot: async () => ({ skills: catalogSkills, complete: true }),
    registerProvider(create) {
      if (options.rejectProvider === true) throw new Error('provider rejected');
      state.providers.push(create({ invalidate() {} }));
      return () => {};
    },
  };
  const service = {
    skills,
    logger: { warn: (message) => state.warnings.push(String(message)) },
    get: (key) => {
      if (key === 'skills') return skills;
      if (key === 'clientModules' && options.clientModules !== undefined) return options.clientModules;
      return undefined;
    },
    effect(fn) {
      state.effects += 1;
      const disposer = fn();
      return typeof disposer === 'function' ? disposer : () => {};
    },
    inject(names, callback) {
      const extra = {};
      if (names.includes('tools') && options.tools !== false) {
        extra.tools = { register: (definition) => { state.tools.push(definition); return () => {}; } };
      }
      if (names.includes('webServer') && options.webServer !== false) {
        extra.webServer = { register: (route) => { state.routes.push(route); return () => {}; } };
      }
      if (Object.keys(extra).length === 0) return;
      callback({ ...service, ...extra });
    },
  };
  return { ctx: service, state, setCatalogSkills: (next) => { catalogSkills = next; } };
}

// ---------------------------------------------------------------------------
// 1. 随包技能资产
// ---------------------------------------------------------------------------

/**
 * 列出技能包目录下的所有 Markdown 文件(相对路径)。
 * @param directory - 技能包目录。
 * @returns 相对路径数组。
 */
function markdownFiles(directory) {
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, relative);
      else if (entry.name.endsWith('.md')) found.push(relative);
    }
  };
  walk(directory, '');
  return found;
}

/**
 * 取一份 Markdown 里"表格行或链接"点到的技能内相对资源路径。
 * 正文里举例用的反引号路径(不在表格里)不算契约,含 `<`/`*`/`{` 的占位符也跳过。
 * @param markdown - 文件全文。
 * @returns 相对路径数组。
 */
function referencedPaths(markdown) {
  const found = new Set();
  const accept = (value) => {
    if (!/^(?:references|scripts|assets|templates)\//u.test(value)) return;
    if (/[<*{]/u.test(value)) return;
    found.add(value);
  };
  for (const line of markdown.split(/\r?\n/u)) {
    if (!line.trimStart().startsWith('|')) continue;
    for (const match of line.matchAll(/`([^`]+)`/gu)) accept(match[1].trim());
  }
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/gu)) accept(match[1].trim());
  return [...found];
}

const baseline = createHarness();
apply(baseline.ctx);

console.log('== 插件体 ==');
check('宿主半边导出 name/inject/apply', name === 'skill-center' && inject[0] === 'skills' && typeof apply === 'function');
check('注册了 1 个随包技能 provider', baseline.state.providers.length === 1, String(baseline.state.providers.length));
check('注册了 1 个模型工具', baseline.state.tools.length === 1, String(baseline.state.tools.length));
check('挂载了 1 条回环路由', baseline.state.routes.length === 1 && baseline.state.routes[0].kind === 'prefix' && baseline.state.routes[0].path === '/dsh-skill-center');

console.log('\n== 随包技能 ==');
const provider = baseline.state.providers[0];
check('provider 名不与 runtime 保留名冲突', provider.name === 'dsh-skill-center', provider.name);
const candidates = await provider.list();
check('候选列表非空', candidates.length >= 1, String(candidates.length));
const skillNames = candidates.map((candidate) => candidate.name);
check('包含 skill-authoring', skillNames.includes('skill-authoring'), skillNames.join(','));

for (const candidate of candidates) {
  const directory = candidate.resourceBase?.path;
  check(`[${candidate.name}] name 是 kebab-case`, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(candidate.name));
  check(`[${candidate.name}] description 非空`, typeof candidate.description === 'string' && candidate.description.length > 20);
  check(`[${candidate.name}] rank = 600(随包档,可被用户/项目同名技能盖过)`, candidate.rank === 600, String(candidate.rank));
  check(`[${candidate.name}] provider/source 正确`, candidate.provider === provider.name && candidate.source === 'bundled');
  check(`[${candidate.name}] invocation 是两个布尔`, candidate.invocation?.modelInvocable === true && candidate.invocation?.userInvocable === true);
  check(`[${candidate.name}] resourceBase 是真实存在的目录`, candidate.resourceBase?.kind === 'directory' && existsSync(directory) && statSync(directory).isDirectory(), String(directory));
  check(`[${candidate.name}] path 指向真实 SKILL.md`, typeof candidate.path === 'string' && existsSync(candidate.path), String(candidate.path));

  const raw = readFileSync(join(directory, 'SKILL.md'), 'utf8');
  const frontmatterBlock = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw)?.[1] ?? '';
  const frontmatterName = /^name:\s*(\S+)\s*$/mu.exec(frontmatterBlock)?.[1];
  check(`[${candidate.name}] frontmatter name == 目录名`, frontmatterName === candidate.name, String(frontmatterName));
  // 正文里会*举例*说明 camelCase 键被拒,所以只查 frontmatter 块。
  check(`[${candidate.name}] frontmatter 没有 camelCase 调用键`, !/disableModelInvocation|modelInvocable|userInvocable/u.test(frontmatterBlock));

  const definition = await provider.get(candidate);
  check(`[${candidate.name}] get() 返回正文且不含 frontmatter`, typeof definition.content === 'string' && definition.content.length > 100 && !definition.content.startsWith('---'));
  check(`[${candidate.name}] get() 保留 name/provider/resourceBase`, definition.name === candidate.name && definition.provider === provider.name && definition.resourceBase?.path === directory);
  const stripped = { rank: definition.rank, locator: definition.locator };
  check(`[${candidate.name}] get() 不带 rank/locator(注册表会校验)`, stripped.rank === undefined && stripped.locator === undefined);

  for (const file of markdownFiles(directory)) {
    const targets = referencedPaths(readFileSync(join(directory, file), 'utf8'));
    for (const target of targets) {
      check(`[${candidate.name}] ${file} 引用的资源存在: ${target}`, existsSync(join(directory, ...target.split('/'))));
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 工具 schema
// ---------------------------------------------------------------------------

console.log('\n== skill_create 定义 ==');
const tool = baseline.state.tools[0];
check('工具名是 skill_create', tool.name === 'skill_create', tool.name);
check('描述说明了用途与沙箱理由', typeof tool.description === 'string' && tool.description.length > 120 && tool.description.includes('workspace'));
const schemaProblems = [];
checkSchemaSubset(tool.parameters, 'parameters', schemaProblems);
checkSchemaSubset(tool.output.schema, 'output.schema', schemaProblems);
check('schema 落在 dsh-tools 支持的子集内', schemaProblems.length === 0, schemaProblems.join('; '));
check('参数必填只有 name/description', JSON.stringify(tool.parameters.required) === '["name","description"]');
check('参数不接受未声明字段', tool.parameters.additionalProperties === false);
check('root 参数是四个受管根的枚举', JSON.stringify(tool.parameters.properties.root.enum) === '["project-dsh","project-agents","user-dsh","user-agents"]');
check('resources 的每一项都要求 path+content', JSON.stringify(tool.parameters.properties.resources.items.required) === '["path","content"]');

// ---------------------------------------------------------------------------
// 3. 真跑一遍写入(全部在临时目录)
// ---------------------------------------------------------------------------

console.log('\n== skill_create 行为 ==');
const sandbox = mkdtempSync(join(tmpdir(), 'dsh-skill-center-check-'));
const agentsHome = join(sandbox, 'agents-home');
const dshHome = join(sandbox, 'dsh-home');
const project = join(sandbox, 'project');
mkdirSync(join(project, '.git'), { recursive: true });
process.env.DSH_AGENTS_HOME = agentsHome;
process.env.DSH_HOME = dshHome;

/** 造一个工具执行上下文。 */
const execAt = (cwd) => ({ agent: { session: { id: 'session-verify', header: { cwd } } } });
/**
 * 跑一次工具,返回 `{ ok, value, error }`。
 * @param args - 工具参数。
 * @param cwd - 会话工作目录。
 */
async function runTool(args, cwd = project) {
  try {
    return { ok: true, value: await tool.execute(args, execAt(cwd)) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
/** 断言一次调用失败,且错误里含某个关键词。 */
async function expectFailure(label, args, keyword, cwd = project) {
  const result = await runTool(args, cwd);
  check(label, result.ok === false && (keyword === undefined || result.error.includes(keyword)), result.ok ? '竟然成功了' : result.error);
  return result;
}

const created = await runTool({
  name: 'demo-skill',
  description: 'Use when checking the skill_create tool.',
  whenToUse: 'verification',
  body: '# Demo\n\nBody line.',
  resources: [
    { path: 'references/detail.md', content: '# Detail\n' },
    { path: 'scripts\\check.py', content: 'print(1)\n' },
  ],
});
check('默认根是 user-agents', created.ok === true && created.value.directory === join(agentsHome, 'skills', 'demo-skill'), created.error ?? created.value?.directory);
if (created.ok === true) {
  const text = readFileSync(created.value.skillFile, 'utf8');
  check('frontmatter 写入 name/description/whenToUse', /^---\nname: demo-skill\ndescription: "Use when checking the skill_create tool\."\nwhenToUse: "verification"\n---\n/u.test(text), text.slice(0, 120));
  check('正文与结尾换行写入', text.includes('# Demo\n\nBody line.\n'));
  check('反斜杠资源路径被归一化到子目录', existsSync(join(created.value.directory, 'references', 'detail.md')) && existsSync(join(created.value.directory, 'scripts', 'check.py')));
  check('返回值里带上资源相对路径', JSON.stringify(created.value.resources) === '["references/detail.md","scripts/check.py"]', JSON.stringify(created.value.resources));
  const outputProblems = [];
  validateValue(tool.output.schema, JSON.parse(JSON.stringify(created.value)), 'value', outputProblems);
  check('返回值符合 output.schema', outputProblems.length === 0, outputProblems.join('; '));
  const blocks = tool.output.render({}, created.value);
  check('render() 返回文本内容块', Array.isArray(blocks) && blocks[0]?.type === 'text' && blocks[0].text.includes('Created skill "demo-skill"'), JSON.stringify(blocks));
}

await expectFailure('重名(未传 overwrite)被拒绝', { name: 'demo-skill', description: 'again' }, '已存在');
const replaced = await runTool({
  name: 'demo-skill',
  description: 'Use when checking the skill_create tool.',
  body: '# Demo v2',
  overwrite: true,
  resources: [{ path: 'references/extra.md', content: '# Extra' }],
});
check('overwrite 覆盖并追加资源', replaced.ok === true && replaced.value.replaced === true && existsSync(join(replaced.value.directory, 'references', 'extra.md')), replaced.error ?? '');
check('overwrite 保留既有资源', existsSync(join(agentsHome, 'skills', 'demo-skill', 'references', 'detail.md')));
check('overwrite 重写正文', replaced.ok === true && readFileSync(replaced.value.skillFile, 'utf8').includes('# Demo v2'));

await expectFailure('非法技能名被拒绝', { name: 'Bad_Name', description: 'x' }, '不合法');
await expectFailure('缺 description 被拒绝', { name: 'no-description' }, 'description 必填');
await expectFailure('资源路径穿越被拒绝', { name: 'escape-skill', description: 'x', resources: [{ path: '../evil.md', content: 'x' }] }, '不合法');
await expectFailure('资源绝对路径被拒绝', { name: 'escape-skill', description: 'x', resources: [{ path: 'C:/evil.md', content: 'x' }] }, '不合法');
await expectFailure('资源占位 SKILL.md 被拒绝', { name: 'escape-skill', description: 'x', resources: [{ path: 'SKILL.md', content: 'x' }] }, '不合法');
check('穿越尝试没有在技能根外留下文件', !existsSync(join(agentsHome, 'evil.md')) && !existsSync(join(sandbox, 'evil.md')));

const projected = await runTool({ name: 'project-skill', description: 'Use when checking project scope.', root: 'project-agents' });
check('显式项目根可用(根目录不存在时也能建)', projected.ok === true && projected.value.directory === join(project, '.agents', 'skills', 'project-skill'), projected.error ?? projected.value?.directory);
await expectFailure('未知 root 被拒绝', { name: 'x-skill', description: 'x', root: 'nope' }, '未知的技能根');

const flatRoot = join(agentsHome, 'skills');
writeFileSync(join(flatRoot, 'flat-skill.md'), '---\nname: flat-skill\ndescription: "flat"\n---\n\n# flat\n');
await expectFailure('平坦文件承载资源被拒绝', { name: 'flat-skill', description: 'flat', overwrite: true, resources: [{ path: 'references/x.md', content: 'x' }] }, '平坦文件');
const flatRewritten = await runTool({ name: 'flat-skill', description: 'Use when rewriting a flat skill.', body: '# flat v2', overwrite: true });
check('平坦技能可以只覆盖主文件', flatRewritten.ok === true && readFileSync(join(flatRoot, 'flat-skill.md'), 'utf8').includes('# flat v2'), flatRewritten.error ?? '');

const collision = createHarness({ catalogSkills: [{ name: 'office-docx', description: 'embedded' }] });
apply(collision.ctx);
const collisionTool = collision.state.tools[0];
let collisionError;
try {
  await collisionTool.execute({ name: 'office-docx', description: 'x' }, execAt(project));
} catch (error) {
  collisionError = String(error?.message ?? error);
}
check('与内嵌技能重名时明确拒绝', typeof collisionError === 'string' && collisionError.includes('内嵌'), collisionError);

// ---------------------------------------------------------------------------
// 3b. 面板读到的调用策略以磁盘为准(目录快照是缓存的,可能是旧值)
// ---------------------------------------------------------------------------

console.log('\n== 面板数据以磁盘为准 ==');
const truthDir = join(agentsHome, 'skills', 'disk-truth');
mkdirSync(truthDir, { recursive: true });
const truthFile = join(truthDir, 'SKILL.md');
writeFileSync(truthFile, '---\nname: disk-truth\ndescription: "disk truth"\ndisable-model-invocation: true\nuser-invocable: false\n---\n\n# disk\n');
const outsideDir = join(sandbox, 'outside-skills', 'outside-truth');
mkdirSync(outsideDir, { recursive: true });
const outsideFile = join(outsideDir, 'SKILL.md');
writeFileSync(outsideFile, '---\nname: outside-truth\ndescription: "outside"\ndisable-model-invocation: true\n---\n\n# outside\n');

const stale = createHarness({
  catalogSkills: [
    {
      name: 'disk-truth',
      description: 'disk truth',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-skill-filesystem',
      source: 'user-agents',
      path: truthFile,
    },
    {
      name: 'outside-truth',
      description: 'outside',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-skill-filesystem',
      source: 'custom',
      path: outsideFile,
    },
  ],
});
apply(stale.ctx);
const staleRoute = stale.state.routes[0];
const staleRes = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
await staleRoute.handler({
  method: 'GET',
  url: `/dsh-skill-center/api?op=list&cwd=${encodeURIComponent(project)}`,
  socket: { remoteAddress: '127.0.0.1' },
  on() {},
}, staleRes);
check('GET list 正常返回', staleRes.status === 200, `${staleRes.status} ${String(staleRes.body).slice(0, 120)}`);
const staleSkills = JSON.parse(staleRes.body).skills;
const diskEntry = staleSkills.find((skill) => skill.name === 'disk-truth');
const outsideEntry = staleSkills.find((skill) => skill.name === 'outside-truth');
check(
  '受管根技能的策略取自磁盘 frontmatter(忽略过期快照)',
  diskEntry?.modelInvocable === false && diskEntry?.userInvocable === false,
  JSON.stringify({ model: diskEntry?.modelInvocable, user: diskEntry?.userInvocable }),
);
check('受管根技能标为可写', diskEntry?.writable === true);
check(
  '受管根之外的技能仍用快照值(不去读盘)',
  outsideEntry?.modelInvocable === true && outsideEntry?.userInvocable === true && outsideEntry?.writable === false,
  JSON.stringify({ model: outsideEntry?.modelInvocable, writable: outsideEntry?.writable }),
);

console.log('\n== diagnose 认得出浏览器半边 ==');
// 浏览器模块图按包名编号:diagnose 必须按包名找,否则永远报 inGraph:false。
const diag = createHarness({
  clientModules: {
    graph: () => ({
      rev: 'rev-abc',
      entries: [{ id: '@restregular/dsh-skill-center', url: '/plugins/@restregular/dsh-skill-center/client.js?rev=rev-abc' }],
    }),
  },
});
apply(diag.ctx);
const diagRes = { status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
await diag.state.routes[0].handler({
  method: 'GET',
  url: `/dsh-skill-center/api?op=diagnose&cwd=${encodeURIComponent(project)}`,
  socket: { remoteAddress: '127.0.0.1' },
  on() {},
}, diagRes);
const diagPayload = JSON.parse(diagRes.body);
check(
  '按包名命中模块图条目(inGraph=true)',
  diagPayload.client.inGraph === true && diagPayload.client.entryId === '@restregular/dsh-skill-center',
  JSON.stringify(diagPayload.client),
);
check(
  '回报带 rev 的 bundle URL',
  typeof diagPayload.client.url === 'string' && diagPayload.client.url.includes('rev=rev-abc'),
  String(diagPayload.client.url),
);

// ---------------------------------------------------------------------------
// 4. 降级:任何一块缺服务/失败都不该炸宿主
// ---------------------------------------------------------------------------

console.log('\n== 回收站 ==');
/**
 * 打一次回环路由。
 * @param route - 路由处理器。
 * @param method - GET / POST。
 * @param query - 查询串(GET)。
 * @param body - 请求体(POST)。
 * @returns `{ status, payload }`。
 */
async function callRoute(route, method, query, body) {
  const request = {
    method,
    url: query === undefined ? '/dsh-skill-center/api' : `/dsh-skill-center/api?${query}`,
    socket: { remoteAddress: '127.0.0.1' },
    on(event, callback) {
      if (event === 'data' && body !== undefined) callback(Buffer.from(JSON.stringify(body)));
      if (event === 'end') callback();
      return request;
    },
  };
  const response = {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; },
    end(chunk) { this.body = chunk; },
  };
  await route.handler(request, response);
  return { status: response.status, payload: JSON.parse(response.body) };
}

const trashDir = join(agentsHome, 'skills', 'trash-me');
mkdirSync(trashDir, { recursive: true });
const trashFile = join(trashDir, 'SKILL.md');
writeFileSync(trashFile, '---\nname: trash-me\ndescription: "Use when testing trash."\n---\n\n# trash\n');
const trashSkill = {
  name: 'trash-me',
  description: 'Use when testing trash.',
  provider: 'dsh-skill-filesystem',
  source: 'user-agents',
  path: trashFile,
};
const trashHarness = createHarness({ catalogSkills: [trashSkill] });
apply(trashHarness.ctx);
const trashRoute = trashHarness.state.routes[0];
const cwdQuery = `cwd=${encodeURIComponent(project)}`;

const deleted = await callRoute(trashRoute, 'POST', undefined, { op: 'delete', name: 'trash-me', cwd: project });
check('delete 把技能移进 .trash', deleted.payload.ok === true && !existsSync(trashDir), JSON.stringify(deleted.payload));
trashHarness.setCatalogSkills([]);
const trashList = await callRoute(trashRoute, 'GET', `op=trash&${cwdQuery}`);
const trashEntry = trashList.payload.entries?.find((entry) => entry.name === 'trash-me');
check('GET trash 列出条目(带根与种类)', trashEntry !== undefined && trashEntry.rootId === 'user-agents' && trashEntry.kind === 'directory', JSON.stringify(trashList.payload));
check('条目带删除时间与 .trash 路径', Number.isFinite(trashEntry?.stamp) && String(trashEntry?.path).includes('.trash'), JSON.stringify(trashEntry));
const withTrash = await callRoute(trashRoute, 'GET', `op=list&${cwdQuery}`);
check('list 回报回收站条数', withTrash.payload.counts?.trash === 1, JSON.stringify(withTrash.payload.counts));

const traversal = await callRoute(trashRoute, 'POST', undefined, {
  op: 'restore', rootId: 'user-agents', entry: '../evil', cwd: project,
});
check('restore 拒绝路径穿越', traversal.payload.ok === false && String(traversal.payload.error).includes('非法'), JSON.stringify(traversal.payload));

const restored = await callRoute(trashRoute, 'POST', undefined, {
  op: 'restore', rootId: 'user-agents', entry: trashEntry.entry, cwd: project,
});
check('restore 把技能移回原根', restored.payload.ok === true && existsSync(trashFile), JSON.stringify(restored.payload));

// 目标已存在时必须拒绝,绝不覆盖磁盘上的同名技能。
trashHarness.setCatalogSkills([trashSkill]);
await callRoute(trashRoute, 'POST', undefined, { op: 'delete', name: 'trash-me', cwd: project });
trashHarness.setCatalogSkills([]);
mkdirSync(trashDir, { recursive: true });
writeFileSync(trashFile, '---\nname: trash-me\ndescription: "placeholder"\n---\n\n# placeholder\n');
const conflictList = await callRoute(trashRoute, 'GET', `op=trash&${cwdQuery}`);
const conflictEntry = conflictList.payload.entries?.find((entry) => entry.name === 'trash-me');
const conflict = await callRoute(trashRoute, 'POST', undefined, {
  op: 'restore', rootId: 'user-agents', entry: conflictEntry.entry, cwd: project,
});
check('目标已存在时 restore 拒绝覆盖', conflict.payload.ok === false && String(conflict.payload.error).includes('已存在'), JSON.stringify(conflict.payload));
rmSync(trashDir, { recursive: true, force: true });

const emptied = await callRoute(trashRoute, 'POST', undefined, { op: 'emptyTrash', cwd: project });
check('emptyTrash 永久删除条目', emptied.payload.ok === true && emptied.payload.removed >= 1 && readdirSync(join(agentsHome, 'skills', '.trash')).length === 0, JSON.stringify(emptied.payload));

// 平坦技能(`<name>.md`)进回收站后是文件,恢复也必须回到 `<name>.md`。
writeFileSync(join(agentsHome, 'skills', 'flat-bin.md'), '---\nname: flat-bin\ndescription: "flat bin"\n---\n\n# flat\n');
trashHarness.setCatalogSkills([{
  name: 'flat-bin',
  description: 'flat bin',
  provider: 'dsh-skill-filesystem',
  source: 'user-agents',
  path: join(agentsHome, 'skills', 'flat-bin.md'),
}]);
await callRoute(trashRoute, 'POST', undefined, { op: 'delete', name: 'flat-bin', cwd: project });
trashHarness.setCatalogSkills([]);
const flatList = await callRoute(trashRoute, 'GET', `op=trash&${cwdQuery}`);
const flatEntry = flatList.payload.entries?.find((entry) => entry.name === 'flat-bin');
check('平坦技能进回收站后是 .md 文件', flatEntry?.kind === 'file', JSON.stringify(flatEntry));
const flatBack = await callRoute(trashRoute, 'POST', undefined, {
  op: 'restore', rootId: 'user-agents', entry: flatEntry.entry, cwd: project,
});
check('平坦技能可恢复成 <name>.md', flatBack.payload.ok === true && existsSync(join(agentsHome, 'skills', 'flat-bin.md')), JSON.stringify(flatBack.payload));
await callRoute(trashRoute, 'POST', undefined, { op: 'emptyTrash', cwd: project });

console.log('\n== 降级 ==');
const minimal = createHarness({ tools: false, webServer: false });
let minimalThrew;
try {
  apply(minimal.ctx);
} catch (error) {
  minimalThrew = String(error?.message ?? error);
}
check('缺 tools / webServer 时 apply 不抛错', minimalThrew === undefined, minimalThrew);
check('缺 tools / webServer 时随包技能仍注册', minimal.state.providers.length === 1 && minimal.state.tools.length === 0 && minimal.state.routes.length === 0);

const rejecting = createHarness({ rejectProvider: true });
let rejectThrew;
try {
  apply(rejecting.ctx);
} catch (error) {
  rejectThrew = String(error?.message ?? error);
}
check('provider 注册抛错时 apply 不抛错', rejectThrew === undefined, rejectThrew);
check('provider 注册抛错时留下一条警告', rejecting.state.warnings.some((line) => line.includes('随包技能未能注册')), rejecting.state.warnings.join(' | '));

console.log(`\n${checks} 项检查,${failures.length === 0 ? 'SKILL OK' : `FAILURES: ${failures.join(' | ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
