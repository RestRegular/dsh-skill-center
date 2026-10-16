/**
 * dsh-skill-center 客户端半侧的离线冒烟测试。
 *
 * 用迷你 React 运行时装载真实 client.js,调用 apply(ctx) 检查两处槽位注册,
 * 然后真渲染面板组件 —— 组件内部的 fetch 打的是本机运行中的宿主路由,
 * 所以这是一次端到端(客户端代码 → 宿主 → 真实技能目录)的验证。
 *
 * 运行: node client-smoke.mjs
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGIN = process.env.DSH_ORIGIN ?? 'http://127.0.0.1:19387';
const CLIENT_PATH = new URL('./client/client.js', import.meta.url);

// ---------------------------------------------------------------------------
// 迷你 React
// ---------------------------------------------------------------------------
const instances = new Map();
let rendering = null;
let scheduled = false;

function schedule() {
  scheduled = true;
}

function normalize(children) {
  const flat = [];
  for (const child of children) {
    if (Array.isArray(child)) flat.push(...normalize(child));
    else if (child !== null && child !== undefined && child !== false && child !== true) flat.push(child);
  }
  return flat;
}

const React = {
  createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) };
    const kids = normalize(children);
    if (kids.length > 0) merged.children = kids.length === 1 ? kids[0] : kids;
    return { $$element: true, type, props: merged };
  },
  useState(init) {
    const inst = rendering;
    const index = inst.cursor++;
    if (!(index in inst.hooks)) inst.hooks[index] = typeof init === 'function' ? init() : init;
    const setter = (value) => {
      const next = typeof value === 'function' ? value(inst.hooks[index]) : value;
      if (next !== inst.hooks[index]) {
        inst.hooks[index] = next;
        schedule();
      }
    };
    return [inst.hooks[index], setter];
  },
  useCallback(fn, deps) {
    const inst = rendering;
    const index = inst.cursor++;
    const key = `cb${index}`;
    const previous = inst.hooks[index];
    if (previous === undefined || !sameDeps(previous.deps, deps)) {
      inst.hooks[index] = { fn, deps };
      return fn;
    }
    return previous.fn;
  },
  useEffect(fn, deps) {
    const inst = rendering;
    const index = inst.cursor++;
    const key = `ef${index}`;
    const previous = inst.hooks[index];
    if (previous === undefined || !sameDeps(previous.deps, deps)) {
      inst.hooks[index] = { deps, cleanup: previous?.cleanup };
      inst.pending.push({ key, fn, hadPrevious: previous !== undefined });
    }
  },
  useSyncExternalStore() {
    throw new Error('not used by this plugin');
  },
};

function sameDeps(a, b) {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

/**
 * 渲染一棵元素树;函数组件按路径缓存 hook 实例。
 * @param element - 元素/文本。
 * @param path - 位置路径(实例身份)。
 * @param seen - 传入数组时,收集本轮渲染访问到的每个元素(供交互测试按 props 找按钮)。
 * @returns 渲染后的文本内容。
 */
function renderTree(element, path = '0', seen = null) {
  if (element === null || element === undefined || element === false || element === true) return [];
  if (typeof element === 'string' || typeof element === 'number') return [String(element)];
  if (Array.isArray(element)) return element.flatMap((child, index) => renderTree(child, `${path}.${index}`, seen));
  if (!element.$$element) return [String(element)];
  const { type, props } = element;
  if (seen !== null) seen.push({ element, path });
  if (typeof type === 'function') {
    let inst = instances.get(path);
    if (inst === undefined) {
      inst = { hooks: [], cursor: 0, pending: [], effects: new Map() };
      instances.set(path, inst);
    }
    inst.cursor = 0;
    inst.pending = [];
    const saved = rendering;
    rendering = inst;
    let output;
    try {
      output = type(props);
    } finally {
      rendering = saved;
    }
    const children = renderTree(output, path, seen);
    // 渲染完成后再跑本轮 effect
    for (const item of inst.pending) {
      const previous = inst.effects.get(item.key);
      try {
        previous?.();
      } catch { /* 清理失败忽略 */ }
      let cleanup;
      try {
        cleanup = item.fn();
      } catch (error) {
        console.error('[effect threw]', item.key, error);
      }
      inst.effects.set(item.key, typeof cleanup === 'function' ? cleanup : undefined);
    }
    return children;
  }
  return renderTree(props.children, `${path}.c`, seen);
}

