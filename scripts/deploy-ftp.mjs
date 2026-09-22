/**
 * 构建产物 FTP 上传脚本
 *
 * 用法:
 *   node scripts/deploy-ftp.mjs                增量上传（默认）：按远程 md5 清单只传新增/变化的文件
 *   node scripts/deploy-ftp.mjs --full         全量上传：sinopeg-output 内所有文件全部推送
 *   node scripts/deploy-ftp.mjs --no-build     跳过构建，直接上传现有 sinopeg-output
 *   node scripts/deploy-ftp.mjs --dry-run      只列出将要上传的文件与体积，不实际传输
 *   node scripts/deploy-ftp.mjs --help         查看帮助
 *
 * 可组合，例如: node scripts/deploy-ftp.mjs --full --no-build
 *
 * 环境变量: FTP_HOST / FTP_PORT(默认21) / FTP_USER / FTP_PASS / FTP_REMOTE_DIR 必填
 *
 * 行为要点:
 *   - 上传过程显示实时进度：百分比进度条 / 已传字节 / 文件计数 / 速度 / 预估剩余 / 当前文件
 *   - **从不删除远程任何文件**（保护 .user.ini 等主机文件；本地已删页面会成为远程孤儿文件）
 *   - 按目录分组上传，每个目录只做一次 cd + MKD，大幅减少 FTP 往返（全量上传提速关键）
 *   - 同名文件直接覆盖（STOR）
 *
 * 本地跑也可用: 项目根目录建 .env 写好 FTP 配置（参考 .env.example）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { execSync } from 'node:child_process'
import ftp from 'basic-ftp'

const OUT_DIR = 'sinopeg-output'
const MANIFEST_NAME = '.deploy-manifest.json'
const TEMP_MANIFEST = 'temp-manifest.json'

// ---------------------------------------------------------------- 参数解析

const argv = process.argv.slice(2)
const has = (...names) => names.some((n) => argv.includes(n))

const opts = {
  full: has('--full', '-f'),
  noBuild: has('--no-build', '--skip-build'),
  dryRun: has('--dry-run', '-n'),
  help: has('--help', '-h'),
}

const HELP = `
构建产物 FTP 上传脚本

  node scripts/deploy-ftp.mjs                增量上传（默认，按 md5 清单只传变化文件）
  node scripts/deploy-ftp.mjs --full         全量上传（忽略清单，全部推送）
  node scripts/deploy-ftp.mjs --no-build     跳过构建，直接上传现有 sinopeg-output
  node scripts/deploy-ftp.mjs --dry-run      只列出将要上传的内容，不实际传输
  node scripts/deploy-ftp.mjs --help         显示本帮助

  --full / --no-build / --dry-run 可组合。

环境变量: FTP_HOST / FTP_PORT(默认21) / FTP_USER / FTP_PASS / FTP_REMOTE_DIR
`

if (opts.help) {
  console.log(HELP)
  process.exit(0)
}

// ---------------------------------------------------------------- .env

// 本地跑时读 .env（云端由 workflow 注入环境变量，没有 .env 文件）
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

// dry-run + full 无需连 FTP（全量上传不依赖远程清单），因此不强制要求 FTP 配置
const needRemote = !(opts.dryRun && opts.full)

if (needRemote) {
  const REQUIRED = ['FTP_HOST', 'FTP_USER', 'FTP_PASS', 'FTP_REMOTE_DIR']
  for (const key of REQUIRED) {
    if (!process.env[key]) {
      console.error(`❌ 缺少 ${key} 环境变量（本地跑请写进 .env，云端跑配置在 GitHub Secrets）`)
      process.exit(1)
    }
  }
}

// ---------------------------------------------------------------- 工具函数

const md5 = (buf) => createHash('md5').update(buf).digest('hex')

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) n = 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  sec = Math.round(sec)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m${String(s).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// 路径太长时保留尾部（目录前缀重复度高，尾部信息量更大）
function tailName(p, room) {
  if (p.length <= room) return p
  return '…' + p.slice(-(room - 1))
}

// 递归收集本地构建产物 { 相对路径, md5, 字节数 }
function collectLocalFiles(dir, base = dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      files.push(...collectLocalFiles(full, base))
    } else {
      const buf = readFileSync(full)
      files.push({
        rel: relative(base, full).replaceAll('\\', '/'),
        md5: md5(buf),
        size: buf.length,
      })
    }
  }
  return files
}

// ---------------------------------------------------------------- 进度显示

const isTTY = Boolean(process.stdout.isTTY)
const BAR_WIDTH = 28
const COLS = process.stdout.columns || 110

let totalFiles = 0
let totalBytes = 0
let uploadedFiles = 0
let bytesDone = 0
let currentFile = ''
let startTs = Date.now()

function progressLine() {
  const elapsed = (Date.now() - startTs) / 1000
  const ratio =
    totalBytes > 0
      ? Math.min(1, bytesDone / totalBytes)
      : totalFiles > 0
        ? uploadedFiles / totalFiles
        : 1
  const speed = elapsed > 0.3 ? bytesDone / elapsed : 0
  const remain = speed > 0 ? Math.max(0, (totalBytes - bytesDone) / speed) : 0

  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(ratio * BAR_WIDTH)))
  const bar = '='.repeat(filled) + '-'.repeat(BAR_WIDTH - filled)

  let line =
    `[${bar}] ${(ratio * 100).toFixed(1).padStart(5)}%  ` +
    `${uploadedFiles}/${totalFiles} 文件  ` +
    `${fmtBytes(bytesDone)}/${fmtBytes(totalBytes)}  ` +
    `${fmtBytes(speed)}/s  剩 ${fmtDur(remain)}`

  if (currentFile) {
    const room = COLS - line.length - 2
    if (room > 12) line += '  ' + tailName(currentFile, room)
  }
  return line
}

// TTY：同一行原地刷新（进度条）
function renderBar() {
  if (!isTTY) return
  const line = progressLine()
  process.stdout.write('\r' + line.slice(0, COLS).padEnd(COLS))
}

// 非 TTY（CI 日志）：按文件计数定期打整行，避免 \r 把日志刷乱
function renderLinePeriodic() {
  if (isTTY) return
  if (uploadedFiles % 25 === 0 || uploadedFiles === totalFiles) {
    console.log('   ' + progressLine())
  }
}

function endBar() {
  if (isTTY) process.stdout.write('\n')
}

// ---------------------------------------------------------------- 上传

// 按目录分组：每个目录只 cd/MKD 一次，然后连续 STOR 该目录下所有文件
async function uploadGrouped(client, baseDir, files) {
  const groups = new Map()
  for (const f of files) {
    const i = f.rel.lastIndexOf('/')
    const dir = i < 0 ? '' : f.rel.slice(0, i)
    const name = i < 0 ? f.rel : f.rel.slice(i + 1)
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir).push({ rel: f.rel, name })
  }

  for (const [dir, items] of groups) {
    await client.cd(baseDir) // 用绝对路径回到站点根，避免相对路径累积越走越深
    if (dir) await client.ensureDir(dir)
    for (const it of items) {
      currentFile = it.rel
      await client.uploadFrom(join(OUT_DIR, it.rel), it.name)
      uploadedFiles++
      if (isTTY) renderBar()
      renderLinePeriodic()
    }
  }
  currentFile = ''
}

// 上传单个文件到站点根下的相对路径（用于清单文件）
async function uploadOne(client, baseDir, rel, localPath) {
  await client.cd(baseDir)
  const parts = rel.split('/')
  const fileName = parts.pop()
  for (const dir of parts) await client.ensureDir(dir)
  await client.uploadFrom(localPath, fileName)
}

// ---------------------------------------------------------------- 主流程

async function main() {
  const t0 = Date.now()

  if (opts.noBuild) {
    if (!existsSync(OUT_DIR)) {
      console.error(`❌ 未找到 ${OUT_DIR}/，无法跳过构建。请先执行 npm run build，或去掉 --no-build`)
      process.exit(1)
    }
    console.log(`⏭️  跳过构建（--no-build），直接使用现有 ${OUT_DIR}/`)
  } else {
    console.log('🏗️  构建站点...')
    execSync('npx astro build', { stdio: 'inherit' })
  }

  const localFiles = collectLocalFiles(OUT_DIR)
  const localBytes = localFiles.reduce((s, f) => s + f.size, 0)
  console.log(`📦 本地产物: ${localFiles.length} 个文件, ${fmtBytes(localBytes)}`)
  console.log(`📡 模式: ${opts.full ? '全量上传' : '增量上传（md5 比对）'}${opts.dryRun ? ' · 演练模式（不传输）' : ''}`)

  // 全量 + 演练：不依赖远程清单，直接输出计划
  if (opts.dryRun && opts.full) {
    totalFiles = localFiles.length
    totalBytes = localBytes
    console.log('')
    console.log('🧪 演练结果（全量）：将上传以下内容，不实际传输')
    const byDir = new Map()
    for (const f of localFiles) {
      const i = f.rel.indexOf('/')
      const top = i < 0 ? '(站点根)' : f.rel.slice(0, i)
      const g = byDir.get(top) || { n: 0, b: 0 }
      g.n++
      g.b += f.size
      byDir.set(top, g)
    }
    const rows = [...byDir.entries()].sort((a, b) => b[1].n - a[1].n)
    for (const [top, g] of rows) {
      console.log(`   ${String(g.n).padStart(5)} 个  ${fmtBytes(g.b).padStart(10)}   ${top}`)
    }
    console.log('')
    console.log(`✅ 合计 ${localFiles.length} 个文件, ${fmtBytes(localBytes)}, 涉及 ${rows.length} 个顶层目录`)
    return
  }

  console.log('📤 连接 FTP...')
  const client = new ftp.Client(300 * 1000)
  client.ftp.verbose = false
  try {
    await client.access({
      host: process.env.FTP_HOST,
      port: Number(process.env.FTP_PORT || 21),
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false,
    })

    // 进入目标目录（不存在则逐级创建），记下绝对路径作为后续的"站点根"
    await client.ensureDir(process.env.FTP_REMOTE_DIR)
    const baseDir = await client.pwd()
    console.log(`📁 远程目录: ${baseDir}`)

    // 决定本次要传哪些文件
    let toUpload = localFiles
    if (!opts.full) {
      let oldManifest = {}
      try {
        await client.downloadTo(TEMP_MANIFEST, MANIFEST_NAME)
        oldManifest = JSON.parse(readFileSync(TEMP_MANIFEST, 'utf8'))
        console.log(`📋 已加载上次部署清单（${Object.keys(oldManifest).length} 个文件）`)
      } catch {
        console.log('📋 无历史部署清单，本次全量上传（建立基线）')
      }
      toUpload = localFiles.filter((f) => oldManifest[f.rel] !== f.md5)
      console.log(
        `📊 增量比对: 需上传 ${toUpload.length} 个, 跳过 ${localFiles.length - toUpload.length} 个未变化文件`
      )
    } else {
      console.log(`📊 全量模式: 需上传 ${localFiles.length} 个文件`)
    }

    if (toUpload.length === 0) {
      console.log(`✅ ${localFiles.length} 个文件全部无变化，无需上传`)
      return
    }

    totalFiles = toUpload.length
    totalBytes = toUpload.reduce((s, f) => s + f.size, 0)
    uploadedFiles = 0
    bytesDone = 0
    startTs = Date.now()

    // 底层每 500ms 回调一次 { name, bytes, bytesOverall }；bytesOverall 为累计已传字节。
    // transfer 结束时会调 updateAndStop() 做最终结算，所以这个累计值是精确的。
    // 注意：两种模式都要挂，非 TTY 下也要更新 bytesDone（只是不画进度条，见 renderBar）。
    client.trackProgress((info) => {
      bytesDone = info.bytesOverall
      renderBar()
    })

    console.log(`🚀 开始上传：${totalFiles} 个文件, ${fmtBytes(totalBytes)}`)
    console.log('')

    await uploadGrouped(client, baseDir, toUpload)

    endBar()
    client.trackProgress() // 停止进度跟踪，清单文件不计入进度

    const elapsed = (Date.now() - startTs) / 1000
    const avg = elapsed > 0 ? totalBytes / elapsed : 0
    console.log('')
    console.log(
      `🎉 上传完成: ${totalFiles} 个文件, ${fmtBytes(totalBytes)}, 用时 ${fmtDur(elapsed)}, 平均 ${fmtBytes(avg)}/s`
    )

    if (opts.dryRun) {
      console.log('🧪 演练模式：未写入远程部署清单，也未修改任何远程文件')
      return
    }

    // 全部成功后才写新清单（中途失败下次会重传未确认的文件，安全）
    const newManifest = {}
    for (const f of localFiles) newManifest[f.rel] = f.md5
    writeFileSync(TEMP_MANIFEST, JSON.stringify(newManifest))
    await uploadOne(client, baseDir, MANIFEST_NAME, TEMP_MANIFEST)
    console.log(`📋 部署清单已更新（${localFiles.length} 个文件）`)

    if (opts.full) {
      console.log('ℹ️  全量上传只覆盖同名文件；远程若有本地已不存在的文件，仍会保留（脚本从不删除远程文件）')
    }

    console.log(`⏱️  总耗时 ${fmtDur((Date.now() - t0) / 1000)}`)
  } finally {
    client.close()
    rmSync(TEMP_MANIFEST, { force: true })
  }
}

main().catch((err) => {
  endBar()
  console.error(`\n❌ ${err.message || err}`)
  process.exit(1)
})
