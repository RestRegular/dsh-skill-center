/**
 * dsh-skill-center — Client half.
 *
 * 两处注册:
 *   1. `sidebar.panellist`(list, root)— 侧栏全局面板列表里的一行图标 + 标签,
 *      `order: 1` 使其排在 `plugins`(order 0)下方;
 *   2. `main`(keyed, root, key = "skill-center")— 中央区域的面板本体。
 *
 * 注册 id **必须逐字等于包名**(`@restregular/dsh-skill-center`)。浏览器模块图是按
 * 包名给行编号的,`ClientModuleSystem.invalidate`/`reload`(HMR 的 `rebuilt` 帧走的
 * 就是它)只按**行 id** 清理工厂表:注册 id 与行 id 不一致时,旧工厂不会被删掉,
 * 新版 bundle 一到就撞成
 * `client-modules: duplicate factory registration ... (bundle executed twice without invalidate?)`,
 * 于是整条 web boot 变成 "1 entry did not activate"。
 *
 * 数据与写操作全部走宿主同源回环路由 `/dsh-skill-center/api`(见 ../lib/index.js)。
 * 样式只用宿主主题令牌 `--dsw-*`,不 import 任何 Harness Client 包。
 */
const MODULE_ID = '@restregular/dsh-skill-center';

/** 该 id 是否已经注册过工厂(宿主 facade 暴露 factories 表;取不到就当作没注册)。 */
function alreadyRegistered() {
  const factories = window.__ModuleLoader__?.factories;
  return factories !== undefined && typeof factories.has === 'function' && factories.has(MODULE_ID);
}

