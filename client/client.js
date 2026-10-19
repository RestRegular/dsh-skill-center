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
 *
 * 整个文件包在 IIFE 里:client bundle 是宿主拼进同一页面的**经典脚本**,顶层
 * const/let 进入共享的全局词法作用域,而且**不会随 HMR/卸载消失**。插件在页面
 * 已打开时被重装或升级,新 bundle 会在同一个 realm 里再执行一次,顶层
 * `const MODULE_ID` 会直接抛 `Identifier 'MODULE_ID' has already been declared`,
 * 整个脚本不执行、工厂不注册 —— 表现就是侧栏少了这一行,刷新页面才恢复。
 */
(() => {
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
        formRootHint: '写入位置决定技能文件落在哪个根:项目根只对当前仓库生效且优先级最高;用户 Agents 技能(~/.agents/skills)对所有项目生效、按 .agents 约定扫描的其它工具也能复用;用户 DSH 技能(~/.dsh/skills)只在 DSH 里生效,同名时优先于 Agents 技能。',
        importSkill: '导入技能',
        importHint: '选择一个 .zip 技能包或单个 .md 技能文件',
        export: '导出',
        exportHint: '把技能包导出为 .zip(SKILL.md + 资源文件)',
        delete: '删除',
        deleteConfirm: '确认删除?',
        cancel: '取消',
        deleteHint: '删除会把技能移动到同根目录的 .trash 下,可在回收站里恢复。',
        trash: '回收站',
        backToList: '返回技能列表',
        trashEmpty: '回收站是空的',
        trashHint: '恢复会把技能移回原来的技能根;删除会永久移除这一条目。',
        restore: '恢复',
        deleteTrashHint: '删除会永久移除这一条目,无法恢复。',
        deletedAt: '删除于',
        emptyTrash: '清空回收站',
        emptyTrashConfirm: '确认清空?',
        emptyTrashHint: '清空会永久删除回收站里的所有条目,无法恢复。',
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
        scopeLabel: '作用域',
        scopeAuto: '自动(当前会话)',
        scopeAutoHint: '跟随主区域正在显示的会话',
        scopeHint: '切换要查看的会话作用域:技能按所选会话的 cwd 与预设解析',
        scopePending: '先保存未保存的调用开关改动,再切换作用域',
        scopeDefaultWorkspace: '默认工作区',
        scopeUngrouped: '未分组',
        scopeRunning: '运行中',
        filterAll: '全部来源',
        filterSource: '来源筛选',
        total: '{n} 个技能',
        shown: '显示 {n} / {m}',
        whenToUse: '何时使用',
        internalOnly: '该技能由插件内嵌提供,只能查看,不能改写或删除。',
        noBody: '(正文为空)',
        saved: '已保存',
        unmodified: '未修改',
        save: '保存',
        saveHint: '把改动写回 SKILL.md 的 frontmatter',
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
        formRootHint: 'Write-to picks the root: a project root only applies to this repository and outranks the rest; user Agents (~/.agents/skills) applies to every project and is reusable by other tools that scan it; user DSH (~/.dsh/skills) belongs to DeepSeek Harness alone and outranks a same-named Agents skill.',
        importSkill: 'Import skill',
        importHint: 'Pick a .zip skill bundle or a single .md skill file',
        export: 'Export',
        exportHint: 'Export the bundle as a .zip (SKILL.md plus its resource files)',
        delete: 'Delete',
        deleteConfirm: 'Confirm delete?',
        cancel: 'Cancel',
        deleteHint: 'Delete moves the skill into a .trash folder under the same root; restore it from the panel\'s trash.',
        trash: 'Trash',
        backToList: 'Back to skills',
        trashEmpty: 'The trash is empty',
        trashHint: 'Restore moves the skill back into its original root; Delete removes this entry for good.',
        restore: 'Restore',
        deleteTrashHint: 'Delete removes this entry permanently; it cannot be undone.',
        deletedAt: 'Deleted',
        emptyTrash: 'Empty trash',
        emptyTrashConfirm: 'Confirm empty?',
        emptyTrashHint: 'Emptying deletes every trash entry permanently.',
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
        scopeLabel: 'Scope',
        scopeAuto: 'Auto (current session)',
        scopeAutoHint: 'Follow the session shown in the main area',
        scopeHint: 'Switch the session scope being browsed: skills resolve from that session\'s cwd and preset',
        scopePending: 'Save the pending invocation changes before switching scope',
        scopeDefaultWorkspace: 'Default workspace',
        scopeUngrouped: 'Ungrouped',
        scopeRunning: 'Running',
        filterSource: 'Source filter',
        filterAll: 'All sources',
        total: '{n} skills',
        shown: 'Showing {n} of {m}',
        whenToUse: 'When to use',
        internalOnly: 'This skill is embedded in a plugin: it can be viewed but not edited or deleted.',
        noBody: '(empty body)',
        saved: 'Saved',
        unmodified: 'Unmodified',
        save: 'Save',
        saveHint: 'Write the changes back into the SKILL.md frontmatter',
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
.dsh-sc-scope{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:280px}
.dsh-sc-scope .dsh-sc-dropbtn{max-width:230px}
.dsh-sc-input{flex:1;min-width:140px;padding:6px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;outline:none}
.dsh-sc-input:focus-visible{border-color:var(--dsw-alias-state-business-primary)}
.dsh-sc-drop{position:relative;display:inline-flex;min-width:0;vertical-align:middle}
.dsh-sc-dropbtn{display:inline-flex;align-items:center;gap:6px;max-width:240px;min-width:0;padding:6px 8px 6px 10px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;line-height:1.4;cursor:pointer}
.dsh-sc-dropbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-dropbtn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-sc-dropbtn[aria-expanded="true"]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-1)}
.dsh-sc-dropbtn:disabled{opacity:.45;cursor:default}
.dsh-sc-droplabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left}
.dsh-sc-caret{flex:none;opacity:.55;transition:transform .15s ease}
.dsh-sc-dropbtn[aria-expanded="true"] .dsh-sc-caret{transform:rotate(180deg)}
.dsh-sc-menu{position:absolute;z-index:60;top:calc(100% + 5px);left:0;width:260px;max-width:calc(100vw - 40px);max-height:320px;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;padding:5px;border-radius:var(--dsw-radius-lg,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:1px}
.dsh-sc-mgroup{position:sticky;top:-5px;z-index:1;display:flex;align-items:center;gap:6px;box-sizing:border-box;margin-top:3px;padding:6px 8px 4px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-caption);font-size:11px;font-weight:600;letter-spacing:.02em}
.dsh-sc-mgroup:first-child{border-top:none;margin-top:0}
.dsh-sc-mgroup-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-mgroup-count{flex:none;font-weight:400;color:var(--dsw-alias-label-caption)}
.dsh-sc-mopt{display:flex;align-items:center;gap:8px;align-self:stretch;box-sizing:border-box;padding:7px 9px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.4;text-align:left;cursor:pointer}
.dsh-sc-mopt-active{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-mopt-on{background:var(--dsw-alias-interactive-bg-active)}
.dsh-sc-mopt-inner{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1}
.dsh-sc-mopt-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-sc-mopt-hint{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-sc-mopt-check{flex:none;width:13px;height:13px;color:var(--dsw-alias-state-business-primary)}
.dsh-sc-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;cursor:pointer;line-height:1.4;white-space:nowrap}
.dsh-sc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-sc-btn:disabled{opacity:.45;cursor:default}
.dsh-sc-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}
.dsh-sc-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsh-sc-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-sc-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-sc-body{display:flex;flex:1;min-height:0}
.dsh-sc-list{width:288px;flex:none;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;border-right:1px solid var(--dsw-alias-border-l2);padding:8px}
.dsh-sc-row{display:flex;flex-direction:column;gap:3px;width:100%;box-sizing:border-box;text-align:left;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);border:none;background:transparent;color:inherit;cursor:pointer;font:inherit}
.dsh-sc-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-sc-row:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsh-sc-row-on{background:var(--dsw-alias-interactive-bg-active)}
.dsh-sc-name{font-weight:600;word-break:break-all}
.dsh-sc-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-sc-meta{display:flex;gap:5px;align-items:center;flex-wrap:wrap;color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-sc-badge{padding:0 6px;border-radius:var(--dsw-radius-xs,4px);border:.5px solid var(--dsw-alias-border-l3);line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-sc-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsh-sc-detail{flex:1;min-width:0;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;padding:18px 22px 32px}
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
.dsh-sc-pre{margin:0;padding:12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:340px;overflow-y:auto;overflow-x:hidden;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace)}
.dsh-sc-note{border-radius:var(--dsw-radius-md,8px);padding:9px 12px;font-size:12px;margin:0 20px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-sc-note-warn{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary)}
.dsh-sc-note-err{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-error-primary)}
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
     * 目录里展示用的工作区名(路径最后一段;兼容 Windows 盘符与 POSIX)。
     * @param cwd - 会话工作目录。
     * @returns 最后一段路径,取不到时 undefined。
     */
    function workspaceNameOf(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return undefined;
      const parts = cwd.split(/[\\/]+/u).filter((part) => part !== '');
      return parts.length === 0 ? undefined : parts[parts.length - 1];
    }

    /** 每个工作区在作用域菜单里最多列出的会话数:再多的历史会话交给面板的搜索框。 */
    const SCOPE_PER_WORKSPACE = 12;

    /**
     * 工作区显示名:宿主把默认工作区存成 `default-workspace`,这里换成界面文案。
     * @param workspace - 客户端 workspaces 快照里的工作区视图。
     * @param t - 取词函数。
     * @returns 显示名。
     */
    function workspaceTitleOf(workspace, t) {
      const title = typeof workspace?.title === 'string' ? workspace.title : '';
      if (title === '' || title === 'default-workspace') return t('scopeDefaultWorkspace');
      return title;
    }

    /**
     * 把客户端会话目录投影成作用域菜单的分组候选。
     *
     * 技能作用域由「会话 cwd + 会话预设」共同决定,所以候选按会话(而不是按工作区)
     * 列出;但菜单按工作区分组,和侧栏的心智模型一致。已归档的会话与空会话
     * (点过"新建会话"还没发消息)不进候选:它们不是用户此刻要切换过去浏览的对象。
     * 子 Agent 会话同样不出现。
     *
     * 没有 workspaces 服务的老宿主会退化成按 cwd 分组;每个工作区最多列
     * SCOPE_PER_WORKSPACE 个最近会话,避免下拉被几百个历史会话撑爆。
     *
     * @param sessions - 客户端 sessions 服务。
     * @param workspaces - 客户端 workspaces 服务(可缺省)。
     * @param t - 取词函数。
     * @returns `{ groups, options }`:分组里有 `title`,平铺的 `options` 用于取值校验。
     */
    function scopeGroupsOf(sessions, workspaces, t) {
      let rows = [];
      try {
        rows = Object.values(sessions?.list?.getSnapshot?.()?.byId ?? {});
      } catch {
        /* 会话服务不可用时只留"自动" */
      }
      const archived = new Set();
      let workspaceItems = [];
      try {
        const snapshot = workspaces?.list?.getSnapshot?.();
        for (const id of snapshot?.archivedSessionIds ?? []) archived.add(String(id));
        if (Array.isArray(snapshot?.items)) workspaceItems = snapshot.items;
      } catch {
        /* 工作区服务不可用时按 cwd 兜底分组 */
      }
      const byId = new Map();
      for (const row of rows) {
        if (row?.id === undefined) continue;
        if (row.origin === 'subagent' || row.parentId !== undefined) continue;
        // 空会话(点过"新建会话"还没发消息)没有可读内容,不是切换作用域的对象。
        if (row.blank === true) continue;
        const id = String(row.id);
        if (archived.has(id)) continue;
        byId.set(id, row);
      }
      const groups = [];
      const options = [];
      const assigned = new Set();
      /** 同一工作区里未命名的会话会重名:给重名项补一段 id,仍然一眼能区分。 */
      const pushGroup = (key, title, path, members) => {
        if (members.length === 0) return;
        const used = new Map();
        const groupOptions = members
          .slice()
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
          .slice(0, SCOPE_PER_WORKSPACE)
          .map((row) => {
            const id = String(row.id);
            const base = String(row.displayTitle ?? row.title ?? id).trim() || id;
            const count = used.get(base) ?? 0;
            used.set(base, count + 1);
            return {
              value: id,
              label: count === 0 ? base : `${base} (${id.slice(-6)})`,
              hint: row.running === true ? t('scopeRunning') : undefined,
              title: typeof row.cwd === 'string' ? row.cwd : undefined,
            };
          });
        groups.push({
          key,
          title,
          hint: path,
          count: groupOptions.length,
          options: groupOptions,
        });
        options.push(...groupOptions);
      };
      for (const workspace of workspaceItems) {
        const members = [];
        for (const rawId of workspace?.sessionIds ?? []) {
          const id = String(rawId);
          const row = byId.get(id);
          if (row === undefined || assigned.has(id)) continue;
          assigned.add(id);
          members.push(row);
        }
        pushGroup(
          String(workspace.workspaceId ?? workspaceTitleOf(workspace, t)),
          workspaceTitleOf(workspace, t),
          typeof workspace.path === 'string' ? workspace.path : undefined,
          members,
        );
      }
      // 没归属任何工作区的会话(以及老宿主):按 cwd 归组,至少保持"按工作区"的形状。
      const leftovers = new Map();
      for (const [id, row] of byId) {
        if (assigned.has(id)) continue;
        const key = typeof row.cwd === 'string' ? row.cwd : '';
        const bucket = leftovers.get(key) ?? [];
        bucket.push(row);
        leftovers.set(key, bucket);
      }
      for (const [cwd, members] of leftovers) {
        pushGroup(`cwd:${cwd}`, workspaceNameOf(cwd) ?? t('scopeUngrouped'), cwd, members);
      }
      return { groups, options };
    }

    /**
     * 选一个会话作为作用域来源:用户显式选中的会话优先;否则"主区域正在显示的会话",
     * 再否则最近更新的会话。面板本身占用主区域,切过来之后 mainView 归属可能已经让出,
     * 所以命中的结果会缓存下来供后续刷新复用。
     * @param sessions - 客户端 sessions 服务。
     * @param cache - 记忆上一次命中的会话 id 与 cwd。
     * @param pinned - 用户在下拉里选中的会话 id;空串/未命中表示自动。
     * @returns `{ sessionId, cwd }`。
     */
    function pickScope(sessions, cache, pinned) {
      try {
        const snapshot = sessions?.list?.getSnapshot?.();
        const byId = snapshot?.byId ?? {};
        // 显式选中时不更新 auto 缓存:切回"自动"时应该回到原来的跟随对象。
        if (typeof pinned === 'string' && pinned !== ''
          && Object.prototype.hasOwnProperty.call(byId, pinned)) {
          return { sessionId: pinned, cwd: byId[pinned]?.cwd };
        }
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

    /**
     * 自定义下拉:一个触发器按钮 + 浮层菜单。
     *
     * 用自定义浮层而不是原生 `<select>`,是为了让作用域菜单能按工作区分组、
     * 给分组标题和"运行中"加排版;来源筛选与写入位置共用同一个组件。
     *
     * 交互:点触发器开合;方向键移动高亮,Enter/Space 选中,Esc 关闭;
     * 点浮层外关闭。触发器保留焦点,因此键盘操作不依赖菜单项是否能聚焦。
     *
     * @param props - `{ value, label, options, groups, onChange, disabled, title, ariaLabel, menuWidth }`。
     * @returns 下拉元素。
     */
    function Dropdown({ value, label, options, groups, onChange, disabled = false, title, ariaLabel, menuWidth = 260 }) {
      const [open, setOpen] = React.useState(false);
      const [active, setActive] = React.useState(-1);
      const rootRef = React.useRef(null);
      const flat = groups === undefined
        ? (Array.isArray(options) ? options : [])
        : groups.flatMap((group) => group.options ?? []);
      const current = flat.find((option) => option.value === value);
      const shown = label ?? current?.label ?? '';

      React.useEffect(() => {
        if (!open) return undefined;
        setActive(flat.findIndex((option) => option.value === value));
        const onPointer = (event) => {
          const root = rootRef.current;
          if (root !== null && typeof root?.contains === 'function' && root.contains(event?.target)) return;
          setOpen(false);
        };
        const onKey = (event) => { if (event?.key === 'Escape') setOpen(false); };
        document.addEventListener?.('pointerdown', onPointer, true);
        document.addEventListener?.('keydown', onKey);
        return () => {
          document.removeEventListener?.('pointerdown', onPointer, true);
          document.removeEventListener?.('keydown', onKey);
        };
        // 只在开合时挂/摘全局监听:菜单打开期间 value 不变也不需要重挂。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [open]);

      const choose = (next) => {
        if (disabled) return;
        setOpen(false);
        if (next !== value) onChange(next);
      };

      /**
       * 触发器上的键盘导航。
       * @param event - 键盘事件。
       */
      const onKeyDown = (event) => {
        if (disabled) return;
        const key = event?.key;
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          event.preventDefault?.();
          if (!open) { setOpen(true); return; }
          setActive((previous) => {
            if (flat.length === 0) return -1;
            const step = key === 'ArrowDown' ? 1 : -1;
            const from = previous < 0 ? (step > 0 ? -1 : 0) : previous;
            return (from + step + flat.length) % flat.length;
          });
          return;
        }
        if (key === 'Enter' || key === ' ') {
          event.preventDefault?.();
          if (!open) { setOpen(true); return; }
          const picked = flat[active];
          if (picked !== undefined) choose(picked.value);
          return;
        }
        if (key === 'Escape' && open) {
          event.preventDefault?.();
          setOpen(false);
          return;
        }
        if (key === 'Tab') setOpen(false);
      };

      let optionIndex = -1;
      /**
       * 渲染一行选项(平铺与分组共用)。
       * @param option - `{ value, label, hint, title }`。
       * @returns 选项元素。
       */
      const renderOption = (option) => {
        optionIndex += 1;
        const at = optionIndex;
        const selected = option.value === value;
        return h('div', {
          key: `o:${at}`,
          role: 'option',
          'aria-selected': selected,
          'data-value': option.value,
          tabIndex: -1,
          title: option.title ?? option.hint,
          className: [
            'dsh-sc-mopt',
            at === active ? 'dsh-sc-mopt-active' : '',
            selected ? 'dsh-sc-mopt-on' : '',
          ].filter(Boolean).join(' '),
          onMouseEnter: () => setActive(at),
          onClick: () => choose(option.value),
        }, [
          h('span', { key: 'x', className: 'dsh-sc-mopt-inner' }, [
            h('span', { key: 'l', className: 'dsh-sc-mopt-label' }, option.label),
            option.hint === undefined
              ? null
              : h('span', { key: 'h', className: 'dsh-sc-mopt-hint' }, option.hint),
          ]),
          selected ? h('svg', {
            key: 'k',
            className: 'dsh-sc-mopt-check',
            width: 13,
            height: 13,
            viewBox: '0 0 16 16',
            'aria-hidden': true,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }, h('path', { key: 'p', d: 'M3.2 8.6 6.3 11.7 12.8 4.8' })) : null,
        ]);
      };

      const menu = [];
      if (groups === undefined) {
        for (const option of flat) menu.push(renderOption(option));
      } else {
        for (const group of groups) {
          if (group.title !== undefined) {
            menu.push(h('div', { key: `g:${group.key}`, className: 'dsh-sc-mgroup', 'aria-hidden': true }, [
              h('span', { key: 'n', className: 'dsh-sc-mgroup-name', title: group.hint }, group.title),
              group.count === undefined
                ? null
                : h('span', { key: 'c', className: 'dsh-sc-mgroup-count' }, String(group.count)),
            ]));
          }
          for (const option of group.options ?? []) menu.push(renderOption(option));
        }
      }

      return h('div', { className: 'dsh-sc-drop', ref: rootRef }, [
        h('button', {
          key: 't',
          type: 'button',
          className: 'dsh-sc-dropbtn',
          'aria-label': ariaLabel,
          'aria-haspopup': 'listbox',
          'aria-expanded': open,
          'data-value': value,
          title,
          disabled,
          onClick: () => { if (!disabled) setOpen((previous) => !previous); },
          onKeyDown,
        }, [
          h('span', { key: 'l', className: 'dsh-sc-droplabel' }, shown),
          h('svg', {
            key: 'c',
            className: 'dsh-sc-caret',
            width: 10,
            height: 10,
            viewBox: '0 0 12 12',
            'aria-hidden': true,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }, h('path', { key: 'p', d: 'M2.5 4.5 6 8l3.5-3.5' })),
        ]),
        open
          ? h('div', {
            key: 'm',
            className: 'dsh-sc-menu',
            role: 'listbox',
            'aria-label': ariaLabel,
            style: { width: menuWidth },
          }, menu)
          : null,
      ]);
    }

    function formatBytes(bytes) {
      if (typeof bytes !== 'number') return '—';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * 回收站条目的稳定标识:同一个技能可以在多个根里各有一条。
     * @param entry - 回收站条目。
     * @returns `<rootId>/<entry>`。
     */
    function trashKey(entry) {
      return `${entry.rootId}/${entry.entry}`;
    }

    /**
     * 把回收站条目的删除时间渲染成本地时间。
     * @param entry - 回收站条目。
     * @returns 文本;时间不可解析时为空串。
     */
    function formatDeletedAt(entry) {
      const stamp = typeof entry?.stamp === 'number' ? entry.stamp : Date.parse(entry?.deletedAt);
      if (!Number.isFinite(stamp)) return '';
      return new Date(stamp).toLocaleString();
    }

    // ------------------------------------------------------------------
    // 侧栏图标
    // ------------------------------------------------------------------

    /**
     * 侧栏全局面板行的图标;`size` 由宿主给(展开 16 / 收起 18)。
     *
     * 记号是一道闪电(技能 = 能力),与包根 icon.svg 同一个记号:16px 下它是一个
     * 完整的轮廓,而三块方格的旧图标在小尺寸会和宿主的其它网格类图标混在一起。
     * 这里保持宿主侧栏的线形风格:currentColor 描边、无填充,主题切换自动跟随。
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
      }, h('path', { key: 'bolt', d: 'M9.1 2.3 L4.6 9 H7.7 L6.9 13.7 L11.4 7 H8.3 Z' }));
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
        /** 工作区服务:用来把作用域候选按工作区分组、并读归档集合(老宿主可能没有)。 */
        const workspaces = ctx.get('workspaces');
        const [catalog, setCatalog] = React.useState(undefined);
        const [error, setError] = React.useState(undefined);
        const [busy, setBusy] = React.useState(false);
        const [query, setQuery] = React.useState('');
        const [sourceFilter, setSourceFilter] = React.useState('');
        const [selected, setSelected] = React.useState(undefined);
        const [body, setBody] = React.useState(undefined);
        const [pendingDelete, setPendingDelete] = React.useState(false);
        const [creating, setCreating] = React.useState(false);
        /** 已点开关、还没点"保存"的改动:技能名 → 部分调用策略。 */
        const [pendingEdits, setPendingEdits] = React.useState({});
        /**
         * 面板显示值(技能名 → 部分调用策略),覆盖目录快照里的同名字段。
         * 为什么要本地留存:宿主的技能目录是**缓存**的,写盘之后 chokidar 失效
         * 事件到达前那次 `list` 仍是旧值 —— 只信快照的话,刚点完开关的界面会
         * 自己弹回去(这正是"点了 toggle 不切换、手动刷新才切换"的原因)。
         */
        const [shownEdits, setShownEdits] = React.useState({});
        /** 本次进入面板后是否保存过:决定按钮显示"未修改"还是"已保存"。 */
        const [savedOnce, setSavedOnce] = React.useState(false);
        /** 是否正在看回收站:列表与详情整体切换到 `.trash` 条目。 */
        const [trashOpen, setTrashOpen] = React.useState(false);
        /** 回收站条目;undefined 表示还没读过。 */
        const [trash, setTrash] = React.useState(undefined);
        /** 回收站里选中的条目 key(见 trashKey)。 */
        const [selectedTrash, setSelectedTrash] = React.useState(undefined);
        /** 清空回收站是否已进入二次确认。 */
        const [pendingEmpty, setPendingEmpty] = React.useState(false);
        /** 回收站里的"删除"是否已进入二次确认。 */
        const [pendingTrashDelete, setPendingTrashDelete] = React.useState(false);
        /** 用户在作用域下拉里显式选中的会话 id;空串 = 自动。 */
        const [scopeSessionId, setScopeSessionId] = React.useState('');
        const [, bumpSessionRevision] = React.useState(0);
        // 会话目录与归档集合都是宿主流进来的:订阅它们,新会话/归档操作能立刻反映到菜单。
        React.useEffect(() => {
          const stores = [sessions?.list, workspaces?.list]
            .filter((store) => typeof store?.subscribe === 'function');
          if (stores.length === 0) return undefined;
          const bump = () => bumpSessionRevision((previous) => previous + 1);
          const disposers = stores.map((store) => store.subscribe(bump));
          return () => {
            for (const dispose of disposers) {
              try { dispose?.(); } catch { /* 摘除失败不影响卸载 */ }
            }
          };
        }, []);
        const scopeMenu = scopeGroupsOf(sessions, workspaces, t);
        /** 菜单:最上面一行"自动",其余按工作区分组(已归档会话不在候选里)。 */
        const scopeGroups = [
          {
            key: '__auto',
            options: [{ value: '', label: t('scopeAuto'), hint: t('scopeAutoHint') }],
          },
          ...scopeMenu.groups,
        ];
        const scopeOptions = scopeMenu.options;
        /**
         * 真正生效的作用域:选中的会话已经不在候选里(归档/删除)时回落到自动,
         * 免得下拉停在一个不存在的选项上、请求却还带着旧 id。
         */
        const scopeValue = scopeOptions.some((option) => option.value === scopeSessionId)
          ? scopeSessionId
          : '';
        const scopeLabelText = scopeValue === ''
          ? t('scopeAuto')
          : (scopeOptions.find((option) => option.value === scopeValue)?.label ?? t('scopeAuto'));

        const load = React.useCallback(async () => {
          setBusy(true);
          setError(undefined);
          try {
            const payload = await apiGet('list', pickScope(sessions, scopeCache, scopeValue));
            setCatalog(payload);
            setSelected((previous) => previous ?? payload.skills[0]?.name);
            // 快照已经追平本地面板值的字段就地撤销覆盖,覆盖集合只留"宿主还没追上"的部分。
            setShownEdits((previous) => {
              const next = {};
              let changed = false;
              for (const [name, patch] of Object.entries(previous)) {
                const skill = payload.skills.find((candidate) => candidate.name === name);
                if (skill === undefined) { changed = true; continue; }
                const fresh = {
                  modelInvocable: skill.modelInvocable !== false,
                  userInvocable: skill.userInvocable !== false,
                };
                const keep = {};
                if (patch.modelInvocable !== undefined && patch.modelInvocable !== fresh.modelInvocable) {
                  keep.modelInvocable = patch.modelInvocable;
                }
                if (patch.userInvocable !== undefined && patch.userInvocable !== fresh.userInvocable) {
                  keep.userInvocable = patch.userInvocable;
                }
                if (Object.keys(keep).length > 0) next[name] = keep;
                else changed = true;
              }
              return changed ? next : previous;
            });
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        }, [sessions, scopeValue]);

        React.useEffect(() => { load(); }, [load]);

        /**
         * 重读回收站条目。选中项跟着条目走:还在就保留,没了就落到最新一条。
         */
        const loadTrash = React.useCallback(async () => {
          try {
            const payload = await apiGet('trash', pickScope(sessions, scopeCache, scopeValue));
            const entries = Array.isArray(payload.entries) ? payload.entries : [];
            setTrash(entries);
            setSelectedTrash((previous) => {
              if (previous !== undefined && entries.some((entry) => trashKey(entry) === previous)) {
                return previous;
              }
              return entries.length === 0 ? undefined : trashKey(entries[0]);
            });
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          }
        }, [sessions, scopeValue]);

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

        /** 回收站条目(搜索框在回收站视图里同样按名字过滤)。 */
        const trashAll = trash ?? [];
        const trashFiltered = trashAll.filter((entry) => {
          const needle = query.trim().toLowerCase();
          return needle === '' || String(entry.name ?? '').toLowerCase().includes(needle);
        });
        const currentTrash = trashFiltered.find((entry) => trashKey(entry) === selectedTrash)
          ?? (trashFiltered.length === 0 ? undefined : trashFiltered[0]);
        /** 工具栏按钮上的条数:回收站视图用已读到的条目数,否则用目录快照里的计数。 */
        const trashCount = trashOpen ? trashAll.length : (catalog?.counts?.trash ?? 0);
        const scopeText = catalog === undefined ? ''
          : catalog.tier === 'process-cwd' || catalog.tier === 'global' ? t('scopeCwd')
            : catalog.tier === 'preset-scope' ? t('scopePreset') : t('scopeLive');

        /**
         * 切换浏览的会话作用域。
         *
         * 切换会换掉整份技能目录(以及写操作解析出的项目根),所以旧的选中项、
         * 正文预览、删除确认与回收站视图全部作废;有未保存的开关改动时下拉是禁用的,
         * 不会走到这里把改动悄悄丢掉。目录先清成 undefined,渲染出"正在读取",
         * 避免新选择器下面短暂挂着上一个作用域的技能列表;真正的重读由
         * `load` 的依赖(scopeValue)变化触发。
         * @param next - 下拉选中的会话 id;空串 = 自动。
         */
        const switchScope = (next) => {
          const value = String(next ?? '');
          if (value === scopeValue) return;
          setScopeSessionId(value);
          setCatalog(undefined);
          setSelected(undefined);
          setBody(undefined);
          setPendingDelete(false);
          setPendingEdits({});
          setShownEdits({});
          setSavedOnce(false);
          setCreating(false);
          setTrashOpen(false);
          setTrash(undefined);
          setSelectedTrash(undefined);
          setPendingEmpty(false);
          setPendingTrashDelete(false);
          setError(undefined);
        };

        /**
         * 跑一个写操作,然后重读目录。成功不弹任何提示:面板本身的状态变化
         * (开关、按钮三态、列表增删)就是反馈;失败才写错误条。
         * @param action - 返回 Promise 的动作。
         */
        const mutate = async (action) => {
          setBusy(true);
          setError(undefined);
          try {
            await action();
            await load();
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        };

        /**
         * 一个技能此刻该显示的调用策略:本地改动优先,其次目录快照。
         * @param skill - 目录条目。
         * @returns `{ modelInvocable, userInvocable }`。
         */
        const shownInvocation = (skill) => {
          const local = shownEdits[skill.name] ?? {};
          return {
            modelInvocable: local.modelInvocable ?? (skill.modelInvocable !== false),
            userInvocable: local.userInvocable ?? (skill.userInvocable !== false),
          };
        };

        /**
         * 拨一个开关:只改本地状态,界面立刻反映,写盘交给"保存"。
         * @param skill - 目录条目。
         * @param patch - 本次改动的字段。
         */
        const editInvocation = (skill, patch) => {
          setShownEdits((previous) => ({
            ...previous,
            [skill.name]: { ...(previous[skill.name] ?? {}), ...patch },
          }));
          setPendingEdits((previous) => ({
            ...previous,
            [skill.name]: { ...(previous[skill.name] ?? {}), ...patch },
          }));
          setSavedOnce(false);
          setError(undefined);
        };

        /**
         * 保存全部未保存的调用策略改动:逐个 POST,然后重读目录。
         * 重读拿到的可能仍是旧快照(目录缓存),所以显示值继续由 shownEdits 兜住,
         * 直到快照追平 —— 撤销覆盖的逻辑在 load() 里。
         */
        const saveEdits = async () => {
          const entries = Object.entries(pendingEdits);
          if (entries.length === 0) return;
          setBusy(true);
          setError(undefined);
          try {
            for (const [name, patch] of entries) {
              const skill = skills.find((candidate) => candidate.name === name);
              if (skill === undefined) continue;
              const target = { ...shownInvocation(skill), ...patch };
              await apiPost({
                op: 'setInvocation',
                ...pickScope(sessions, scopeCache, scopeValue),
                name,
                modelInvocable: target.modelInvocable,
                userInvocable: target.userInvocable,
              });
            }
            setPendingEdits({});
            setSavedOnce(true);
            await load();
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        };

        /**
         * 把当前技能导出成 .zip 并触发下载。文件落盘本身就是反馈,不弹提示。
         * @param skill - 目录条目。
         */
        const exportSkill = async (skill) => {
          setBusy(true);
          setError(undefined);
          try {
            const payload = await apiPost({ op: 'export', ...pickScope(sessions, scopeCache, scopeValue), name: skill.name });
            const binary = atob(String(payload.base64 ?? ''));
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = payload.filename ?? `${skill.name}.zip`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        };

        /**
         * 读用户选的文件,POST 给宿主导入;成功后选中新技能并重读目录。
         * @param event - file input 的 change 事件。
         */
        const importSkillFile = async (event) => {
          const input = event?.target;
          const file = input?.files?.[0];
          if (input !== undefined) input.value = '';
          if (file === undefined || file === null) return;
          setBusy(true);
          setError(undefined);
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = '';
            const chunk = 0x8000;
            for (let offset = 0; offset < bytes.length; offset += chunk) {
              binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk));
            }
            const payload = await apiPost({
              op: 'importSkill',
              ...pickScope(sessions, scopeCache, scopeValue),
              base64: btoa(binary),
              filename: file.name,
            });
            setSelected(payload.name);
            setCreating(false);
            setTrashOpen(false);
            await load();
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        };

        /** 有多少个技能带着未保存的改动。 */
        const pendingCount = Object.keys(pendingEdits).length;
        const saveLabel = pendingCount === 0
          ? (savedOnce ? t('saved') : t('unmodified'))
          : pendingCount === 1 ? t('save') : `${t('save')} (${pendingCount})`;

        const removeSkill = (skill) => mutate(
          async () => {
            await apiPost({ op: 'delete', ...pickScope(sessions, scopeCache, scopeValue), name: skill.name });
            setSelected(undefined);
            setBody(undefined);
            setPendingDelete(false);
            setPendingEdits((previous) => {
              if (!(skill.name in previous)) return previous;
              const next = { ...previous };
              delete next[skill.name];
              return next;
            });
            setShownEdits((previous) => {
              if (!(skill.name in previous)) return previous;
              const next = { ...previous };
              delete next[skill.name];
              return next;
            });
          },
        );

        /** 打开回收站:离开新建/删除确认,读一次 `.trash`。 */
        const openTrash = () => {
          setTrashOpen(true);
          setCreating(false);
          setPendingDelete(false);
          setPendingEmpty(false);
          setPendingTrashDelete(false);
          setBody(undefined);
          setError(undefined);
          loadTrash();
        };

        /** 关掉回收站,回到技能列表。 */
        const closeTrash = () => {
          setTrashOpen(false);
          setTrash(undefined);
          setSelectedTrash(undefined);
          setPendingEmpty(false);
          setPendingTrashDelete(false);
        };

        /** 恢复一条:宿主把它移回原技能根,成功后重读回收站与技能目录。 */
        const restoreEntry = (entry) => mutate(async () => {
          await apiPost({
            op: 'restore',
            ...pickScope(sessions, scopeCache, scopeValue),
            rootId: entry.rootId,
            entry: entry.entry,
          });
          setSelected(entry.name);
          setPendingEmpty(false);
          setPendingTrashDelete(false);
          await loadTrash();
        });

        /** 删除回收站里的单条记录(已确认):永久移除,再重读回收站。 */
        const removeTrashEntry = (entry) => mutate(async () => {
          await apiPost({
            op: 'deleteTrash',
            ...pickScope(sessions, scopeCache, scopeValue),
            rootId: entry.rootId,
            entry: entry.entry,
          });
          setPendingEmpty(false);
          setPendingTrashDelete(false);
          await loadTrash();
        });

        /** 清空回收站(已确认):永久删除所有条目,再重读两边的状态。 */
        const emptyTrash = () => mutate(async () => {
          await apiPost({ op: 'emptyTrash', ...pickScope(sessions, scopeCache, scopeValue) });
          setPendingEmpty(false);
          setPendingTrashDelete(false);
          await loadTrash();
        });

        const loadBody = async (skill) => {
          setBusy(true);
          setError(undefined);
          try {
            const payload = await apiPost({ op: 'read', ...pickScope(sessions, scopeCache, scopeValue), name: skill.name });
            setBody(payload.text);
          } catch (cause) {
            setError(String(cause?.message ?? cause));
          } finally {
            setBusy(false);
          }
        };

        /**
         * 顶部工具栏里的批量操作:清空回收站。二次确认时"取消"排在
         * "确认清空?"左边 —— 与删除确认同一约定。
         */
        const trashBulkControls = trashOpen
          ? (pendingEmpty ? [
            h('button', {
              key: 'empty-cancel',
              type: 'button',
              className: 'dsh-sc-btn',
              disabled: busy,
              onClick: () => setPendingEmpty(false),
            }, t('cancel')),
            h('button', {
              key: 'empty-confirm',
              type: 'button',
              className: 'dsh-sc-btn dsh-sc-btn-danger',
              disabled: busy || trashAll.length === 0,
              onClick: emptyTrash,
            }, t('emptyTrashConfirm')),
            h('span', { key: 'empty-hint', className: 'dsh-sc-hint' }, t('emptyTrashHint')),
          ] : [h('button', {
            key: 'empty',
            type: 'button',
            className: 'dsh-sc-btn',
            disabled: busy || trashAll.length === 0,
            onClick: () => setPendingEmpty(true),
          }, t('emptyTrash'))])
          : [];

        const head = h('div', { className: 'dsh-sc-head', key: 'head' }, [
          h('div', { className: 'dsh-sc-headrow', key: 'r1' }, [
            h('span', { className: 'dsh-sc-title', key: 't' }, t('title')),
            h('span', { className: 'dsh-sc-sub', key: 's' }, catalog === undefined
              ? t('subtitle')
              : `${t('total', { n: skills.length })} · ${scopeText}`),
            h('span', { className: 'dsh-sc-spacer', key: 'sp' }),
            h('button', {
              key: 'save',
              type: 'button',
              className: `dsh-sc-btn${pendingCount > 0 ? ' dsh-sc-btn-primary' : ''}`,
              disabled: busy || pendingCount === 0,
              title: t('saveHint'),
              onClick: saveEdits,
            }, saveLabel),
            h('button', {
              key: 'back',
              type: 'button',
              className: 'dsh-sc-btn',
              onClick: () => { try { ctx.get('layout')?.selectPanel?.(null); } catch { /* 布局服务不可用 */ } },
            }, t('back')),
          ]),
          h('div', { className: 'dsh-sc-tools', key: 'r2' }, [
            // 作用域选择:默认"自动"沿用原来的跟随逻辑(主区域会话 → 最近会话),
            // 选中某个会话后,读目录与所有写操作都改用它解析 cwd/预设。
            // 候选来自 sessions.list,按 workspaces 的工作区分组,已归档会话被剔除。
            h('div', { key: 'scope', className: 'dsh-sc-scope' }, [
              h('span', { key: 'l', className: 'dsh-sc-hint' }, t('scopeLabel')),
              h(Dropdown, {
                key: 'd',
                value: scopeValue,
                label: scopeLabelText,
                groups: scopeGroups,
                onChange: switchScope,
                disabled: busy || pendingCount > 0,
                title: pendingCount > 0 ? t('scopePending') : t('scopeHint'),
                ariaLabel: t('scopeLabel'),
                menuWidth: 300,
              }),
            ]),
            h('input', {
              key: 'q',
              type: 'search',
              className: 'dsh-sc-input',
              placeholder: t('search'),
              value: query,
              onChange: (event) => setQuery(event.target.value),
            }),
            sources.length > 1 ? h(Dropdown, {
              key: 'f',
              value: sourceFilter,
              options: [
                { value: '', label: t('filterAll') },
                ...sources.map((source) => ({ value: source, label: source })),
              ],
              onChange: (next) => setSourceFilter(String(next ?? '')),
              ariaLabel: t('filterSource'),
              menuWidth: 200,
            }) : null,
            h('button', {
              key: 'trash',
              type: 'button',
              className: `dsh-sc-btn${trashOpen ? ' dsh-sc-btn-primary' : ''}`,
              onClick: () => { if (trashOpen) closeTrash(); else openTrash(); },
            }, trashOpen
              ? t('backToList')
              : trashCount > 0 ? `${t('trash')} (${trashCount})` : t('trash')),
            trashBulkControls,
            h('button', {
              key: 'new',
              type: 'button',
              className: 'dsh-sc-btn',
              onClick: () => {
                setTrashOpen(false);
                setCreating((value) => !value);
                setPendingDelete(false);
                setPendingEmpty(false);
              },
            }, t('create')),
            // 用 <label> 包住隐藏的 file input:点标签就打开文件选择器,不需要 ref。
            h('label', {
              key: 'import',
              className: 'dsh-sc-btn',
              title: t('importHint'),
              style: { cursor: 'pointer' },
            }, [
              t('importSkill'),
              h('input', {
                key: 'file',
                type: 'file',
                accept: '.zip,.md,application/zip,text/markdown',
                style: { display: 'none' },
                onChange: importSkillFile,
              }),
            ]),
            h('button', {
              key: 'refresh',
              type: 'button',
              className: 'dsh-sc-btn',
              disabled: busy,
              onClick: () => {
                setBody(undefined);
                load();
                if (trashOpen) loadTrash();
              },
            }, t('refresh')),
          ]),
        ]);

        const list = h('div', { className: 'dsh-sc-list', key: 'list' },
          trashOpen
            ? (trashFiltered.length === 0
              ? [h('div', {
                key: 'te',
                className: 'dsh-sc-hint',
                style: { padding: '10px' },
              }, trashAll.length === 0 ? t('trashEmpty') : t('empty'))]
              : trashFiltered.map((entry) => h('button', {
                key: trashKey(entry),
                type: 'button',
                className: `dsh-sc-row${currentTrash !== undefined && trashKey(currentTrash) === trashKey(entry) ? ' dsh-sc-row-on' : ''}`,
                onClick: () => {
                  setSelectedTrash(trashKey(entry));
                  setPendingEmpty(false);
                  setPendingTrashDelete(false);
                },
              }, [
                h('span', { key: 'n', className: 'dsh-sc-name' }, entry.name),
                h('span', { key: 'm', className: 'dsh-sc-meta' }, [
                  h('span', { key: 'r', className: 'dsh-sc-badge' }, entry.rootLabel ?? entry.rootId ?? '—'),
                ]),
                h('span', { key: 'd', className: 'dsh-sc-desc' }, formatDeletedAt(entry)),
              ])))
            : filtered.length === 0
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
        if (trashOpen) {
          detail = currentTrash === undefined
            ? h('div', { key: 'tempty', className: 'dsh-sc-center' }, t('trashEmpty'))
            : h('div', { key: 'tdetail', className: 'dsh-sc-detail' }, [
              h('h2', { key: 'h', className: 'dsh-sc-h2' }, currentTrash.name),
              h('p', { key: 'th', className: 'dsh-sc-p' }, t('trashHint')),
              h('div', { key: 'kv', className: 'dsh-sc-section' }, [
                h('div', { key: 'l', className: 'dsh-sc-label' }, t('path')),
                h('dl', { key: 'd', className: 'dsh-sc-kv' }, [
                  h('dt', { key: 'r' }, t('root')), h('dd', { key: 'rv' }, currentTrash.rootLabel ?? currentTrash.rootId ?? '—'),
                  h('dt', { key: 'f' }, t('path')), h('dd', { key: 'fv' }, currentTrash.path ?? '—'),
                  h('dt', { key: 't' }, t('deletedAt')), h('dd', { key: 'tv' }, formatDeletedAt(currentTrash)),
                ]),
              ]),
              h('div', { key: 'act', className: 'dsh-sc-actions' }, [
                h('button', {
                  key: 'restore',
                  type: 'button',
                  className: 'dsh-sc-btn dsh-sc-btn-primary',
                  disabled: busy,
                  onClick: () => restoreEntry(currentTrash),
                }, t('restore')),
                // 与技能删除同一约定:待确认时"取消"排在危险按钮左边。
                pendingTrashDelete ? h('button', {
                  key: 'cancel',
                  type: 'button',
                  className: 'dsh-sc-btn',
                  disabled: busy,
                  onClick: () => setPendingTrashDelete(false),
                }, t('cancel')) : null,
                h('button', {
                  key: 'trash-del',
                  type: 'button',
                  className: `dsh-sc-btn${pendingTrashDelete ? ' dsh-sc-btn-danger' : ''}`,
                  disabled: busy,
                  onClick: () => {
                    if (pendingTrashDelete) removeTrashEntry(currentTrash);
                    else setPendingTrashDelete(true);
                  },
                }, pendingTrashDelete ? t('deleteConfirm') : t('delete')),
                pendingTrashDelete ? h('span', { key: 'tdh', className: 'dsh-sc-hint' }, t('deleteTrashHint')) : null,
              ]),
            ]);
        } else if (creating) {
          detail = h(CreateForm, {
            key: 'create',
            t,
            catalog,
            scopeCache,
            sessions,
            pinnedScope: scopeValue,
            onDone: () => { setCreating(false); load(); },
            onCancel: () => setCreating(false),
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
                checked: shownInvocation(current).modelInvocable,
                disabled: busy || current.writable !== true,
                label: t('model'),
                hint: t('modelHint'),
                onChange: (value) => editInvocation(current, { modelInvocable: value }),
              }),
              h(Switch, {
                key: 'user',
                checked: shownInvocation(current).userInvocable,
                disabled: busy || current.writable !== true,
                label: t('user'),
                hint: t('userHint'),
                onChange: (value) => editInvocation(current, { userInvocable: value }),
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
                key: 'export',
                type: 'button',
                className: 'dsh-sc-btn',
                disabled: busy || current.writable !== true,
                title: t('exportHint'),
                onClick: () => exportSkill(current),
              }, t('export')),
              // 待确认时,"取消"排在"确认删除?"左边:先给退路,再给危险动作。
              pendingDelete ? h('button', {
                key: 'cancel',
                type: 'button',
                className: 'dsh-sc-btn',
                disabled: busy,
                onClick: () => setPendingDelete(false),
              }, t('cancel')) : null,
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
          catalog === undefined && error === undefined
            ? h('div', { key: 'loading', className: 'dsh-sc-center' }, t('loading'))
            : h('div', { key: 'body', className: 'dsh-sc-body' }, [list, detail]),
          foot,
        ]);
      };
    }

    /**
     * 新建技能表单。
     * @param props - `{ t, catalog, scopeCache, sessions, pinnedScope, onDone, onCancel, onError }`。
     * @returns 表单元素。
     */
    function CreateForm({ t, catalog, scopeCache, sessions, pinnedScope, onDone, onCancel, onError }) {
      const [name, setName] = React.useState('');
      const [description, setDescription] = React.useState('');
      const [body, setBody] = React.useState('');
      const [rootId, setRootId] = React.useState('user-agents');
      const [busy, setBusy] = React.useState(false);
      const roots = (catalog?.roots ?? []).filter((root) => root.id === 'user-agents' || root.id === 'user-dsh');
      const submit = async () => {
        setBusy(true);
        try {
          await apiPost({
            op: 'create',
            ...pickScope(sessions, scopeCache, pinnedScope),
            name,
            description,
            body,
            rootId,
          });
          // 建好就收表单:列表刷新后能看到新技能,不再另弹提示。
          onDone();
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
            h(Dropdown, {
              key: 's',
              value: rootId,
              options: roots.map((root) => ({
                value: root.id,
                label: root.label,
                hint: root.path,
                title: root.path,
              })),
              onChange: (next) => setRootId(String(next ?? '')),
              ariaLabel: t('formRoot'),
              menuWidth: 300,
            }),
          ]),
          h('p', { key: 'rh', className: 'dsh-sc-hint', style: { margin: 0 } }, t('formRootHint')),
          h('div', { key: 'a', className: 'dsh-sc-actions' }, [
            h('button', {
              key: 'cancel',
              type: 'button',
              className: 'dsh-sc-btn',
              disabled: busy,
              onClick: onCancel,
            }, t('cancel')),
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
})();

