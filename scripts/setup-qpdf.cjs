/**
 * 下载 qpdf for Windows，解压到 build/qpdf/
 * 一次性运行：node scripts/setup-qpdf.cjs
 *
 * 完成后 build/qpdf/ 里会有 qpdf.exe + 若干 DLL。
 * electron-builder 通过 extraResources 把它打进 release\<appname>\resources\qpdf\。
 */
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const QPDF_VERSION = '11.10.0';
const ZIP_NAME = `qpdf-${QPDF_VERSION}-mingw64.zip`;
const URL = `https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/${ZIP_NAME}`;

const TARGET_DIR = path.join(__dirname, '..', 'build', 'qpdf');
const TMP_DIR = path.join(__dirname, '..', 'build', '_qpdf_tmp');
const ZIP_PATH = path.join(TMP_DIR, ZIP_NAME);

function log(msg) {
  console.log(`[setup-qpdf] ${msg}`);
}

function download(url, outPath) {
  return new Promise((resolve, reject) => {
    function get(u, redirects = 0) {
      if (redirects > 5) return reject(new Error('too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'controlled-pdf-studio-setup' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let got = 0;
        const file = fs.createWriteStream(outPath);
        res.on('data', (chunk) => {
          got += chunk.length;
          if (total) {
            const pct = ((got / total) * 100).toFixed(1);
            process.stdout.write(`\r  下载中：${(got / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB (${pct}%)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            process.stdout.write('\n');
            resolve();
          });
        });
        file.on('error', reject);
      }).on('error', reject);
    }
    get(url);
  });
}

function unzipWithPowershell(zipPath, outDir) {
  log(`解压（PowerShell Expand-Archive）→ ${outDir}`);
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${outDir}'`,
    ],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    throw new Error(`Expand-Archive 失败，退出码 ${result.status}`);
  }
}

function findQpdfBinDir(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const binDir = path.join(root, ent.name, 'bin');
    if (fs.existsSync(path.join(binDir, 'qpdf.exe'))) return binDir;
  }
  if (fs.existsSync(path.join(root, 'qpdf.exe'))) return root;
  return null;
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyDir(s, d);
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

async function main() {
  // 已经有 qpdf.exe 就跳过
  const existing = path.join(TARGET_DIR, 'qpdf.exe');
  if (fs.existsSync(existing)) {
    log(`已存在：${existing} — 跳过下载`);
    return;
  }

  log(`准备目录：${TARGET_DIR}`);
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  log(`下载 qpdf v${QPDF_VERSION}（mingw64 Windows 版）`);
  log(`URL: ${URL}`);
  await download(URL, ZIP_PATH);
  log(`下载完成：${ZIP_PATH}`);

  unzipWithPowershell(ZIP_PATH, TMP_DIR);

  const binDir = findQpdfBinDir(TMP_DIR);
  if (!binDir) throw new Error('在解压结果里没找到 qpdf.exe，请手动检查 build/_qpdf_tmp');
  log(`定位 qpdf bin 目录：${binDir}`);

  copyDir(binDir, TARGET_DIR);
  log(`已复制到：${TARGET_DIR}`);

  rmrf(TMP_DIR);
  log(`清理临时目录`);

  // 简单自检
  const check = spawnSync(existing, ['--version'], { encoding: 'utf-8' });
  if (check.status === 0) {
    log(`✅ qpdf 可用：${check.stdout.split('\n')[0]}`);
  } else {
    log(`⚠ qpdf --version 失败：${check.stderr}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[setup-qpdf] 失败：${e.message}`);
  process.exit(1);
});
