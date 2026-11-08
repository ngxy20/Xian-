/**
 * Xian优化器 — project scanner.
 *
 * Builds a compact, deterministic index of a repository: stack, architecture,
 * symbols, imports, routes, tests and changed files. It never executes project
 * code and never writes into the scanned project.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  NON_CODE_EXTENSIONS,
  SKIP_DIRS,
  TEXT_EXTENSIONS,
  collectTerms,
  formatBytes,
  relativePosix,
  toPosix,
  tryJson,
} from './util.mjs';

const DEFAULT_MAX_FILES = 6000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const CONTENT_READ_LIMIT = 384 * 1024;
const MAX_SYMBOLS_PER_FILE = 80;
const MAX_IMPORTS_PER_FILE = 60;
const MAX_TERMS_PER_FILE = 80;

const JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro']);
const PY_EXTENSIONS = new Set(['.py', '.pyi']);
const TEST_PATH = /(^|\/)(__tests__|tests?|specs?|e2e)(\/|$)|\.(test|spec|e2e)\.[^.]+$|(^|\/)(test_[^/]+|[^/]+_test\.[^.]+)$/i;
const CONFIG_NAME = /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|tsconfig[^/]*\.json|jsconfig[^/]*\.json|vite\.config\.[^.]+|vitest\.config\.[^.]+|jest\.config\.[^.]+|playwright\.config\.[^.]+|next\.config\.[^.]+|nuxt\.config\.[^.]+|webpack\.config\.[^.]+|rollup\.config\.[^.]+|eslint\.config\.[^.]+|\.eslintrc[^/]*|\.prettierrc[^/]*|pyproject\.toml|requirements[^/]*\.txt|setup\.py|Pipfile|Cargo\.toml|go\.mod|pom\.xml|build\.gradle[^/]*|composer\.json|Gemfile|pubspec\.yaml|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|\.env[^/]*)$/i;
const GENERATED_PATH = /(^|\/)(dist|build|out|coverage|generated|gen|vendor|third_party|node_modules)\/|\.min\.(js|css)$|\.bundle\.js$|\.map$/i;

const LANGUAGE_BY_EXT = new Map([
  ['.ts', 'TypeScript'], ['.tsx', 'TypeScript'], ['.mts', 'TypeScript'], ['.cts', 'TypeScript'],
  ['.js', 'JavaScript'], ['.jsx', 'JavaScript'], ['.mjs', 'JavaScript'], ['.cjs', 'JavaScript'],
  ['.vue', 'Vue'], ['.svelte', 'Svelte'], ['.astro', 'Astro'],
  ['.py', 'Python'], ['.pyi', 'Python'],
  ['.go', 'Go'], ['.rs', 'Rust'],
  ['.java', 'Java'], ['.kt', 'Kotlin'], ['.kts', 'Kotlin'], ['.scala', 'Scala'], ['.groovy', 'Groovy'],
  ['.cs', 'C#'], ['.fs', 'F#'],
  ['.c', 'C'], ['.cc', 'C++'], ['.cpp', 'C++'], ['.cxx', 'C++'], ['.h', 'C/C++'], ['.hpp', 'C++'],
  ['.php', 'PHP'], ['.rb', 'Ruby'], ['.swift', 'Swift'], ['.dart', 'Dart'], ['.lua', 'Lua'],
  ['.sql', 'SQL'], ['.sh', 'Shell'], ['.bash', 'Shell'], ['.ps1', 'PowerShell'],
  ['.css', 'CSS'], ['.scss', 'SCSS'], ['.sass', 'Sass'], ['.less', 'Less'],
  ['.html', 'HTML'], ['.htm', 'HTML'], ['.xml', 'XML'],
  ['.md', 'Markdown'], ['.mdx', 'MDX'], ['.json', 'JSON'], ['.yaml', 'YAML'], ['.yml', 'YAML'],
  ['.toml', 'TOML'],
]);

const FRAMEWORK_DEPS = [
  ['react', 'React'], ['react-dom', 'React'], ['next', 'Next.js'], ['vue', 'Vue'], ['nuxt', 'Nuxt'],
  ['svelte', 'Svelte'], ['@sveltejs/kit', 'SvelteKit'], ['@angular/core', 'Angular'],
  ['solid-js', 'Solid'], ['preact', 'Preact'], ['astro', 'Astro'],
  ['express', 'Express'], ['fastify', 'Fastify'], ['koa', 'Koa'], ['@hapi/hapi', 'hapi'], ['hono', 'Hono'],
  ['@nestjs/core', 'NestJS'], ['electron', 'Electron'], ['@tauri-apps/api', 'Tauri'],
  ['django', 'Django'], ['flask', 'Flask'], ['fastapi', 'FastAPI'], ['starlette', 'Starlette'],
  ['spring-boot', 'Spring Boot'], ['quarkus', 'Quarkus'], ['micronaut', 'Micronaut'],
  ['gin', 'Gin'], ['echo', 'Echo'], ['fiber', 'Fiber'], ['rails', 'Rails'], ['laravel/framework', 'Laravel'],
  ['symfony/framework-bundle', 'Symfony'], ['flutter', 'Flutter'],
  ['prisma', 'Prisma'], ['@prisma/client', 'Prisma'], ['drizzle-orm', 'Drizzle'], ['typeorm', 'TypeORM'],
  ['sequelize', 'Sequelize'], ['mongoose', 'Mongoose'],
  ['vitest', 'Vitest'], ['jest', 'Jest'], ['playwright', 'Playwright'], ['@playwright/test', 'Playwright'],
  ['cypress', 'Cypress'], ['pytest', 'pytest'], ['tailwindcss', 'Tailwind CSS'],
  ['styled-components', 'styled-components'], ['@emotion/react', 'Emotion'],
  ['vite', 'Vite'], ['webpack', 'webpack'], ['turbo', 'Turborepo'], ['nx', 'Nx'],
];

const COMMAND_LABELS = [
  ['dev', '开发'], ['start', '启动'], ['build', '构建'], ['test', '测试'], ['lint', 'lint'],
  ['typecheck', '类型检查'], ['check', '检查'], ['format', '格式化'], ['e2e', '端到端测试'],
];

const PY_FRAMEWORK_RULES = [
  ['torch', 'PyTorch'],
  ['transformers', 'HuggingFace Transformers'],
  ['tensorflow', 'TensorFlow'],
  ['requests', 'requests'],
  ['httpx', 'httpx'],
  ['aiohttp', 'aiohttp'],
  ['flask', 'Flask'],
  ['fastapi', 'FastAPI'],
  ['django', 'Django'],
  ['uvicorn', 'Uvicorn'],
  ['websockets', 'websockets'],
  ['websocket', 'websocket-client'],
  ['nonebot', 'NoneBot'],
  ['selenium', 'Selenium'],
  ['pandas', 'pandas'],
  ['numpy', 'NumPy'],
  ['cv2', 'OpenCV'],
  ['openai', 'OpenAI SDK'],
  ['jieba', 'jieba'],
];

function isConfigFile(rel) {
  return CONFIG_NAME.test(path.posix.basename(rel));
}

function isDocFile(ext) {
  return ext === '.md' || ext === '.mdx' || ext === '.rst' || ext === '.adoc' || ext === '.txt';
}

function shouldSkipDir(name, rel) {
  if (SKIP_DIRS.has(name)) return true;
  // Index project-local skills too: when the repository itself is a skill
  // package, its source lives under .dsh/skills and must be locatable.
  if (rel === '.xian' || rel.startsWith('.xian/')) return true;
  return false;
}

function languageOf(ext) {
  return LANGUAGE_BY_EXT.get(ext) ?? ext.replace(/^\./, '').toUpperCase() ?? 'Other';
}

function countLines(text) {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1;
  return count;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

async function readText(file, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const slice = buffer.subarray(0, bytesRead);
    if (slice.includes(0)) return null;
    return slice.toString('utf8');
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readJson(file) {
  try {
    return tryJson(await fs.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function parsePackageJson(pkg) {
  if (!pkg || typeof pkg !== 'object') return undefined;
  const dependencies = {
    ...(pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}),
    ...(pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {}),
    ...(pkg.peerDependencies && typeof pkg.peerDependencies === 'object' ? pkg.peerDependencies : {}),
  };
  return {
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    version: typeof pkg.version === 'string' ? pkg.version : undefined,
    private: pkg.private === true,
    type: typeof pkg.type === 'string' ? pkg.type : undefined,
    main: typeof pkg.main === 'string' ? pkg.main : undefined,
    module: typeof pkg.module === 'string' ? pkg.module : undefined,
    scripts: pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {},
    dependencies: Object.keys(dependencies),
    workspaces: Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages,
  };
}

function detectFrameworks(deps, fileNames) {
  const found = [];
  const lower = new Set(deps.map((dep) => dep.toLowerCase()));
  for (const [dep, label] of FRAMEWORK_DEPS) {
    if (lower.has(dep.toLowerCase()) && !found.some((item) => item.name === label)) {
      found.push({ name: label, evidence: `依赖 ${dep}` });
    }
  }
  const names = fileNames.join(' ').toLowerCase();
  const rules = [
    [/manage\.py|settings\.py/, 'Django'],
    [/next\.config\./, 'Next.js'],
    [/nuxt\.config\./, 'Nuxt'],
    [/vite\.config\./, 'Vite'],
    [/angular\.json/, 'Angular'],
    [/pubspec\.yaml/, 'Flutter'],
    [/go\.mod/, 'Go Modules'],
    [/cargo\.toml/, 'Cargo'],
    [/pom\.xml|build\.gradle/, 'JVM'],
    [/dockerfile|docker-compose/, 'Docker'],
  ];
  for (const [re, label] of rules) {
    if (re.test(names) && !found.some((item) => item.name === label)) {
      found.push({ name: label, evidence: '项目文件' });
    }
  }
  return found.slice(0, 10);
}

function detectPackageManagers(fileNames) {
  const set = new Set();
  if (fileNames.includes('pnpm-lock.yaml')) set.add('pnpm');
  if (fileNames.includes('yarn.lock')) set.add('yarn');
  if (fileNames.includes('bun.lockb') || fileNames.includes('bun.lock')) set.add('bun');
  if (fileNames.includes('package-lock.json')) set.add('npm');
  if (fileNames.includes('package.json') && set.size === 0) set.add('npm');
  if (fileNames.includes('uv.lock')) set.add('uv');
  if (fileNames.includes('poetry.lock')) set.add('poetry');
  if (fileNames.includes('Pipfile')) set.add('pipenv');
  if (fileNames.includes('pyproject.toml') || fileNames.includes('requirements.txt') || fileNames.includes('setup.py')) set.add('pip');
  if (fileNames.some((name) => name.endsWith('.py'))) set.add('pip');
  if (fileNames.includes('Cargo.toml')) set.add('cargo');
  if (fileNames.includes('go.mod')) set.add('go');
  if (fileNames.includes('pom.xml')) set.add('maven');
  if (fileNames.some((name) => name.startsWith('build.gradle'))) set.add('gradle');
  if (fileNames.includes('composer.json')) set.add('composer');
  if (fileNames.includes('Gemfile')) set.add('bundler');
  if (fileNames.includes('pubspec.yaml')) set.add('pub');
  return [...set];
}

function scriptCommand(manager, name) {
  if (manager === 'pnpm') return `pnpm ${name}`;
  if (manager === 'yarn') return `yarn ${name}`;
  if (manager === 'bun') return `bun run ${name}`;
  return `npm run ${name}`;
}

function buildCommands(packageManagers, scripts, deps) {
  const lowerDeps = new Set(deps.map((dep) => dep.toLowerCase()));
  const manager = packageManagers.find((item) => ['pnpm', 'yarn', 'bun', 'npm'].includes(item)) ?? 'npm';
  const commands = [];
  const seen = new Set();
  const add = (name, command, source) => {
    if (!command || seen.has(name)) return;
    seen.add(name);
    commands.push({ name, command, source });
  };
  for (const [script, label] of COMMAND_LABELS) {
    if (typeof scripts[script] === 'string' && scripts[script].trim()) {
      add(label, scriptCommand(manager, script), 'package.json scripts');
    }
  }
  if (!seen.has('测试')) {
    if (lowerDeps.has('vitest')) add('测试', 'npx vitest run', '依赖 vitest');
    else if (lowerDeps.has('jest')) add('测试', 'npx jest', '依赖 jest');
    else if (lowerDeps.has('@playwright/test')) add('测试', 'npx playwright test', '依赖 Playwright');
    else if (lowerDeps.has('pytest')) add('测试', 'pytest', '依赖 pytest');
  }
  if (!seen.has('类型检查')) {
    if (lowerDeps.has('typescript')) add('类型检查', 'npx tsc --noEmit', '依赖 TypeScript');
  }
  if (!seen.has('lint') && (lowerDeps.has('eslint') || lowerDeps.has('@eslint/js'))) {
    add('lint', 'npx eslint .', '依赖 ESLint');
  }
  if (packageManagers.includes('cargo')) add('测试', 'cargo test', 'Cargo.toml');
  if (packageManagers.includes('go')) add('测试', 'go test ./...', 'go.mod');
  if (packageManagers.includes('maven')) add('测试', 'mvn test', 'pom.xml');
  if (packageManagers.includes('gradle')) add('测试', 'gradle test', 'build.gradle');
  if (packageManagers.includes('pub')) add('测试', 'flutter test', 'pubspec.yaml');
  return commands;
}

function addCommandIfMissing(commands, name, command, source) {
  if (!commands.some((item) => item.name === name)) commands.push({ name, command, source });
}

function groupKeyFor(rel) {
  const parts = rel.split('/');
  if (parts.length === 1) return '(root)';
  if (['packages', 'apps', 'libs', 'services'].includes(parts[0]) && parts[1]) return `${parts[0]}/${parts[1]}`;
  if (['src', 'app', 'lib', 'server', 'client', 'web', 'api'].includes(parts[0])) {
    return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return parts[0];
}

function labelForGroup(key) {
  const lower = key.toLowerCase();
  if (/test|spec|e2e/.test(lower)) return '测试';
  if (/component|ui|view|page|screen|widget|layout|style/.test(lower)) return 'UI / 组件';
  if (/api|route|controller|handler|endpoint|resolver/.test(lower)) return '接口 / 路由';
  if (/service|domain|usecase|business|core/.test(lower)) return '业务逻辑';
  if (/db|database|model|entity|repository|migration|schema/.test(lower)) return '数据 / 模型';
  if (/store|state|hook|composable/.test(lower)) return '状态 / 组合式逻辑';
  if (/util|helper|shared|common/.test(lower)) return '工具 / 共享';
  if (/config|script|tool|build/.test(lower)) return '配置 / 脚本';
  if (/doc|readme/.test(lower)) return '文档';
  return '业务模块';
}

function layerFor(rel, ext, isTest, isConfig, isDoc) {
  if (isTest) return 'tests';
  if (isConfig) return 'config';
  if (isDoc) return 'docs';
  const lower = rel.toLowerCase();
  if (/(^|\/)(components|ui|views|pages|screens|widgets|layouts|styles?)\//.test(lower) || ['.css', '.scss', '.sass', '.less'].includes(ext)) return 'ui';
  if (/(^|\/)(api|routes?|controllers?|handlers?|endpoints?|resolvers?)\//.test(lower)) return 'api';
  if (/(^|\/)(db|database|models?|entities|repositories|migrations?|schema)\//.test(lower)) return 'data';
  if (/(^|\/)(services?|domain|use-?cases?|business|core)\//.test(lower)) return 'domain';
  if (/(^|\/)(store|state|hooks?|composables?)\//.test(lower)) return 'state';
  if (/(^|\/)(utils?|lib|helpers?|shared|common)\//.test(lower)) return 'util';
  return 'source';
}

function parseSymbols(text, ext) {
  const symbols = [];
  const seen = new Set();
  const add = (name, kind, index) => {
    if (!name || name.length > 100) return;
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const line = text.slice(0, index).split('\n').length;
    symbols.push({ name, kind, line });
  };
  const scan = (regex, kind, group = 1) => {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let match;
    let guard = 0;
    while ((match = re.exec(text)) !== null && guard < 500) {
      guard += 1;
      const leading = match[0].length - match[0].trimStart().length;
      add(match[group], kind, match.index + leading);
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  };

  if (JS_EXTENSIONS.has(ext)) {
    scan(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'function');
    scan(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class');
    scan(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, 'function');
    scan(/(?:^|\n)\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, 'type');
    scan(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/, 'variable');
    for (const match of text.matchAll(/(?:^|\n)\s*export\s*\{([^}]+)\}/g)) {
      for (const piece of match[1].split(',')) {
        const name = piece.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) add(name, 'export', match.index);
      }
    }
  } else if (PY_EXTENSIONS.has(ext)) {
    scan(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/m, 'function');
    scan(/^\s*class\s+([A-Za-z_]\w*)/m, 'class');
  } else if (ext === '.go') {
    scan(/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/m, 'function');
    scan(/^\s*type\s+([A-Za-z_]\w*)/m, 'type');
  } else if (ext === '.rs') {
    scan(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/m, 'function');
    scan(/^\s*(?:pub\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)/m, 'type');
  } else if (['.java', '.kt', '.kts', '.scala', '.cs', '.fs', '.groovy'].includes(ext)) {
    scan(/(?:class|interface|enum|record|object|struct)\s+([A-Za-z_]\w*)/, 'type');
    scan(/(?:fun|void|public|private|protected|static|async|def)\s+([A-Za-z_]\w*)\s*\(/, 'function');
  } else if (ext === '.php') {
    scan(/(?:^|\n)\s*(?:public|private|protected|static|final|abstract\s+)*function\s+([A-Za-z_]\w*)/, 'function');
    scan(/(?:^|\n)\s*(?:final\s+|abstract\s+)?class\s+([A-Za-z_]\w*)/, 'class');
  } else if (ext === '.rb') {
    scan(/^\s*def\s+([A-Za-z_]\w*[!?=]?)/m, 'function');
    scan(/^\s*(?:class|module)\s+([A-Za-z_]\w*)/m, 'type');
  } else if (ext === '.swift') {
    scan(/^\s*(?:public|private|internal|open|static|class|override|mutating|async\s+)*func\s+([A-Za-z_]\w*)/m, 'function');
    scan(/^\s*(?:public|private|internal|open|final\s+)*(?:class|struct|enum|protocol)\s+([A-Za-z_]\w*)/m, 'type');
  } else if (ext === '.dart') {
    scan(/^\s*(?:class|mixin|enum)\s+([A-Za-z_]\w*)/m, 'type');
    scan(/^\s*(?:[\w<>?]+\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:async\s*)?\{/m, 'function');
  }
  return symbols.slice(0, MAX_SYMBOLS_PER_FILE);
}

function parseImports(text, ext) {
  const specs = [];
  const add = (spec) => {
    if (spec && spec.length < 300) specs.push(spec);
  };
  if (JS_EXTENSIONS.has(ext)) {
    for (const match of text.matchAll(/(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g)) add(match[1]);
  } else if (PY_EXTENSIONS.has(ext)) {
    for (const match of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) add(match[1] ?? match[2]);
  } else if (ext === '.rs') {
    for (const match of text.matchAll(/^\s*(?:use|mod)\s+([A-Za-z_][\w:]*)/gm)) add(match[1]);
  } else if (ext === '.go') {
    for (const match of text.matchAll(/^\s*(?:import\s+)?"([^"]+)"/gm)) add(match[1]);
  } else if (['.java', '.kt', '.kts', '.scala', '.cs'].includes(ext)) {
    for (const match of text.matchAll(/^\s*(?:import|using)\s+([\w.]+)\s*;?/gm)) add(match[1]);
  } else if (ext === '.php') {
    for (const match of text.matchAll(/(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g)) add(match[1]);
  } else if (ext === '.rb') {
    for (const match of text.matchAll(/^\s*(?:require|require_relative)\s+['"]([^'"]+)['"]/gm)) add(match[1]);
  }
  return [...new Set(specs)].slice(0, MAX_IMPORTS_PER_FILE);
}

function parseRoutes(text, ext) {
  const routes = [];
  const add = (method, route, index) => {
    if (!route || route.length > 200) return;
    routes.push({ method: String(method).toUpperCase(), path: route, line: text.slice(0, index).split('\n').length });
  };
  if (JS_EXTENSIONS.has(ext)) {
    for (const match of text.matchAll(/\b(?:app|router|server|api|route)\s*\.\s*(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) {
      add(match[1], match[2], match.index);
    }
    for (const match of text.matchAll(/\b(?:method|methods)\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`][\s\S]{0,120}?\bpath\s*:\s*['"`]([^'"`]+)['"`]/gi)) {
      add(match[1], match[2], match.index);
    }
  } else if (PY_EXTENSIONS.has(ext)) {
    for (const match of text.matchAll(/@\s*(?:app|router|blueprint)\s*\.\s*(get|post|put|patch|delete|route)\s*\(\s*['"]([^'"]+)['"]/gi)) {
      add(match[1], match[2], match.index);
    }
  } else if (ext === '.go') {
    for (const match of text.matchAll(/\.\s*(GET|POST|PUT|PATCH|DELETE)\s*\(\s*"([^"]+)"/g)) add(match[1], match[2], match.index);
  } else if (['.java', '.kt', '.kts'].includes(ext)) {
    for (const match of text.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g)) add(match[1], match[2], match.index);
  } else if (ext === '.php') {
    for (const match of text.matchAll(/Route::(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi)) add(match[1], match[2], match.index);
  } else if (ext === '.rb') {
    for (const match of text.matchAll(/\b(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gi)) add(match[1], match[2], match.index);
  }
  return routes.slice(0, 40);
}

function parseHeadings(text) {
  const headings = [];
  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    const value = match[1].replace(/[#*`]/g, '').trim();
    if (value) headings.push(value);
    if (headings.length >= 20) break;
  }
  return headings;
}

function resolveImport(root, fromRel, spec, fileSet, ext) {
  const clean = spec.split('?')[0].split('#')[0].trim();
  if (!clean) return undefined;
  const tryBase = (base) => {
    const normalized = path.posix.normalize(base).replace(/^\.\//, '');
    if (normalized.startsWith('..')) return undefined;
    const candidates = [normalized];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.rs', '.java', '.kt', '.cs', '.php', '.rb', '.swift', '.dart'];
    for (const candidateExt of extensions) candidates.push(normalized + candidateExt);
    for (const candidateExt of extensions) candidates.push(`${normalized}/index${candidateExt}`);
    candidates.push(`${normalized}/__init__.py`, `${normalized}/mod.rs`);
    return candidates.find((candidate) => fileSet.has(candidate));
  };

  if (JS_EXTENSIONS.has(ext)) {
    if (clean.startsWith('.')) return tryBase(path.posix.join(path.posix.dirname(fromRel), clean));
    if (clean.startsWith('@/') || clean.startsWith('~/')) return tryBase(clean.slice(2));
    if (clean.startsWith('src/')) return tryBase(clean);
    return undefined;
  }
  if (PY_EXTENSIONS.has(ext)) {
    if (clean.startsWith('.')) {
      const dots = clean.match(/^\.+/)?.[0].length ?? 1;
      const rest = clean.slice(dots).replace(/\./g, '/');
      let base = path.posix.dirname(fromRel);
      for (let i = 1; i < dots; i += 1) base = path.posix.dirname(base);
      return tryBase(path.posix.join(base, rest));
    }
    return tryBase(clean.replace(/\./g, '/')) ?? tryBase(`src/${clean.replace(/\./g, '/')}`);
  }
  if (ext === '.rs') {
    if (clean.startsWith('crate::')) return tryBase(`src/${clean.slice(7).replace(/::/g, '/')}`);
    if (clean.startsWith('super::')) return tryBase(path.posix.join(path.posix.dirname(fromRel), '..', clean.slice(7).replace(/::/g, '/')));
    if (clean.startsWith('self::')) return tryBase(path.posix.join(path.posix.dirname(fromRel), clean.slice(6).replace(/::/g, '/')));
    return undefined;
  }
  return undefined;
}

function detectEntrypoints(pkg, packageFiles, rootFiles) {
  const entries = [];
  const add = (rel) => {
    if (rel && packageFiles.has(rel) && !entries.includes(rel)) entries.push(rel);
  };
  if (pkg?.main) add(path.posix.normalize(toPosix(pkg.main)).replace(/^\.\//, ''));
  if (pkg?.module) add(path.posix.normalize(toPosix(pkg.module)).replace(/^\.\//, ''));
  for (const candidate of [
    'src/main.ts', 'src/main.tsx', 'src/main.js', 'src/main.jsx',
    'src/index.ts', 'src/index.tsx', 'src/index.js', 'src/index.jsx',
    'src/App.tsx', 'src/App.jsx', 'src/app.tsx', 'src/app.jsx',
    'app/layout.tsx', 'app/page.tsx', 'pages/_app.tsx', 'pages/index.tsx',
    'server/index.ts', 'server/index.js', 'server.ts', 'index.ts', 'index.js',
    'main.py', 'app.py', 'manage.py', 'cmd/main.go', 'main.go', 'src/main.rs',
    'bot.py', 'qq_bot.py', 'qq_bot_relay.py', 'robot.py', 'run.py', 'start.py',
    'server.py', 'web.py', 'relay.py', 'worker.py', 'daemon.py',
  ]) add(candidate);
  const roots = rootFiles.filter((rel) => !rel.includes('/') && /^(index|main|app|bot|qq_bot|qq_bot_relay|robot|run|start|server|web|relay|worker|daemon)\.(ts|tsx|js|jsx|py|go|rs)$/.test(rel));
  for (const rel of roots) add(rel);
  return entries.slice(0, 8);
}

/** Match an absolute/mixed main path mentioned in docs back to an indexed file. */
function matchByBasename(fileSet, referenced) {
  if (!referenced) return undefined;
  const base = toPosix(referenced).split('/').pop();
  if (!base) return undefined;
  if (fileSet.has(base)) return base;
  for (const rel of fileSet) {
    if (rel.split('/').pop() === base) return rel;
  }
  return undefined;
}