if (!alreadyRegistered()) {
window.__ModuleLoader__.load({
  id: MODULE_ID,
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const OWNER = 'dsh-skill-center';
    const PANEL_ID = 'skill-center';
    const NS = 'skill-center';
    const API = '/dsh-skill-center/api';

    // ------------------------------------------------------------------
    // 文案
    // ------------------------------------------------------------------
    const DICT = {
      zh: {
        panel: '技能中心',
        title: '技能中心',
        subtitle: '管理当前会话可见的技能',
        search: '搜索名称或描述',
        refresh: '刷新',
        loading: '正在读取技能目录…',
        empty: '没有匹配的技能',
        emptyAll: '当前技能目录是空的',
        create: '新建技能',
        createSubmit: '创建',
        formName: '名称(kebab-case)',
        formDesc: '描述(必填)',
        formBody: '正文(Markdown,可选)',
        formRoot: '写入位置',
        delete: '删除',
        deleteConfirm: '确认删除?',
        deleteHint: '删除会把技能移动到同根目录的 .trash 下,可手动恢复。',
        deleted: '已移动到 .trash',
        preview: '正文',
        previewHide: '收起正文',
        reloadBody: '读取正文',
        provider: '提供方',
        source: '来源',
        path: '路径',
        size: '大小',
        model: '模型可调用',
        user: '用户可调用',
        modelHint: '关闭后该技能不会出现在模型技能目录里,skill 工具也会拒绝加载。',
        userHint: '关闭后该技能不会出现在 / 菜单里。',
        root: '技能根目录',
        incomplete: '技能目录读取不完整(部分提供方不可用)',
        scopeLive: '当前会话作用域',
        scopePreset: '会话预设作用域',
        scopeCwd: '未绑定会话,按工作目录读取',
        filterAll: '全部来源',
        total: '{n} 个技能',
        shown: '显示 {n} / {m}',
        whenToUse: '何时使用',
        internalOnly: '该技能由插件内嵌提供,只能查看,不能改写或删除。',
        noBody: '(正文为空)',
        created: '已创建',
        saved: '已保存',
        back: '返回会话',
        retry: '重试',
        modelOff: '模型关闭',
        userOff: '用户关闭',
        embedded: '内嵌',
      },
      en: {
        panel: 'Skill Center',
        title: 'Skill Center',
        subtitle: 'Manage the skills visible to this session',
        search: 'Search name or description',
        refresh: 'Refresh',
        loading: 'Reading the skill catalog…',
        empty: 'No matching skills',
        emptyAll: 'This skill catalog is empty',
        create: 'New skill',
        createSubmit: 'Create',
        formName: 'Name (kebab-case)',
        formDesc: 'Description (required)',
        formBody: 'Body (Markdown, optional)',
        formRoot: 'Write to',
        delete: 'Delete',
        deleteConfirm: 'Confirm delete?',
        deleteHint: 'Delete moves the skill into a .trash folder under the same root; restore it by hand.',
        deleted: 'Moved to .trash',
        preview: 'Body',
        previewHide: 'Hide body',
        reloadBody: 'Load body',
        provider: 'Provider',
        source: 'Source',
        path: 'Path',
        size: 'Size',
        model: 'Model invocation',
        user: 'User invocation',
        modelHint: 'When off, the skill leaves the model catalog and the skill tool refuses to load it.',
        userHint: 'When off, the skill disappears from the / menu.',
        root: 'Skill root',
        incomplete: 'The catalog read was incomplete (some providers were unavailable)',
        scopeLive: 'Current session scope',
        scopePreset: 'Session preset scope',
        scopeCwd: 'No session bound; read from the working directory',
        filterAll: 'All sources',
        total: '{n} skills',
        shown: 'Showing {n} of {m}',
        whenToUse: 'When to use',
        internalOnly: 'This skill is embedded in a plugin: it can be viewed but not edited or deleted.',
        noBody: '(empty body)',
        created: 'Created',
        saved: 'Saved',
        back: 'Back to session',
        retry: 'Retry',
        modelOff: 'model off',
        userOff: 'user off',
        embedded: 'embedded',
      },
    };

    /** 无 locale 服务时的兜底取词(带 `{name}` 插值)。 */
    function fallbackText(key, params) {
      let text = DICT.zh[key] ?? key;
      if (params !== undefined && params !== null) {
        for (const [name, value] of Object.entries(params)) {
          text = text.split(`{${name}}`).join(String(value));
        }
      }
      return text;
    }

    /**
     * 建一个归属本插件的 <style>。
     * 必须打 `data-plugin`:宿主在模块工厂跑完后会认领"无主 style",
     * 被认领的标签会随该模块的下一次变更一起删除。
     * @param css - 样式文本。
     * @returns 插入的 style 元素。
     */
    function createOwnedStyle(css) {
      const el = document.createElement('style');
      el.setAttribute('data-plugin', OWNER);
      el.textContent = css;
      document.head.appendChild(el);
      return el;
    }

    const CSS = `
.dsh-sc-root{display:flex;flex-direction:column;height:100%;min-height:0;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.dsh-sc-head{display:flex;flex-direction:column;gap:10px;padding:14px 20px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.dsh-sc-headrow{display:flex;align-items:baseline;gap:10px;min-width:0}
.dsh-sc-title{font-size:15px;font-weight:600;white-space:nowrap}
.dsh-sc-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-spacer{flex:1}
.dsh-sc-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-sc-input{flex:1;min-width:140px;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;outline:none}
.dsh-sc-input:focus-visible{border-color:var(--dsw-alias-state-business-primary)}
.dsh-sc-select{padding:6px 8px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit}
.dsh-sc-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;cursor:pointer;line-height:1.4;white-space:nowrap}
.dsh-sc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-sc-btn:disabled{opacity:.45;cursor:default}
.dsh-sc-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}
.dsh-sc-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsh-sc-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-sc-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-sc-body{display:flex;flex:1;min-height:0}
.dsh-sc-list{width:288px;flex:none;overflow:auto;border-right:1px solid var(--dsw-alias-border-l2);padding:8px}
.dsh-sc-row{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:none;background:transparent;color:inherit;cursor:pointer;font:inherit}
.dsh-sc-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsh-sc-row-on{background:var(--dsw-alias-interactive-bg-active)}
.dsh-sc-name{font-weight:600;word-break:break-all}
.dsh-sc-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-sc-meta{display:flex;gap:5px;align-items:center;flex-wrap:wrap;color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-sc-badge{padding:0 6px;border-radius:var(--dsw-radius-xs,4px);border:.5px solid var(--dsw-alias-border-l3);line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-sc-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsh-sc-detail{flex:1;min-width:0;overflow:auto;padding:18px 22px 32px}
.dsh-sc-h2{font-size:15px;font-weight:600;margin:0 0 6px;word-break:break-all}
.dsh-sc-p{color:var(--dsw-alias-label-secondary);margin:0 0 16px;white-space:pre-wrap;word-break:break-word}
.dsh-sc-section{margin:0 0 18px}
.dsh-sc-label{color:var(--dsw-alias-label-caption);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.dsh-sc-kv{display:grid;grid-template-columns:84px 1fr;gap:4px 10px;font-size:12px;margin:0}
.dsh-sc-kv dt{color:var(--dsw-alias-label-tertiary)}
.dsh-sc-kv dd{margin:0;word-break:break-all;color:var(--dsw-alias-label-secondary)}
.dsh-sc-switchrow{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-sc-switch{position:relative;flex:none;width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3);cursor:pointer;padding:0;transition:background .15s ease}
.dsh-sc-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:transparent}
.dsh-sc-switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-sc-switch:disabled{opacity:.45;cursor:default}
.dsh-sc-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:transform .15s ease}
.dsh-sc-switch[aria-checked="true"] .dsh-sc-thumb{transform:translateX(14px)}
.dsh-sc-switchtext{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsh-sc-switchlabel{font-weight:600;font-size:12px}
.dsh-sc-hint{color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-sc-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
.dsh-sc-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}
.dsh-sc-note{border-radius:var(--dsw-radius-md,8px);padding:9px 12px;font-size:12px;margin:0 20px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-sc-note-warn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary)}
.dsh-sc-note-err{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)}
.dsh-sc-note-ok{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-success-primary)}
.dsh-sc-form{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-2)}
.dsh-sc-area{min-height:96px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px}
.dsh-sc-foot{flex:none;display:flex;gap:10px;align-items:center;padding:7px 20px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-sc-foot-cwd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dsh-sc-center{display:flex;align-items:center;justify-content:center;flex:1;color:var(--dsw-alias-label-tertiary)}
[data-platform='darwin'] .dsh-sc-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
`;

    // ------------------------------------------------------------------
    // 宿主 API
    // ------------------------------------------------------------------

    /**
     * 调宿主路由(GET)。
     * @param op - 操作名。
     * @param params - 查询参数。
     * @returns 响应体。
     */
    async function apiGet(op, params = {}) {
      const url = new URL(API, window.location.origin);
      url.searchParams.set('op', op);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      }
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (payload.ok !== true) throw new Error(payload.error ?? `HTTP ${response.status}`);
      return payload;
    }

    /**
     * 调宿主路由(POST)。
     * @param body - 请求体(含 op)。
     * @returns 响应体。
     */
    async function apiPost(body) {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (payload.ok !== true) throw new Error(payload.error ?? `HTTP ${response.status}`);
      return payload;
    }

    /**
     * 选一个会话作为作用域来源:优先"主区域正在显示的会话",否则最近更新的会话。
     * 面板本身占用主区域,切过来之后 mainView 归属可能已经让出,
     * 所以命中的结果会缓存下来供后续刷新复用。
     * @param sessions - 客户端 sessions 服务。
     * @param cache - 记忆上一次命中的会话 id 与 cwd。
     * @returns `{ sessionId, cwd }`。
     */
    function pickScope(sessions, cache) {
      try {
        const snapshot = sessions?.list?.getSnapshot?.();
        const byId = snapshot?.byId ?? {};
        const entries = Object.entries(byId);
        const main = entries.find(([, row]) => (row?.retainedBy?.mainView ?? 0) > 0);
        if (main !== undefined) {
          cache.sessionId = main[0];
          cache.cwd = main[1]?.cwd;
          return { sessionId: cache.sessionId, cwd: cache.cwd };
        }
        if (cache.sessionId !== undefined && byId[cache.sessionId] !== undefined) {
          cache.cwd = byId[cache.sessionId]?.cwd ?? cache.cwd;
          return { sessionId: cache.sessionId, cwd: cache.cwd };
        }
        let best;
        for (const [id, row] of entries) {
          const at = row?.updatedAt ?? row?.lastActivityAt ?? row?.createdAt ?? 0;
          if (best === undefined || at > best.at) best = { id, at, cwd: row?.cwd };
        }
        if (best !== undefined) {
          cache.sessionId = best.id;
          cache.cwd = best.cwd;
          return { sessionId: best.id, cwd: best.cwd };
        }
      } catch {
        /* 会话服务不可用时退化为不传作用域 */
      }
      return { sessionId: cache.sessionId, cwd: cache.cwd };
    }

    // ------------------------------------------------------------------
    // 小组件
    // ------------------------------------------------------------------

    function Switch({ checked, disabled, label, hint, onChange }) {
      return h('div', { className: 'dsh-sc-switchrow' }, [
        h('button', {
          key: 'sw',
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          disabled: disabled === true,
          className: 'dsh-sc-switch',
          onClick: () => { if (disabled !== true) onChange(!checked); },
        }, h('span', { className: 'dsh-sc-thumb' })),
        h('div', { key: 'tx', className: 'dsh-sc-switchtext' }, [
          h('span', { key: 'l', className: 'dsh-sc-switchlabel' }, label),
          h('span', { key: 'h', className: 'dsh-sc-hint' }, hint),
        ]),
      ]);
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number') return '—';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    // ------------------------------------------------------------------
    // 侧栏图标
    // ------------------------------------------------------------------

    /**
     * 侧栏全局面板行的图标;`size` 由宿主给(展开 16 / 收起 18)。
     * @param props - `{ size, active }`。
     * @returns SVG 元素。
     */
    function SkillCenterIcon({ size = 16 }) {
      const dimension = size ?? 16;
      return h('svg', {
        width: dimension,
        height: dimension,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }, [
        h('rect', { key: 'a', x: 2.2, y: 3, width: 5.2, height: 4.4, rx: 1.1 }),
        h('rect', { key: 'b', x: 8.6, y: 3, width: 5.2, height: 9.9, rx: 1.1 }),
        h('rect', { key: 'c', x: 2.2, y: 8.6, width: 5.2, height: 4.3, rx: 1.1 }),
      ]);
    }

    // ------------------------------------------------------------------
    // 面板
    // ------------------------------------------------------------------

    /**
     * 造面板组件(闭包持有 ctx、取词函数与记忆的作用域)。
     * @param ctx - 客户端根上下文。
     * @param localT - locale 不可用时的兜底取词。
     * @returns 面板组件。
     */
    function makePage(ctx, localT) {
      const sessions = ctx.get('sessions');
      const scopeCache = {};

      return function SkillCenterPage(props) {
        const t = typeof props?.t === 'function' ? props.t : localT;
        const [catalog, setCatalog] = React.useState(undefined);
        const [error, setError] = React.useState(undefined);
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState(undefined);
        const [query, setQuery] = React.useState('');
        const [sourceFilter, setSourceFilter] = React.useState('');
        const [selected, setSelected] = React.useState(undefined);
        const [body, setBody] = React.useState(undefined);
        const [pendingDelete, setPendingDelete] = React.useState(false);
        const [creating, setCreating] = React.useState(false);

        const load = React.useCallback(async () => {
          setBusy(true);
          setError(undefined);
          try {
            const payload = await apiGet('list', pickScope(sessions, scopeCache));
            setCatalog(payload);
            setSelected((previous) => previous ?? payload.skills[0]?.name);
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        }, [sessions]);

        React.useEffect(() => { load(); }, [load]);

        const skills = catalog?.skills ?? [];
        const sources = Array.from(new Set(skills.map((skill) => skill.source).filter(Boolean))).sort();
        const filtered = skills.filter((skill) => {
          if (sourceFilter !== '' && skill.source !== sourceFilter) return false;
          const needle = query.trim().toLowerCase();
          if (needle === '') return true;
          return skill.name.toLowerCase().includes(needle)
            || String(skill.description ?? '').toLowerCase().includes(needle);
        });
        const current = skills.find((skill) => skill.name === selected) ?? filtered[0];
        const scopeText = catalog === undefined ? ''
          : catalog.tier === 'process-cwd' || catalog.tier === 'global' ? t('scopeCwd')
            : catalog.tier === 'preset-scope' ? t('scopePreset') : t('scopeLive');

        /**
         * 跑一个写操作,然后重读目录。
         * @param action - 返回 Promise 的动作。
         * @param okMessage - 成功提示。
         */
        const mutate = async (action, okMessage) => {
          setBusy(true);
          setError(undefined);
          setNotice(undefined);
          try {
            await action();
            await load();
            setNotice(okMessage);
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        };

        const setInvocation = (skill, patch) => mutate(
          () => apiPost({
            op: 'setInvocation',
            ...pickScope(sessions, scopeCache),
            name: skill.name,
            modelInvocable: patch.modelInvocable ?? skill.modelInvocable,
            userInvocable: patch.userInvocable ?? skill.userInvocable,
          }),
          t('saved'),
        );

        const removeSkill = (skill) => mutate(
          async () => {
            await apiPost({ op: 'delete', ...pickScope(sessions, scopeCache), name: skill.name });
            setSelected(undefined);
            setBody(undefined);
            setPendingDelete(false);
          },
          t('deleted'),
        );

        const loadBody = async (skill) => {
          setBusy(true);
          setError(undefined);
          try {
            const payload = await apiPost({ op: 'read', ...pickScope(sessions, scopeCache), name: skill.name });
            setBody(payload.text);
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        };

        const head = h('div', { className: 'dsh-sc-head', key: 'head' }, [
          h('div', { className: 'dsh-sc-headrow', key: 'r1' }, [
            h('span', { className: 'dsh-sc-title', key: 't' }, t('title')),
            h('span', { className: 'dsh-sc-sub', key: 's' }, catalog === undefined
              ? t('subtitle')
              : `${t('total', { n: skills.length })} · ${scopeText}`),
            h('span', { className: 'dsh-sc-spacer', key: 'sp' }),
            h('button', {
              key: 'back',
              type: 'button',
              className: 'dsh-sc-btn',
              onClick: () => { try { ctx.get('layout')?.selectPanel?.(null); } catch { /* 布局服务不可用 */ } },
            }, t('back')),
          ]),
          h('div', { className: 'dsh-sc-tools', key: 'r2' }, [
            h('input', {
              key: 'q',
              type: 'search',
              className: 'dsh-sc-input',
              placeholder: t('search'),
              value: query,
              onChange: (event) => setQuery(event.target.value),
            }),
            sources.length > 1 ? h('select', {
              key: 'f',
              className: 'dsh-sc-select',
              value: sourceFilter,
              onChange: (event) => setSourceFilter(event.target.value),
            }, [
              h('option', { key: '__all', value: '' }, t('filterAll')),
              ...sources.map((source) => h('option', { key: source, value: source }, source)),
            ]) : null,
            h('button', {
              key: 'new',
              type: 'button',
              className: 'dsh-sc-btn',
              onClick: () => { setCreating((value) => !value); setPendingDelete(false); },
            }, t('create')),
            h('button', {
              key: 'refresh',
              type: 'button',
              className: 'dsh-sc-btn',
              disabled: busy,
              onClick: () => { setBody(undefined); load(); },
            }, t('refresh')),
          ]),
        ]);

        const list = h('div', { className: 'dsh-sc-list', key: 'list' },
          filtered.length === 0
            ? [h('div', {
              key: 'e',
              className: 'dsh-sc-hint',
              style: { padding: '10px' },
            }, skills.length === 0 ? t('emptyAll') : t('empty'))]
            : filtered.map((skill) => h('button', {
              key: skill.name,
              type: 'button',
              className: `dsh-sc-row${current?.name === skill.name ? ' dsh-sc-row-on' : ''}`,
              onClick: () => { setSelected(skill.name); setBody(undefined); setPendingDelete(false); },
            }, [
              h('span', { key: 'n', className: 'dsh-sc-name' }, skill.name),
              h('span', { key: 'm', className: 'dsh-sc-meta' }, [
                h('span', { key: 's', className: 'dsh-sc-badge' }, skill.source ?? skill.provider ?? '—'),
                skill.modelInvocable === false ? h('span', { key: 'mm', className: 'dsh-sc-badge dsh-sc-badge-warn' }, t('modelOff')) : null,
                skill.userInvocable === false ? h('span', { key: 'uu', className: 'dsh-sc-badge dsh-sc-badge-warn' }, t('userOff')) : null,
                skill.writable !== true ? h('span', { key: 'em', className: 'dsh-sc-badge' }, t('embedded')) : null,
              ]),
              h('span', { key: 'd', className: 'dsh-sc-desc' }, skill.description),
            ])));

        let detail;
        if (creating) {
          detail = h(CreateForm, {
            key: 'create',
            t,
            catalog,
            scopeCache,
            sessions,
            onDone: (message) => { setCreating(false); setNotice(message); load(); },
            onError: setError,
          });
        } else if (current === undefined) {
          detail = h('div', { key: 'empty', className: 'dsh-sc-center' }, t('emptyAll'));
        } else {
          detail = h('div', { key: 'detail', className: 'dsh-sc-detail' }, [
            h('h2', { key: 'h', className: 'dsh-sc-h2' }, current.name),
            h('p', { key: 'p', className: 'dsh-sc-p' }, current.description ?? ''),
            current.whenToUse ? h('div', { key: 'w', className: 'dsh-sc-section' }, [
              h('div', { key: 'l', className: 'dsh-sc-label' }, t('whenToUse')),
              h('p', { key: 'v', className: 'dsh-sc-p' }, current.whenToUse),
            ]) : null,
            h('div', { key: 'kv', className: 'dsh-sc-section' }, [
              h('div', { key: 'l', className: 'dsh-sc-label' }, t('path')),
              h('dl', { key: 'd', className: 'dsh-sc-kv' }, [
                h('dt', { key: 'p' }, t('provider')), h('dd', { key: 'pv' }, current.provider ?? '—'),
                h('dt', { key: 's' }, t('source')), h('dd', { key: 'sv' }, current.source ?? '—'),
                h('dt', { key: 'r' }, t('root')), h('dd', { key: 'rv' }, current.rootLabel ?? '—'),
                h('dt', { key: 'f' }, t('path')), h('dd', { key: 'fv' }, current.path ?? '—'),
                h('dt', { key: 'z' }, t('size')), h('dd', { key: 'zv' }, formatBytes(current.bytes)),
              ]),
            ]),
            h('div', { key: 'sw', className: 'dsh-sc-section' }, [
              h(Switch, {
                key: 'model',
                checked: current.modelInvocable !== false,
                disabled: busy || current.writable !== true,
                label: t('model'),
                hint: t('modelHint'),
                onChange: (value) => setInvocation(current, { modelInvocable: value }),
              }),
              h(Switch, {
                key: 'user',
                checked: current.userInvocable !== false,
                disabled: busy || current.writable !== true,
                label: t('user'),
                hint: t('userHint'),
                onChange: (value) => setInvocation(current, { userInvocable: value }),
              }),
            ]),
            current.writable !== true
              ? h('div', { key: 'note', className: 'dsh-sc-note dsh-sc-note-warn', style: { margin: '0 0 14px' } }, t('internalOnly'))
              : null,
            h('div', { key: 'act', className: 'dsh-sc-actions' }, [
              h('button', {
                key: 'body',
                type: 'button',
                className: 'dsh-sc-btn',
                disabled: busy || current.writable !== true,
                onClick: () => { if (body === undefined) loadBody(current); else setBody(undefined); },
              }, body === undefined ? t('reloadBody') : t('previewHide')),
              h('button', {
                key: 'del',
                type: 'button',
                className: `dsh-sc-btn${pendingDelete ? ' dsh-sc-btn-danger' : ''}`,
                disabled: busy || current.writable !== true,
                onClick: () => { if (pendingDelete) removeSkill(current); else setPendingDelete(true); },
              }, pendingDelete ? t('deleteConfirm') : t('delete')),
              pendingDelete ? h('span', { key: 'dh', className: 'dsh-sc-hint' }, t('deleteHint')) : null,
            ]),
            body !== undefined ? h('div', {
              key: 'pre',
              className: 'dsh-sc-section',
              style: { marginTop: '16px' },
            }, [
              h('div', { key: 'l', className: 'dsh-sc-label' }, t('preview')),
              h('pre', { key: 'v', className: 'dsh-sc-pre' }, body === '' ? t('noBody') : body),
            ]) : null,
          ]);
        }

        const foot = h('div', { className: 'dsh-sc-foot', key: 'foot' }, [
          h('span', { key: 'n' }, catalog === undefined ? '' : t('shown', { n: filtered.length, m: skills.length })),
          h('span', { key: 'c', className: 'dsh-sc-foot-cwd' }, catalog?.cwd ?? ''),
          catalog?.complete === false ? h('span', { key: 'w', className: 'dsh-sc-badge dsh-sc-badge-warn' }, t('incomplete')) : null,
        ]);

        return h('div', { className: 'dsh-sc-root' }, [
          head,
          error !== undefined
            ? h('div', { key: 'err', className: 'dsh-sc-note dsh-sc-note-err', style: { marginTop: '12px' } }, [
              h('span', { key: 'm' }, error),
              h('button', {
                key: 'retry',
                type: 'button',
                className: 'dsh-sc-btn',
                onClick: () => load(),
              }, t('retry')),
            ])
            : null,
          notice !== undefined
            ? h('div', { key: 'ok', className: 'dsh-sc-note dsh-sc-note-ok', style: { marginTop: '12px' } }, notice)
            : null,
          catalog === undefined && error === undefined
            ? h('div', { key: 'loading', className: 'dsh-sc-center' }, t('loading'))
            : h('div', { key: 'body', className: 'dsh-sc-body' }, [list, detail]),
          foot,
        ]);
      };
    }

    /**
     * 新建技能表单。
     * @param props - `{ t, catalog, scopeCache, sessions, onDone, onError }`。
     * @returns 表单元素。
     */
    function CreateForm({ t, catalog, scopeCache, sessions, onDone, onError }) {
      const [name, setName] = React.useState('');
      const [description, setDescription] = React.useState('');
      const [body, setBody] = React.useState('');
      const [rootId, setRootId] = React.useState('user-agents');
      const [busy, setBusy] = React.useState(false);
      const roots = (catalog?.roots ?? []).filter((root) => root.id === 'user-agents' || root.id === 'user-dsh');
      const submit = async () => {
        setBusy(true);
        try {
          const payload = await apiPost({
            op: 'create',
            ...pickScope(sessions, scopeCache),
            name,
            description,
            body,
            rootId,
          });
          onDone(`${t('created')}: ${payload.name}`);
        } catch (cause) {
          onError(String(cause?.message ?? cause));
        } finally {
          setBusy(false);
        }
      };
      return h('div', { className: 'dsh-sc-detail' }, [
        h('h2', { key: 'h', className: 'dsh-sc-h2' }, t('create')),
        h('div', { key: 'f', className: 'dsh-sc-form' }, [
          h('input', {
            key: 'n', className: 'dsh-sc-input', placeholder: t('formName'),
            value: name, onChange: (event) => setName(event.target.value),
          }),
          h('input', {
            key: 'd', className: 'dsh-sc-input', placeholder: t('formDesc'),
            value: description, onChange: (event) => setDescription(event.target.value),
          }),
          h('textarea', {
            key: 'b', className: 'dsh-sc-input dsh-sc-area', placeholder: t('formBody'),
            value: body, onChange: (event) => setBody(event.target.value),
          }),
          h('div', { key: 'r', className: 'dsh-sc-tools' }, [
            h('span', { key: 'l', className: 'dsh-sc-hint' }, t('formRoot')),
            h('select', {
              key: 's', className: 'dsh-sc-select', value: rootId,
              onChange: (event) => setRootId(event.target.value),
            }, roots.map((root) => h('option', {
              key: root.id, value: root.id, title: root.path,
            }, `${root.label} — ${root.path}`))),
          ]),
          h('div', { key: 'a', className: 'dsh-sc-actions' }, [
            h('button', {
              key: 'ok',
              type: 'button',
              className: 'dsh-sc-btn dsh-sc-btn-primary',
              disabled: busy || name === '' || description === '',
              onClick: submit,
            }, t('createSubmit')),
          ]),
        ]),
      ]);
    }

    // ------------------------------------------------------------------
    // 插件体
    // ------------------------------------------------------------------

    const inject = ['slots', 'sessions', 'layout'];

    /**
     * 注册侧栏行与中央面板。
     * @param ctx - 客户端根上下文。
     */
    function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) return;

      let t = fallbackText;
      ctx.effect(() => {
        const locale = ctx.get('locale');
        if (locale === undefined) return undefined;
        let dispose;
        try {
          dispose = locale.register(NS, { zh: DICT.zh, en: DICT.en });
          t = locale.bind(NS);
        } catch {
          t = fallbackText;
          return undefined;
        }
        return () => {
          t = fallbackText;
          try {
            dispose?.();
          } catch {
            /* 摘除失败不影响卸载 */
          }
        };
      }, 'skill-center: dictionaries');

      ctx.effect(() => {
        const style = createOwnedStyle(CSS);
        return () => { style.remove(); };
      }, 'skill-center: styles');

      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 1,
        label: () => t('panel'),
        locale: NS,
      }, SkillCenterIcon));

      slots.inject('main', () => slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, makePage(ctx, (key, params) => t(key, params))));
    }

    return { apply, inject };
  },
});
}
