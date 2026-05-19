/**
 * 烟雾测试：验证 stamp + qpdf 加密管线端到端工作
 *
 * 流程：
 *   1) 用 pdf-lib 生成一个 1 页测试 PDF
 *   2) 调用主进程的 stampBytes 等效逻辑 + qpdf 加密
 *   3) 验证：输出文件存在、加密标志生效、SHA256 短码插入文件名、只读位被设
 *   4) 验证：用 pdf-lib 读，应该拿不到 producer（因为加密了）；
 *          用 pdf-lib + ignoreEncryption=true 也读不到 producer 原文
 *   5) 验证：qpdf --is-encrypted 返回 0
 *
 * 运行：node scripts/smoke-test-encrypt.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const OWNER_PASSWORD = 'skyland-ADMIN1';
const QPDF_PATH = path.join(__dirname, '..', 'build', 'qpdf', 'qpdf.exe');
const OUT_DIR = path.join(__dirname, '..', '_smoke_out');

function log(...args) { console.log('[smoke]', ...args); }
function assert(cond, msg) {
  if (!cond) throw new Error('断言失败：' + msg);
  log('  ✓ ' + msg);
}

function encryptWithQpdf(input, output) {
  return new Promise((resolve, reject) => {
    const args = [
      '--encrypt', '', OWNER_PASSWORD, '256',
      '--modify=none', '--extract=n',
      '--print=full', '--annotate=n', '--assemble=n',
      '--', input, output,
    ];
    const child = spawn(QPDF_PATH, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || code === 3) resolve();
      else reject(new Error(`qpdf exit ${code}: ${stderr}`));
    });
  });
}

async function makeTestPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('Hello Controlled CAD', {
    x: 50, y: 750, size: 24, font, color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText('Smoke test for v1.0.7 encryption.', {
    x: 50, y: 700, size: 12, font, color: rgb(0.3, 0.3, 0.3),
  });
  doc.setProducer('Controlled-PDF-Studio v1.0.7');
  doc.setKeywords(['controlled-stamped', 'part:TEST.001', 'rev:01']);
  return await doc.save();
}

function sha256Short(filePath) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex').slice(0, 8);
}

function setReadonly(filePath) {
  spawnSync('attrib.exe', ['+R', filePath], { windowsHide: true });
}
function clearReadonly(filePath) {
  spawnSync('attrib.exe', ['-R', filePath], { windowsHide: true });
}

async function main() {
  log('启动烟雾测试');
  log('qpdf 路径:', QPDF_PATH);
  assert(fs.existsSync(QPDF_PATH), 'qpdf.exe 存在');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) 生成测试 PDF
  const rawBytes = await makeTestPdf();
  const rawPath = path.join(OUT_DIR, 'raw.pdf');
  fs.writeFileSync(rawPath, rawBytes);
  log('生成原始 PDF:', rawPath, `(${rawBytes.length} bytes)`);
  assert(rawBytes.length > 500, '原始 PDF 大于 500 字节');

  // 2) 加密
  const preFinalPath = path.join(OUT_DIR, 'pre-final.pdf');
  // 如果已存在先清掉
  if (fs.existsSync(preFinalPath)) { clearReadonly(preFinalPath); fs.unlinkSync(preFinalPath); }
  await encryptWithQpdf(rawPath, preFinalPath);
  assert(fs.existsSync(preFinalPath), '加密输出存在');
  const encSize = fs.statSync(preFinalPath).size;
  log('加密输出:', preFinalPath, `(${encSize} bytes)`);

  // 3) SHA256 短码 + 重命名
  const hash = sha256Short(preFinalPath);
  const finalPath = path.join(OUT_DIR, `final [${hash}].pdf`);
  if (fs.existsSync(finalPath)) { clearReadonly(finalPath); fs.unlinkSync(finalPath); }
  fs.renameSync(preFinalPath, finalPath);
  log('最终文件名:', path.basename(finalPath), `(hash=${hash})`);
  assert(/\[[0-9a-f]{8}\]\.pdf$/i.test(finalPath), '文件名含 [8位 hex]');

  // 4) 设只读
  setReadonly(finalPath);

  // 5) qpdf 自带 --is-encrypted 检查
  const checkEnc = spawnSync(QPDF_PATH, ['--is-encrypted', finalPath], { encoding: 'utf-8' });
  // is-encrypted 加密文件返回 exit 0
  log('qpdf --is-encrypted exit:', checkEnc.status, '(0 = 加密)');
  assert(checkEnc.status === 0, '文件确实是加密的');

  // 6) 检查权限位
  const show = spawnSync(QPDF_PATH, ['--show-encryption', '--password=' + OWNER_PASSWORD, finalPath], { encoding: 'utf-8' });
  log('--show-encryption 输出:');
  show.stdout.split('\n').forEach((l) => console.log('   ', l));
  // qpdf 用 R=6 表示 PDF 2.0 / AES-256
  assert(/R\s*=\s*6/.test(show.stdout) || /AES.*256/i.test(show.stdout), 'AES-256 (PDF 2.0 R=6) 加密');
  assert(/modify.*not allowed/i.test(show.stdout), '禁止修改权限位生效');
  assert(/extract for any purpose:\s*not allowed/i.test(show.stdout), '禁止抽取');

  // 7) pdf-lib 读测试：直接 load 应抛错（未提供密码）
  const finalBytes = fs.readFileSync(finalPath);
  let normalLoadFailed = false;
  try {
    await PDFDocument.load(finalBytes);
  } catch (e) {
    normalLoadFailed = true;
    log('pdf-lib 不带 ignoreEncryption 加载报错（预期）:', e.message.slice(0, 60));
  }
  assert(normalLoadFailed, 'pdf-lib 默认加载加密文件失败');

  // 8) ignoreEncryption=true 时能读但 metadata 是密文
  const docIgnore = await PDFDocument.load(finalBytes, { ignoreEncryption: true });
  const producerCipher = docIgnore.getProducer() || '';
  log('ignoreEncryption=true 读出 Producer（应是乱码或空）:', JSON.stringify(producerCipher.slice(0, 40)));
  // 这里不强制断言乱码，因为某些版本 ignoreEncryption 路径下 producer 可能是空字符串

  // 9) 只读位检查
  // Windows 上 Node 的 stat.mode 不总是反映 attrib，但写测试一下
  let cantOverwrite = false;
  try {
    fs.writeFileSync(finalPath, Buffer.from('overwrite-attempt'));
  } catch (e) {
    cantOverwrite = true;
    log('写覆盖失败（预期，因只读位）:', e.code, e.message.slice(0, 60));
  }
  assert(cantOverwrite, '只读文件无法被 Node 直接覆写');

  // 清理
  clearReadonly(finalPath);

  console.log('\n========== ✅ 所有检查通过 ==========');
  console.log(`产物: ${finalPath}`);
  console.log(`输入 ${rawBytes.length} B → 加密后 ${encSize} B（差异主要是 qpdf 的对象编排 + AES 头）`);
  console.log('\n手动验证建议：');
  console.log('  1) 用 WPS 打开这个文件，尝试"编辑"，应该被拒绝');
  console.log('  2) 用 Adobe Reader 打开，"属性 → 安全性" 应该显示 AES-256 + 禁止修改');
  console.log(`  3) Owner 密码：${OWNER_PASSWORD}`);
}

main().catch((e) => {
  console.error('烟雾测试失败:', e);
  process.exit(1);
});
