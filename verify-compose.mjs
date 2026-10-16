/**
 * 离线复现 @deepseek-ai/dsh-client-modules 的合成校验:
 * 按 profile 的 dsh.profile.bundles 顺序读各包的 package.json,
 * 检查 dsh.client 声明、exports["./client"]、inject 提供方是否存在、
 * 客户端 bundle 自己注册的 module id 是否等于包名(浏览器模块图的行 id,也是 HMR
 * 失效时用的 key),以及 **bundle patch 里那条 loader 行名能否解析回本包的 package.json**
 * (宿主侧 resolveMeta → nearestPackage 是严格按名字比的)。这两条都是回归护栏:
 * 行名写成裸名时宿主半边照挂、浏览器半边被静默丢弃;注册 id 用裸名时,
 * HMR 的 rebuilt 帧清不掉旧工厂,新版 bundle 一到就报 duplicate factory registration。
 *
 * 用途:在不动宿主进程的前提下确认 dsh-skill-center 的客户端半侧会被
 * 浏览器模块图接受(宿主侧的增量扫描由 loader 挂载事件驱动,见
 * dsh-client-modules/lib/index.js:527-540)。
 *
 * 运行: node verify-compose.mjs [profileDir] [patchPath]
 *   第二个参数可指定要额外核对的 bundle patch(默认核对本仓库根的 cordis.patch.yml)。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_NAME = '@restregular/dsh-skill-center';
/**
 * 客户端 bundle 必须用**包名本身**调 `__ModuleLoader__.load({ id })`。
 * 理由:`ClientModuleSystem.invalidate(id, rev)`(HMR `rebuilt` 帧 → `entries.reload`)
 * 只按行 id 删工厂表条目,而行 id 就是包名。注册 id 与包名不一致时,旧工厂留在表里,
 * 新版 bundle 一执行就抛 `duplicate factory registration`,把 web boot 打成
 * "1 entry did not activate"。
 */
const MODULE_ID = PACKAGE_NAME;

const profileDir = process.argv[2] ?? 'C:/Users/32280/.dsh/profiles/desktop';
/** dsh 安装目录:随发行版交付的 bundle 从这里解析(Electron 的 asar 感知 fs 可直读)。 */
const installDir = process.env.DSH_INSTALL_DIR ?? 'D:/soft/dsh/resources/app.asar';
const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
const bundles = manifest.dsh?.profile?.bundles ?? [];

const failures = [];
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined || ok ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

/** 读一个包:先在 profile 的 node_modules 找,再从 dsh 安装目录找。 */
function readPackage(name) {
  const candidates = [
    join(profileDir, 'node_modules', ...name.split('/')),
    join(installDir, 'dsh', 'node_modules', ...name.split('/')),
  ];
  for (const dir of candidates) {
    const file = join(dir, 'package.json');
    if (!existsSync(file)) continue;
    try {
      return { dir, json: JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      /* 读到坏包继续找下一个 */
    }
  }
  return undefined;
}

/** 复现 clientExportOf:解析 exports["./client"] 到相对路径。 */
function clientExportOf(pkg) {
  const field = pkg.exports?.['./client'];
  if (typeof field === 'string') return field;
  if (field !== null && typeof field === 'object' && typeof field.default === 'string') return field.default;
  return undefined;
}

console.log(`== profile: ${profileDir} ==`);
console.log(`bundles: ${bundles.length}\n`);

/**
 * 收集候选包名:顶层 bundle + 每个 bundle 的 cordis.patch.yml 里声明的 loader 行
 * (随发行版交付的客户端包由 web-app 的 patch 层声明,不在 dsh.profile.bundles 里)。
 * @returns 去重后的包名数组。
 */
function collectCandidates() {
  const names = new Set(bundles);
  const patchFiles = [];
  for (const name of bundles) {
    const pkg = readPackage(name);
    if (pkg === undefined) continue;
    const declared = pkg.json.dsh?.bundle?.patch;
    const patchPath = join(pkg.dir, typeof declared === 'string' ? declared : 'cordis.patch.yml');
    if (existsSync(patchPath)) patchFiles.push(patchPath);
  }
  const profilePatch = join(profileDir, 'cordis.patch.yml');
  if (existsSync(profilePatch)) patchFiles.push(profilePatch);
  for (const file of patchFiles) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^\s*(?:-\s*)?name:\s*'([^']+)'/gm)) names.add(match[1]);
  }
  return [...names];
}

/**
 * 复现 dsh-client-modules 的 `nearestPackage`:从解析到的模块文件向上找最近的
 * package.json,名字必须与期望的包名逐字相等。
 * @param moduleUrl - `file:` 开头的模块 URL。
 * @param expectedPackageName - loader 行名,也是期望的包名。
 * @returns 命中的 `{ path, packageName }`,未命中返回 undefined。
 */