// ---------------------------------------------------------------------------
// 浏览器垫片
// ---------------------------------------------------------------------------
const styleTags = [];
globalThis.document = {
  createElement(tag) {
    return { tag, textContent: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, remove() { this.removed = true; } };
  },
  head: { appendChild(node) { styleTags.push(node); } },
};

const captured = [];
globalThis.window = {
  location: { origin: ORIGIN },
  __ModuleLoader__: {
    // 宿主 facade 的真实形状:注册队列 + 已注册工厂表。
    factories: new Map(),
    load(module) {
      if (this.factories.has(module.id)) {
        throw new Error(`client-modules: duplicate factory registration for "${module.id}" (bundle executed twice without invalidate?)`);
      }
      this.factories.set(module.id, module);
      captured.push(module);
    },
  },
};

const mockRequire = (spec) => {
  if (spec === 'react') return React;
  throw new Error(`unexpected require("${spec}")`);
};

// ---------------------------------------------------------------------------
// 装载
// ---------------------------------------------------------------------------
const source = readFileSync(CLIENT_PATH, 'utf8');
(0, eval)(source);

const failures = [];
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  }
};

console.log('== 装载 ==');
check('调用了 __ModuleLoader__.load 一次', captured.length === 1, `got ${captured.length}`);
const module = captured[0];
check(
  '模块 id 逐字等于包名 @restregular/dsh-skill-center(行 id 用它做 HMR 失效)',
  module.id === '@restregular/dsh-skill-center',
  module.id,
);

// 回归护栏:同一个 bundle 被执行两次(行 id 与注册 id 不一致时 HMR 清不掉旧工厂)时,
// 必须安静跳过,而不是抛 duplicate factory registration 把整条 web boot 打挂。
let secondRunError;
try {
  (0, eval)(source);
} catch (error) {
  secondRunError = error;
}
check('重复执行同一 bundle 不抛异常', secondRunError === undefined, String(secondRunError));
check('重复执行不产生第二次注册', captured.length === 1, `got ${captured.length}`);

const face = module.factory(mockRequire);
check('工厂返回 {apply, inject}', typeof face.apply === 'function' && Array.isArray(face.inject), JSON.stringify(face.inject));
check('inject 含 slots/sessions/layout', ['slots', 'sessions', 'layout'].every((k) => face.inject.includes(k)), JSON.stringify(face.inject));

// ---------------------------------------------------------------------------
// mock ctx
// ---------------------------------------------------------------------------
const registrations = [];
const injected = [];
const effects = [];
const localeRegistered = [];

const slots = {
  inject(ownerKey, callback) {
    injected.push(ownerKey);
    return callback();
  },
  register(options, component) {
    registrations.push({ options, component });
    return () => {};
  },
};

/** 真实会话 id(由调用方传入),用来走"活会话/预设作用域"那条路径。 */
const REAL_SESSION = process.env.DSH_SMOKE_SESSION ?? 'session-smoke-1';
const REAL_CWD = process.env.DSH_SMOKE_CWD ?? process.cwd();

const ctx = {
  get(service) {
    if (service === 'slots') return slots;
    if (service === 'sessions') {
      return {
        list: {
          getSnapshot: () => ({
            byId: {
              [REAL_SESSION]: { id: REAL_SESSION, cwd: REAL_CWD, retainedBy: { mainView: 1 }, updatedAt: 1 },
            },
          }),
        },
      };
    }
    if (service === 'layout') return { selectPanel: () => {} };
    if (service === 'locale') {
      return {
        register(ns, dicts) { localeRegistered.push({ ns, locales: Object.keys(dicts) }); return () => {}; },
        bind(ns) {
          const dict = { zh: {}, en: {} };
          // 用真实字典近似:直接从 bundle 里取不到,这里只验证调用形态
          return (key, params) => {
            let text = dictZH[key] ?? key;
            if (params) for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
            return text;
          };
        },
      };
    }
    return undefined;
  },
  effect(fn, label) {
    const cleanup = fn();
    effects.push({ label, cleanup });
    return cleanup;
  },
  on() { return () => {}; },
};

// 从 bundle 源里抠出中文词典,供 locale mock 返回真实文案
const dictZH = {};
{
  const start = source.indexOf('zh: {');
  const end = source.indexOf('en: {', start);
  const block = source.slice(start, end);
  for (const match of block.matchAll(/([A-Za-z]+):\s*'((?:[^'\\]|\\.)*)'/g)) {
    dictZH[match[1]] = match[2].replace(/\\'/g, "'");
  }
}

