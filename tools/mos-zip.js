#!/usr/bin/env node
'use strict';
/**
 * 极简 ZIP 写入器（零第三方依赖；仅用 `node:zlib` 的 deflateRaw）。
 *
 * 为什么不用系统 zip / PowerShell Compress-Archive：
 *   - Git Bash 下通常**没有** `zip`；
 *   - PowerShell `Compress-Archive` 写入的条目使用 **反斜杠** 分隔符（违反 ZIP 规范），
 *     在 Linux/macOS 解压时可能得到带反斜杠的怪异文件名。
 * 本实现统一使用 **正斜杠 + UTF-8 文件名标志**，产出跨平台可解压的标准 ZIP。
 *
 * 用法：
 *   node tools/mos-zip.js <输出.zip> <基目录>
 *     → 把 <基目录> 下所有文件（相对路径）打包进 <输出.zip>，
 *       条目名 = "<基目录名>/<相对路径>"（正斜杠）。
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------------- DOS 时间 ---------------- */
function dosDateTime(d) {
  const dt = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
  const year = Math.max(1980, dt.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate(),
    time: (dt.getHours() << 11) | (dt.getMinutes() << 5) | Math.floor(dt.getSeconds() / 2)
  };
}

/** 递归列出目录下全部文件（返回相对路径，正斜杠） */
function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) walk(abs, base, out);
    else if (st.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

const ZIP64_THRESHOLD = 0xFFFFFFFF;

function createZip(zipPath, baseDir) {
  const rootName = path.basename(path.resolve(baseDir));
  const files = walk(path.resolve(baseDir), path.resolve(baseDir), []).sort();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const rel of files) {
    const abs = path.join(baseDir, rel);
    const data = fs.readFileSync(abs);
    const stored = zlib.deflateRawSync(data, { level: 9 });
    const useStore = stored.length >= data.length;    // 压缩反而更大 → 原样存储
    const payload = useStore ? data : stored;
    const method = useStore ? 0 : 8;
    const nameBuf = Buffer.from(rootName + '/' + rel, 'utf8');
    const { date, time } = dosDateTime(fs.statSync(abs).mtime);
    const crc = crc32(data);

    if (data.length >= ZIP64_THRESHOLD || payload.length >= ZIP64_THRESHOLD) {
      throw new Error('单文件超过 4GiB，需 ZIP64（当前实现不支持）：' + rel);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // flags: UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);          // extra len

    chunks.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014B50, 0);
    cd.writeUInt16LE(0x031E, 4);         // version made by: UNIX, 3.0
    cd.writeUInt16LE(20, 6);             // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);             // extra
    cd.writeUInt16LE(0, 32);             // comment
    cd.writeUInt16LE(0, 34);             // disk start
    cd.writeUInt16LE(0, 36);             // internal attrs
    // 注意：`0o100644 << 16` 在 JS 中是**有符号** 32 位运算，结果会溢出为负数，
    // 因此必须 `>>> 0` 转回无符号再写入，否则 writeUInt32LE 抛范围错误。
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38);// external attrs: -rw-r--r--
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(path.resolve(zipPath)), { recursive: true });
  fs.writeFileSync(zipPath, Buffer.concat([Buffer.concat(chunks), centralBuf, eocd]));
  return { entries: files.length, bytes: fs.statSync(zipPath).size };
}

module.exports = { createZip, crc32, walk };

if (require.main === module) {
  const [zipPath, baseDir] = process.argv.slice(2);
  if (!zipPath || !baseDir) {
    console.error('用法：node tools/mos-zip.js <输出.zip> <基目录>');
    process.exit(2);
  }
  try {
    const r = createZip(zipPath, baseDir);
    console.log('[mos-zip] 已生成 ' + zipPath + '（' + r.entries + ' 条目，' + r.bytes + ' 字节）');
  } catch (err) {
    console.error('[mos-zip] 失败：' + (err && err.message ? err.message : err));
    process.exit(1);
  }
}