function nearestPackage(moduleUrl, expectedPackageName) {
  if (!moduleUrl.startsWith('file:')) return undefined;
  let dir = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const name = JSON.parse(readFileSync(candidate, 'utf8')).name;
        if (typeof name === 'string' && name === expectedPackageName) return { path: candidate, packageName: name };
      } catch {
        /* 坏包继续向上 */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * 复现 dsh-client-modules 的 `resolveMeta`:按 loader 行名解析 package.json,
 * 再严格比对名字。返回 null 的行会被宿主静默丢弃,浏览器端 `/plugins/<包名>/client.js` 404。
 * @param loaderName - bundle patch 里那条 loader 行的 name。
 * @param baseUrl - 该行的解析基准(profile 目录)。
 * @returns 判定结论。
 */
function resolveLoaderRow(loaderName, baseUrl) {
  const require_ = createRequire(join(baseUrl, 'package.json'));
  let resolved;
  try {
    resolved = require_.resolve(`${loaderName}/package.json`);
  } catch (error) {
    return { ok: false, detail: `解析失败 ${error.code}`, resolved: undefined };
  }
  const found = nearestPackage(pathToFileURL(resolved).href, loaderName);
  if (found === undefined) return { ok: false, detail: `nearestPackage 严格比对 name 失败(行名 ${loaderName})`, resolved };
  return { ok: true, detail: `${found.packageName} @ ${found.path}`, resolved };
}

const roster = [];
for (const name of collectCandidates()) {
  if (name === 'cordis:group') continue;
  const pkg = readPackage(name);
  if (pkg === undefined) continue;
  const client = pkg.json.dsh?.client;
  if (client === undefined || client.platform !== 'web') continue;
  const bundlePath = clientExportOf(pkg.json);
  roster.push({ name, dir: pkg.dir, client, bundlePath });
  console.log(`  ok   ${name}: bundle=${bundlePath ?? '(缺失)'}`);
}

console.log(`\n== 客户端 roster: ${roster.length} 个 ==`);
const ids = new Set(roster.map((row) => row.name));

console.log('\n== dsh-skill-center 校验 ==');
const mine = roster.find((row) => row.name === PACKAGE_NAME);
check(`在 roster 中(声明了 dsh.client.platform="web"): ${PACKAGE_NAME}`, mine !== undefined);
if (mine !== undefined) {
  check('exports["./client"] 可解析', typeof mine.bundlePath === 'string', JSON.stringify(mine.bundlePath));
  const bundleFile = join(mine.dir, mine.bundlePath ?? '');
  check('客户端 bundle 文件存在', existsSync(bundleFile), bundleFile);
  if (existsSync(bundleFile)) {
    const source = readFileSync(bundleFile, 'utf8');
    // 注册 id 可以直接写成字面量,也可以走 `const MODULE_ID = '…'` 再传引用。
    const idMatch = /__ModuleLoader__\.load\(\{\s*id:\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/.exec(source);
    const constantMatch = /const\s+MODULE_ID\s*=\s*'([^']+)'/.exec(source);
    const registeredId =
      idMatch?.[1] ?? (idMatch?.[2] === 'MODULE_ID' ? constantMatch?.[1] : idMatch?.[2]);
    check(
      `bundle 注册的 id 等于包名(行 id,供 HMR invalidate 用): ${MODULE_ID}`,
      registeredId === MODULE_ID,
      registeredId,
    );
    check('bundle 导出 apply/inject', /return\s*\{\s*apply,\s*inject\s*\}/.test(source) || /exports\.apply/.test(source));
  }
  for (const provider of mine.client.inject ?? []) {
    check(`dsh.client.inject 提供方存在: ${provider}`, ids.has(provider));
  }
  const entryFile = join(mine.dir, mine.json?.main ?? 'lib/index.js');
  check('宿主入口存在', existsSync(join(mine.dir, 'lib/index.js')), entryFile);

  // 这一条是 0.2.0 漏掉「技能中心」那个 bug 的护栏:bundle patch 的 loader 行名
  // 必须解析回本包的 package.json,否则宿主半边能挂、客户端半边被静默丢弃。
  const patchCandidates = [
    process.argv[3] ?? fileURLToPath(new URL('./cordis.patch.yml', import.meta.url)),
    join(mine.dir, mine.json?.dsh?.bundle?.patch ?? 'cordis.patch.yml'),
  ];
  for (const patchPath of patchCandidates) {
    check(`bundle patch 存在: ${patchPath}`, existsSync(patchPath), patchPath);
    if (!existsSync(patchPath)) continue;
    const rows = [...readFileSync(patchPath, 'utf8').matchAll(/^\s*(?:-\s*)?name:\s*'([^']+)'/gm)].map((m) => m[1]);
    check(`bundle patch 声明了 loader 行: ${patchPath}`, rows.length > 0, JSON.stringify(rows));
    for (const row of rows) {
      const verdict = resolveLoaderRow(row, profileDir);
      check(`loader 行名可解析回本包: ${row} (${patchPath})`, verdict.ok, verdict.detail);
    }
  }
}

console.log(`\n${failures.length === 0 ? 'COMPOSE OK' : `FAILURES: ${failures.join(' | ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