function parseReferencedMain(text) {
  const match = String(text).match(/(?:主程序|main|entry)\s*[:：]\s*([^\s，。\n|]+)/i);
  return match ? match[1].replace(/[`"']/g, '') : undefined;
}

function gitStatus(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z'], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
    });
    if (!out) return { isGit: true, changed: [] };
    const parts = out.split('\0').filter(Boolean);
    const changed = [];
    for (let i = 0; i < parts.length; i += 1) {
      const entry = parts[i];
      const status = entry.slice(0, 2);
      let rel = entry.slice(3);
      if (status.includes('R') || status.includes('C')) {
        // In -z format the new path comes first and the original path is the
        // next NUL-separated field; keep the new path and skip the old one.
        if (parts[i + 1]) i += 1;
      }
      rel = toPosix(rel).replace(/^"|"$/g, '');
      if (rel) changed.push(rel);
    }
    return { isGit: true, changed: [...new Set(changed)].slice(0, 200) };
  } catch {
    const hasGit = existsSync(path.join(root, '.git'));
    return { isGit: hasGit, changed: [], unavailable: hasGit };
  }
}

async function readWorkspacePackages(root) {
  const manifests = [];
  for (const dirName of ['packages', 'apps', 'libs', 'services']) {
    const dir = path.join(root, dirName);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.slice(0, 100)) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(dir, entry.name, 'package.json');
      const pkg = await readJson(pkgPath);
      const parsed = parsePackageJson(pkg);
      if (parsed) manifests.push({ path: `${dirName}/${entry.name}/package.json`, ...parsed });
    }
  }
  return manifests;
}

async function loadGitIgnore(root) {
  let text = '';
  try {
    text = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
  } catch {
    return () => false;
  }
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) line = line.replace(/\/+$/, '');
    const anchored = line.startsWith('/');
    if (anchored) line = line.slice(1);
    if (!line) continue;
    const glob = line
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\u0000/g, '.*');
    const regex = new RegExp(anchored || line.includes('/') ? `^${glob}(?:/|$)` : `(?:^|/)${glob}(?:/|$)`);
    rules.push({ regex, directoryOnly });
  }
  return (rel, isDirectory) => rules.some((rule) => (!rule.directoryOnly || isDirectory) && rule.regex.test(rel));
}

/**
 * Build a project index.
 *
 * @param {string} root - absolute project root.
 * @param {object} [options]
 * @param {number} [options.maxFiles] - source-file cap (default 6000).
 * @param {number} [options.maxFileBytes] - per-file content cap.
 * @param {boolean} [options.includeDocs] - index Markdown/docs (default true).
 * @returns {Promise<object>}
 */
export async function scanProject(root, options = {}) {
  const absoluteRoot = path.resolve(root);
  const realRoot = await fs.realpath(absoluteRoot).catch(() => absoluteRoot);
  const ignore = await loadGitIgnore(realRoot);
  const maxFiles = Number.isFinite(options.maxFiles) ? Math.max(50, Math.min(20000, options.maxFiles)) : DEFAULT_MAX_FILES;
  const maxFileBytes = Number.isFinite(options.maxFileBytes) ? options.maxFileBytes : DEFAULT_MAX_FILE_BYTES;
  const includeDocs = options.includeDocs !== false;
  const report = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  report({ stage: 'scan', percent: 2, depth: 6, label: '开始扫描项目', detail: realRoot.replace(/\\/g, '/') });

  const rootFiles = [];
  const files = [];
  const dirs = new Set();
  const skipped = { directories: 0, extensions: 0, oversized: 0, binary: 0, truncated: false };

  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    const relDir = relativePosix(realRoot, dir);
    if (relDir !== '.' && shouldSkipDir(path.basename(dir), relDir)) {
      skipped.directories += 1;
      continue;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relativePosix(realRoot, abs);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name, rel)) {
          skipped.directories += 1;
          continue;
        }
        if (ignore(rel, true)) {
          skipped.directories += 1;
          continue;
        }
        dirs.add(rel);
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ignore(rel, false)) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext) && !isConfigFile(rel)) {
        skipped.extensions += 1;
        continue;
      }
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        continue;
      }
      const config = isConfigFile(rel);
      if (!config && stat.size > maxFileBytes) {
        skipped.oversized += 1;
        continue;
      }
      if (!config && GENERATED_PATH.test(rel)) {
        skipped.oversized += 1;
        continue;
      }
      rootFiles.push(rel);
      files.push({
        abs,
        rel,
        ext,
        size: stat.size,
        isTest: TEST_PATH.test(rel),
        isConfig: config,
        isDoc: isDocFile(ext),
        isGenerated: GENERATED_PATH.test(rel),
      });
      if (files.length % 25 === 0) {
        report({
          stage: 'scan',
          percent: Math.min(22, 2 + Math.log2(files.length + 1) * 3),
          depth: Math.min(30, 8 + Math.log2(files.length + 1) * 4),
          label: '扫描项目目录',
          detail: `${files.length} 个文件 · ${dirs.size} 个目录`,
          files: files.length,
          dirs: dirs.size,
        });
      }
      if (files.length >= maxFiles) {
        skipped.truncated = true;
        break;
      }
    }
    if (files.length >= maxFiles) break;
  }
  report({
    stage: 'scan',
    percent: 24,
    depth: 32,
    label: '文件清单完成',
    detail: `${files.length} 个文件 · ${dirs.size} 个目录`,
    files: files.length,
    dirs: dirs.size,
  });

  const packageJson = await readJson(path.join(realRoot, 'package.json'));
  const pkg = parsePackageJson(packageJson);
  const workspacePackages = await readWorkspacePackages(realRoot);
  const allPackageNames = [pkg, ...workspacePackages].filter(Boolean).map((item) => item.name).filter(Boolean);
  const projectName = pkg?.name || path.basename(realRoot);
  const fileNames = rootFiles.map((rel) => path.posix.basename(rel));
  const deps = [...new Set([pkg, ...workspacePackages].flatMap((item) => item?.dependencies ?? []))];
  const packageManagers = detectPackageManagers(fileNames);
  const frameworks = detectFrameworks(deps, fileNames);
  const scripts = { ...(pkg?.scripts ?? {}) };
  for (const workspace of workspacePackages) {
    for (const [name, command] of Object.entries(workspace.scripts ?? {})) {
      if (!(name in scripts)) scripts[`${workspace.name}:${name}`] = command;
    }
  }
  const commands = buildCommands(packageManagers, scripts, deps);
  const fileSet = new Set(files.map((file) => file.rel));
  const entrypoints = detectEntrypoints(pkg, fileSet, rootFiles);
  const git = gitStatus(realRoot);

  let parsedCount = 0;
  const parseStep = files.length <= 200 ? 5 : 50;
  const reportParse = () => {
    parsedCount += 1;
    if (parsedCount % parseStep !== 0 && parsedCount !== files.length) return;
    const ratio = parsedCount / Math.max(1, files.length);
    report({
      stage: 'parse',
      percent: 24 + ratio * 28,
      depth: 32 + ratio * 30,
      label: '解析符号、导入与路由',
      detail: `${parsedCount}/${files.length} 个文件`,
      files: parsedCount,
      total: files.length,
    });
  };

  const parsedFiles = await mapLimit(files, 24, async (file) => {
    let text = null;
    if (includeDocs || !file.isDoc) {
      text = await readText(file.abs, Math.min(maxFileBytes, CONTENT_READ_LIMIT));
    }
    if (text === null) {
      if (!file.isConfig) skipped.binary += 1;
      reportParse();
      return {
        path: file.rel,
        ext: file.ext,
        size: file.size,
        lines: 0,
        lang: languageOf(file.ext),
        isTest: file.isTest,
        isConfig: file.isConfig,
        isDoc: file.isDoc,
        isEntry: entrypoints.includes(file.rel),
        imports: [],
        importSpecs: [],
        symbols: [],
        terms: {},
        headings: [],
        routes: [],
      };
    }
    const imports = parseImports(text, file.ext);
    reportParse();
    return {
      path: file.rel,
      ext: file.ext,
      size: file.size,
      lines: countLines(text),
      lang: languageOf(file.ext),
      isTest: file.isTest,
      isConfig: file.isConfig,
      isDoc: file.isDoc,
      isEntry: entrypoints.includes(file.rel),
      imports,
      importSpecs: imports,
      symbols: parseSymbols(text, file.ext),
      terms: collectTerms(text, MAX_TERMS_PER_FILE),
      headings: file.isDoc ? parseHeadings(text) : [],
      routes: parseRoutes(text, file.ext),
      hasMainGuard: file.ext === '.py' && /\b__name__\s*==\s*["']__main__["']/.test(text),
      referencedMain: file.isDoc ? parseReferencedMain(text) : undefined,
    };
  });

  const mainGuardEntries = parsedFiles
    .filter((file) => !file.path.includes('/') && file.hasMainGuard)
    .map((file) => file.path);
  const referencedEntries = parsedFiles
    .map((file) => file.referencedMain)
    .filter(Boolean)
    .map((referenced) => matchByBasename(fileSet, referenced))
    .filter(Boolean);
  for (const entry of [...mainGuardEntries, ...referencedEntries]) {
    if (!entrypoints.includes(entry)) entrypoints.push(entry);
  }
  const finalEntrypoints = entrypoints.slice(0, 10);
  for (const file of parsedFiles) {
    if (finalEntrypoints.includes(file.path)) file.isEntry = true;
  }

  const fileMap = new Map(parsedFiles.map((file) => [file.path, file]));
  const graph = Object.fromEntries(parsedFiles.map((file) => [file.path, { deps: [], dependents: [] }]));
  for (const file of parsedFiles) {
    for (const spec of file.importSpecs) {
      const target = resolveImport(realRoot, file.path, spec, fileSet, file.ext);
      if (!target || target === file.path) continue;
      if (!graph[file.path].deps.includes(target)) graph[file.path].deps.push(target);
      if (!graph[target].dependents.includes(file.path)) graph[target].dependents.push(file.path);
    }
  }
  for (const file of parsedFiles) file.imports = graph[file.path].deps;
  const edgeCount = Object.values(graph).reduce((sum, node) => sum + node.deps.length, 0);
  report({
    stage: 'graph',
    percent: 56,
    depth: 64,
    label: '构建导入关系图',
    detail: `${edgeCount} 条依赖边`,
    edges: edgeCount,
  });

  const languages = new Map();
  for (const file of parsedFiles) {
    if (file.isConfig || file.isDoc || NON_CODE_EXTENSIONS.has(file.ext)) continue;
    languages.set(file.lang, (languages.get(file.lang) ?? 0) + 1);
  }
  const languageTotal = Math.max(1, [...languages.values()].reduce((sum, value) => sum + value, 0));
  const languageRows = [...languages.entries()]
    .map(([name, count]) => ({ name, files: count, pct: Math.round((count / languageTotal) * 100) }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 8);

  const hasPythonCode = languageRows.some((item) => item.name === 'Python');
  if (hasPythonCode) {
    const pythonEntry = finalEntrypoints.find((entry) => entry.endsWith('.py'));
    addCommandIfMissing(commands, '测试', 'python -m pytest', 'Python 项目');
    addCommandIfMissing(commands, '语法检查', `python -m py_compile ${pythonEntry ?? '<入口文件>'}`.trim(), 'Python 项目');
    if (rootFiles.includes('requirements.txt')) addCommandIfMissing(commands, '安装依赖', 'pip install -r requirements.txt', 'requirements.txt');
  }
  const pythonModules = new Set(
    parsedFiles
      .filter((file) => file.ext === '.py')
      .flatMap((file) => file.importSpecs.map((spec) => spec.split('.')[0].toLowerCase())),
  );
  for (const [mod, label] of PY_FRAMEWORK_RULES) {
    if (pythonModules.has(mod) && !frameworks.some((item) => item.name === label)) {
      frameworks.push({ name: label, evidence: `import ${mod}` });
    }
  }
  report({
    stage: 'understand',
    percent: 64,
    depth: 76,
    label: '识别技术栈、入口与命令',
    detail: `${languageRows.map((item) => item.name).join('、') || '未知语言'} · ${frameworks.length} 个框架 · ${finalEntrypoints.length} 个入口`,
    frameworks: frameworks.length,
    entries: finalEntrypoints.length,
  });

  const groups = new Map();
  for (const file of parsedFiles) {
    if (file.isConfig || file.isDoc) continue;
    const key = groupKeyFor(file.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file.path);
  }
  const architectureGroups = [...groups.entries()]
    .map(([key, paths]) => ({
      path: key,
      label: labelForGroup(key),
      files: paths.length,
      examples: paths.slice(0, 4),
    }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 14);

  const layers = { ui: [], api: [], domain: [], data: [], state: [], util: [], tests: [], config: [], docs: [], source: [] };
  for (const file of parsedFiles) {
    const layer = layerFor(file.path, file.ext, file.isTest, file.isConfig, file.isDoc);
    if (layers[layer] && layers[layer].length < 40) layers[layer].push(file.path);
  }

  const docs = parsedFiles
    .filter((file) => file.isDoc && file.headings.length > 0)
    .map((file) => ({ path: file.path, title: file.headings[0] }))
    .sort((a, b) => (a.path === 'README.md' ? -1 : b.path === 'README.md' ? 1 : a.path.localeCompare(b.path)))
    .slice(0, 20);

  const totalBytes = parsedFiles.reduce((sum, file) => sum + file.size, 0);

  return {
    version: 1,
    root: realRoot.replace(/\\/g, '/'),
    name: projectName,
    generatedAt: new Date().toISOString(),
    stats: {
      files: parsedFiles.length,
      directories: dirs.size,
      totalBytes,
      totalSize: formatBytes(totalBytes),
      truncated: skipped.truncated,
      skipped,
    },
    stack: {
      languages: languageRows,
      frameworks,
      packageManagers,
      commands,
      entrypoints: finalEntrypoints,
      dependencies: deps.slice(0, 200),
      workspaces: allPackageNames,
      packageName: pkg?.name ?? null,
      packageVersion: pkg?.version ?? null,
    },
    architecture: {
      groups: architectureGroups,
      layers,
      docs,
      manifests: rootFiles.filter((rel) => isConfigFile(rel)).slice(0, 40),
    },
    git,
    files: parsedFiles,
    graph,
  };
}

/** Human-facing one-screen summary of an index. */
export function summarizeIndex(index) {
  const stack = index.stack;
  const lines = [
    `${index.name} · ${index.stats.files} 个文件 · ${index.stats.totalSize}`,
    `语言：${stack.languages.map((item) => `${item.name} ${item.pct}%`).join('、') || '未知'}`,
    `框架：${stack.frameworks.map((item) => item.name).join('、') || '未识别'}`,
    `包管理：${stack.packageManagers.join('、') || '未识别'}`,
    `入口：${stack.entrypoints.slice(0, 5).join('、') || '未识别'}`,
    `命令：${stack.commands.slice(0, 6).map((item) => `${item.name}=${item.command}`).join(' | ') || '未识别'}`,
    `Git：${index.git.isGit ? index.git.unavailable ? '已检测到 .git，但 git 命令不可用' : `已检测，${index.git.changed.length} 个未提交变更` : '未检测到 .git'}`,
  ];
  if (index.stats.truncated) lines.push('注意：文件数达到上限，索引已截断。');
  return lines.join('\n');
}
