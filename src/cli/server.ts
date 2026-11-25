import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildStoryboardGraph } from '../core/diffParser.ts';
import { DEMO_FEATURE_DIFF, DEMO_UNIFIED_DIFF } from '../core/demoDataset.ts';

const execFileAsync = promisify(execFile);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function parseArgs(argv: string[]) {
  let range = 'working';
  let demo = false;
  let port = 4321;
  let noOpen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--demo') demo = true;
    else if (arg === '--no-open') noOpen = true;
    else if (arg === '--port' && argv[i + 1]) port = Number(argv[++i]) || 4321;
    else if (arg.startsWith('--port=')) port = Number(arg.slice(7)) || 4321;
    else if (!arg.startsWith('-')) range = arg;
  }
  return { range, demo, port, noOpen };
}

async function readGitDiff(cwd: string, range: string): Promise<string> {
  if (range === 'working' || range === '') {
    const { stdout: staged } = await execFileAsync('git', ['diff', '--cached', '--unified=5'], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    const { stdout: unstaged } = await execFileAsync('git', ['diff', '--unified=5'], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    const combined = `${staged}${unstaged}`.trim();
    if (combined.length > 0) return combined;
    const { stdout: lastCommit } = await execFileAsync('git', ['diff', 'HEAD~1..HEAD', '--unified=5'], {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return lastCommit;
  }
  const { stdout } = await execFileAsync('git', ['diff', range, '--unified=5'], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function loadStoryboard(cwd: string, range: string, forceDemo: boolean) {
  if (forceDemo) {
    const diff = range === 'demo-batch' ? DEMO_FEATURE_DIFF : DEMO_UNIFIED_DIFF;
    return buildStoryboardGraph(diff, {
      title: range === 'demo-batch' ? 'Worker Concurrency Refactor' : 'Keyring Auth & Revocation Refactor',
      rangeLabel: range === 'demo-batch' ? 'demo:worker-pool' : 'demo:keyring-auth',
      isDemo: true,
    });
  }
  try {
    const raw = await readGitDiff(cwd, range);
    if (!raw.trim()) {
      return buildStoryboardGraph(DEMO_UNIFIED_DIFF, {
        title: 'Clean working tree — Demo Refactor Loaded',
        rangeLabel: 'demo:keyring-auth',
        isDemo: true,
      });
    }
    return buildStoryboardGraph(raw, {
      title: `Git Diff (${range || 'working tree'})`,
      rangeLabel: range || 'working tree',
      isDemo: false,
    });
  } catch {
    return buildStoryboardGraph(DEMO_UNIFIED_DIFF, {
      title: 'Demo Refactor Storyboard',
      rangeLabel: 'demo:keyring-auth',
      isDemo: true,
    });
  }
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* ignore */
  }
}

export async function startCli(argv: string[]) {
  const { range, demo, port, noOpen } = parseArgs(argv);
  const cwd = process.cwd();
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDir = resolve(here, 'client');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/api/graph') {
      const reqRange = url.searchParams.get('range') ?? range;
      const reqDemo = url.searchParams.get('demo') === '1' || (demo && !url.searchParams.has('range'));
      const graph = await loadStoryboard(cwd, reqRange, reqDemo);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(graph));
      return;
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = resolve(clientDir, rel);
    const filePath = target.startsWith(clientDir) && existsSync(target) && statSync(target).isFile()
      ? target
      : join(clientDir, 'index.html');
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  const listenUrl = `http://127.0.0.1:${port}`;
  console.log(`diffcanvas listening at ${listenUrl} (range=${range}, demo=${demo})`);
  if (!noOpen) openBrowser(listenUrl);
}