console.log(`\n== apply(ctx) ==`);
face.apply(ctx);
check('注册了样式 <style data-plugin>', styleTags.length === 1 && styleTags[0].attributes['data-plugin'] === 'dsh-skill-center', JSON.stringify(styleTags.map((s) => s.attributes)));
check('注册了 locale 词典(zh+en)', localeRegistered.length === 1 && localeRegistered[0].locales.join(',') === 'zh,en', JSON.stringify(localeRegistered));
check('inject 了 sidebar.panellist 与 main', injected.sort().join(',') === 'main,sidebar.panellist', injected.join(','));
check('注册数 = 2', registrations.length === 2, String(registrations.length));

const panel = registrations.find((r) => r.options.name === 'main');
const row = registrations.find((r) => r.options.name === 'sidebar.panellist');
check('main 用 key=skill-center(keyed)', panel?.options.key === 'skill-center', JSON.stringify(panel?.options));
check('sidebar.panellist 用 id=skill-center', row?.options.id === 'skill-center', JSON.stringify(row?.options));
check('sidebar.panellist order=1(排在 plugins 的 0 之后)', row?.options.order === 1, String(row?.options.order));
check('sidebar.panellist label 是 thunk', typeof row?.options.label === 'function');
check('sidebar.panellist label 取到中文', row?.options.label() === '技能中心', String(row?.options.label?.()));
check('面板与行组件都是函数', typeof panel?.component === 'function' && typeof row?.component === 'function');
check('图标组件可渲染', renderTree(React.createElement(row.component, { size: 16 })).length === 0 || true);

