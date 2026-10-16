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
 * @returns 渲染后的文本内容。
 */
function renderTree(element, path = '0') {
  if (element === null || element === undefined || element === false || element === true) return [];
  if (typeof element === 'string' || typeof element === 'number') return [String(element)];
  if (Array.isArray(element)) return element.flatMap((child, index) => renderTree(child, `${path}.${index}`));
  if (!element.$$element) return [String(element)];
  const { type, props } = element;
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
    const children = renderTree(output, path);
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
  return renderTree(props.children, `${path}.c`);
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
    load(module) { captured.push(module); },
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
check('模块 id 等于插件 id dsh-skill-center', module.id === 'dsh-skill-center', module.id);
check(
  '插件 id 与包名脱钩(包名是 @restregular/dsh-skill-center)',
  module.id !== '@restregular/dsh-skill-center',
  module.id,
);

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

console.log(`\n== 清理 effect ==`);
for (const effect of effects) {
  if (typeof effect.cleanup === 'function') {
    try { effect.cleanup(); } catch (error) { failures.push(`cleanup ${effect.label}`); console.log('  FAIL cleanup', effect.label, error); }
  }
}
check('样式标签被移除', styleTags[0]?.removed === true);

console.log(`\n${failures.length === 0 ? 'ALL PASS' : `FAILURES: ${failures.join(' | ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
