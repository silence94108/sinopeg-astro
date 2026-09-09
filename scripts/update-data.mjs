/**
 * 建站通2.0 数据包下载与比对脚本
 *
 * 用法: node scripts/update-data.mjs
 * 环境变量: JZT_SITE_ID 必填（制作端查看，每站唯一）
 *
 * 流程: 下载数据包 zip → 处理尾部 ThinkPHP trace → 解压到临时目录
 *       → 与 src/lib/jsonDatas 逐文件比对
 *       → 无变化: 清理退出码 0，输出 NO_CHANGES
 *       → 有变化: 替换 src/lib/jsonDatas 并输出 UPDATED
 *
 * 本地跑也可用: 项目根目录建 .env 写 JZT_SITE_ID（参考 .env.example）
 */

import { createWriteStream, existsSync, rmSync, cpSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import AdmZip from 'adm-zip'

// 本地跑时读 .env（云端由 workflow 注入环境变量，没有 .env 文件）
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const SITE_ID = process.env.JZT_SITE_ID
if (!SITE_ID) {
  console.error('❌ 缺少 JZT_SITE_ID 环境变量（制作端查看本站 site_id）')
  process.exit(1)
}

const CONFIG = {
  apiUrl: `https://jzt2.china9.cn/api/Download/index?site_id=${SITE_ID}`,
  downloadPath: 'temp_data.zip',
  tempExtractPath: 'temp_extract',
  targetPath: 'src/lib/jsonDatas',
  backupPath: 'jsonDatas_backup'
}

// ---------- 下载 ----------

async function downloadFile(url, dest) {
  console.log('📥 下载数据包...')
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`下载失败: HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 100 || buf.slice(0, 2).toString() !== 'PK') {
    throw new Error('下载内容不是有效的 zip 文件（检查 site_id 是否正确）')
  }
  console.log(`   ${(buf.length / 1024 / 1024).toFixed(2)} MB`)
  return buf
}

// ---------- 解压 ----------

// 服务端 ThinkPHP 开了 app_trace，会在 zip 末尾追加调试面板 HTML，
// 导致 EOCD 落在扫描窗口外，先从尾部找最后一个 EOCD 截掉垃圾。
function sanitizeZipBuffer(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      const commentLen = buf.readUInt16LE(i + 20)
      const realEnd = i + 22 + commentLen
      if (realEnd < buf.length) {
        console.log(`🩹 截掉 zip 尾部冗余 ${buf.length - realEnd} 字节（ThinkPHP trace）`)
      }
      return buf.slice(0, realEnd)
    }
  }
  throw new Error('未找到 zip End-of-Central-Directory 记录')
}

function extractZip(zipBuf) {
  console.log('📂 解压数据包...')
  const zip = new AdmZip(sanitizeZipBuffer(zipBuf))
  const hasJsonDatas = zip.getEntries().some(e => e.entryName.includes('jsonDatas/'))
  if (!hasJsonDatas) {
    throw new Error('压缩包中未找到 jsonDatas 目录')
  }
  rmSync(CONFIG.tempExtractPath, { recursive: true, force: true })
  zip.extractAllTo(CONFIG.tempExtractPath, true)

  // 数据包里 jsonDatas 可能嵌套在子目录下，递归找到它
  let jsonDatasPath = null
  function find(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (!statSync(full).isDirectory()) continue
      if (name === 'jsonDatas') { jsonDatasPath = full; return }
      find(full)
      if (jsonDatasPath) return
    }
  }
  find(CONFIG.tempExtractPath)
  if (!jsonDatasPath) {
    throw new Error('解压后未找到 jsonDatas 目录')
  }
  return jsonDatasPath
}

// ---------- 比对 ----------

function listFiles(dir, base = dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, base))
    } else {
      out.push({ rel: relative(base, full).replaceAll('\\', '/'), buf: readFileSync(full) })
    }
  }
  return out
}

function compareDatas(newDir, oldDir) {
  const newFiles = listFiles(newDir)
  const oldFiles = new Map(listFiles(oldDir).map(f => [f.rel, f.buf]))
  const changes = { added: [], removed: [], changed: [] }
  for (const f of newFiles) {
    const old = oldFiles.get(f.rel)
    if (!old) changes.added.push(f.rel)
    else if (!old.equals(f.buf)) changes.changed.push(f.rel)
  }
  for (const rel of oldFiles.keys()) {
    if (!newFiles.some(f => f.rel === rel)) changes.removed.push(rel)
  }
  return changes
}

// ---------- 主流程 ----------

async function main() {
  const zipBuf = await downloadFile(CONFIG.apiUrl, CONFIG.downloadPath)
  const newJsonDatasPath = extractZip(zipBuf)

  const changes = compareDatas(newJsonDatasPath, CONFIG.targetPath)
  const total = changes.added.length + changes.removed.length + changes.changed.length

  if (total === 0) {
    rmSync(CONFIG.tempExtractPath, { recursive: true, force: true })
    console.log('✅ 数据包无变化')
    console.log('::no-updates::')
    return
  }

  console.log(`📊 检测到变化: 新增 ${changes.added.length} / 修改 ${changes.changed.length} / 删除 ${changes.removed.length}`)
  for (const f of [...changes.added, ...changes.changed].slice(0, 20)) console.log(`   ~ ${f}`)

  // 先备份旧数据（失败可回滚），再替换新数据，最后才清理临时目录
  // （顺序不能乱：临时目录一删，newJsonDatasPath 就失效了）
  rmSync(CONFIG.backupPath, { recursive: true, force: true })
  cpSync(CONFIG.targetPath, CONFIG.backupPath, { recursive: true })
  rmSync(CONFIG.targetPath, { recursive: true, force: true })
  cpSync(newJsonDatasPath, CONFIG.targetPath, { recursive: true })
  rmSync(CONFIG.tempExtractPath, { recursive: true, force: true })
  rmSync(CONFIG.downloadPath, { force: true })

  console.log('🎉 数据包已更新到 src/lib/jsonDatas')
  console.log('::updated::')
}

main().catch(err => {
  console.error(`\n❌ ${err.message}`)
  rmSync(CONFIG.tempExtractPath, { recursive: true, force: true })
  rmSync(CONFIG.downloadPath, { force: true })
  process.exit(1)
})