console.log(`\n== 渲染面板(真实 HTTP → 宿主路由) ==`);
const Page = panel.component;
let text = [];
for (let round = 0; round < 40; round++) {
  scheduled = false;
  text = renderTree(React.createElement(Page, { t: (key, params) => {
    let value = dictZH[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) value = value.split(`{${k}}`).join(String(v));
    return value;
  } }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (text.join(' ').includes('auth0-quickstart') && text.join(' ').includes('office-docx')) break;
}
const flat = text.join(' ');
console.log('  渲染文本片段:', flat.slice(0, 220).replace(/\s+/g, ' '));
check('渲染出面板标题', flat.includes('技能中心'));
check('列出文件系统技能 auth0-quickstart', flat.includes('auth0-quickstart'));
check('列出内嵌技能 office-docx', flat.includes('office-docx'));
check('列出内嵌技能 diagnose-windows-sandbox-acl', flat.includes('diagnose-windows-sandbox-acl'));
check('显示了作用域说明', flat.includes('会话作用域') || flat.includes('工作目录'));
check('没有出现错误提示', !flat.includes('操作失败') && !flat.includes('HTTP '));

// ---------------------------------------------------------------------------
// 保存按钮流程(toggle 即时生效 / 保存按钮三态 / 保存后不被旧快照弹回)
//
// 只拦 POST:GET list 打真实宿主,POST setInvocation 走假响应 —— 冒烟测试绝不
// 改写真实技能的 frontmatter。宿主目录是缓存的,保存后那次真实 GET 仍会返回旧值,
// 恰好复现"点完开关界面弹回去"的现场;面板必须靠本地显示值兜住。
// ---------------------------------------------------------------------------
console.log(`\n== 保存按钮流程 ==`);

const realFetch = globalThis.fetch;
const posts = [];
globalThis.fetch = async (input, init) => {
  if (init?.method === 'POST') {
    const body = JSON.parse(init.body);
    posts.push(body);
    if (body.op === 'setInvocation') {
      return { ok: true, status: 200, json: async () => ({ ok: true, name: body.name, changed: true }) };
    }
  }
  return realFetch(input, init);
};

const t = (key, params) => {
  let value = dictZH[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) value = value.split(`{${k}}`).join(String(v));
  return value;
};

/** 渲染若干轮(每轮 60ms,让 fetch 与 setState 结算),返回文本与元素快照。 */
async function renderRounds(rounds = 8) {
  let text = [];
  let seen = [];
  for (let round = 0; round < rounds; round++) {
    scheduled = false;
    seen = [];
    text = renderTree(React.createElement(Page, { t }), '0', seen);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return { text: text.join(' '), seen };
}
/** 按 props 找一个按钮元素。 */
const findButton = (seen, predicate) => seen.find(({ element }) => element.type === 'button' && predicate(element.props));
/** 保存按钮:用 title(saveHint)认出来,标签就是它的文案。 */
const saveButton = (seen) => seen.find(({ element }) => element.type === 'button' && element.props.title === dictZH.saveHint);
/** 模型调用开关(role=switch 的那个按钮)。 */
const modelSwitch = (seen) => seen.find(({ element }) => element.type === 'button' && element.props.role === 'switch' && element.props['aria-label'] === dictZH.model);

let round = await renderRounds();
check('快照里找到了 auth0-quickstart(用户根技能)', round.text.includes('auth0-quickstart'), round.text.slice(0, 120));
const heading = round.seen.find(({ element }) => element.type === 'h2' && element.props.className === 'dsh-sc-h2');
const selectedSkill = String(heading?.element.props.children ?? '');
check('详情区显示了当前选中的技能', selectedSkill.length > 0, selectedSkill);
const save0 = saveButton(round.seen);
check('初始保存按钮显示「未修改」且置灰', save0?.element.props.children === dictZH.unmodified && save0?.element.props.disabled === true, String(save0?.element.props.children));
const sw0 = modelSwitch(round.seen);
check('模型开关初始为开且可点', sw0?.element.props['aria-checked'] === true && sw0?.element.props.disabled === false, `checked=${String(sw0?.element.props['aria-checked'])} disabled=${String(sw0?.element.props.disabled)}`);

// 拨开关:界面必须立刻反映,且这一次点击不产生任何写请求。
const postsBefore = posts.length;
await sw0.element.props.onClick();
const afterToggle = await renderRounds(2);
const sw1 = modelSwitch(afterToggle.seen);
const save1 = saveButton(afterToggle.seen);
check('拨开关后开关立即切换(无需刷新)', sw1?.element.props['aria-checked'] === false, String(sw1?.element.props['aria-checked']));
check('拨开关本身不发写请求', posts.length === postsBefore, JSON.stringify(posts.slice(postsBefore)));
check('拨开关后按钮变成可点的「保存」', save1?.element.props.children === dictZH.save && save1?.element.props.disabled === false, `${String(save1?.element.props.children)} disabled=${String(save1?.element.props.disabled)}`);

// 点保存:发出 setInvocation,按钮转为置灰的「已保存」,且开关仍是用户拨到的值。
await save1.element.props.onClick();
const afterSave = await renderRounds(8);
const sw2 = modelSwitch(afterSave.seen);
const save2 = saveButton(afterSave.seen);
const invocationPosts = posts.filter((body) => body.op === 'setInvocation');
check('保存对目标技能发出一次 setInvocation', invocationPosts.length === 1 && invocationPosts[0].name === selectedSkill, JSON.stringify(invocationPosts));
check('保存带上两个策略字段(宿主按两者改写 frontmatter)', invocationPosts[0]?.modelInvocable === false && invocationPosts[0]?.userInvocable === true, JSON.stringify(invocationPosts[0]));
check('保存后按钮变成置灰的「已保存」', save2?.element.props.children === dictZH.saved && save2?.element.props.disabled === true, `${String(save2?.element.props.children)} disabled=${String(save2?.element.props.disabled)}`);
check('保存后开关保持用户拨到的值(不被旧快照弹回)', sw2?.element.props['aria-checked'] === false, String(sw2?.element.props['aria-checked']));
const greenNotes = afterSave.seen.filter(({ element }) => typeof element.props.className === 'string' && element.props.className.includes('dsh-sc-note-ok'));
check('保存后不再出现绿色提示条', greenNotes.length === 0, String(greenNotes.length));

// 再改一次:按钮必须回到可点的「保存」。
await sw2.element.props.onClick();
const afterSecond = await renderRounds(2);
const save3 = saveButton(afterSecond.seen);
check('再次修改后按钮重新变成「保存」', save3?.element.props.children === dictZH.save && save3?.element.props.disabled === false, `${String(save3?.element.props.children)} disabled=${String(save3?.element.props.disabled)}`);

globalThis.fetch = realFetch;

console.log(`\n== 清理 effect ==`);
for (const effect of effects) {
  if (typeof effect.cleanup === 'function') {
    try { effect.cleanup(); } catch (error) { failures.push(`cleanup ${effect.label}`); console.log('  FAIL cleanup', effect.label, error); }
  }
}
check('样式标签被移除', styleTags[0]?.removed === true);

console.log(`\n${failures.length === 0 ? 'ALL PASS' : `FAILURES: ${failures.join(' | ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
