/**
 * 构建产物 FTP 上传脚本（增量模式）
 *
 * 用法: node scripts/deploy-ftp.mjs
 * 环境变量: FTP_HOST / FTP_PORT(默认21) / FTP_USER / FTP_PASS / FTP_REMOTE_DIR 必填
 *
 * 流程: astro build → 从 FTP 下载上次的 .deploy-manifest.json（文件 md5 清单）
 *       → 只上传新增/内容有变化的文件 → 上传新的 manifest
 *       不删除远程任何文件（含 .user.ini 等主机文件），同名文件直接覆盖。
 *
 * 本地跑也可用: 项目根目录建 .env 写好 FTP 配置（参考 .env.example）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, createHash, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execSync } from 'node:child_process'
import ftp from 'basic-ftp'

// 本地跑时读 .env（云端由 workflow 注入环境变量，没有 .env 文件）
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const REQUIRED = ['FTP_HOST', 'FTP_USER', 'FTP_PASS', 'FTP_REMOTE_DIR']
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌ 缺少 ${key} 环境变量（本地跑请写进 .env，云端跑配置在 GitHub Secrets）`)
    process.exit(1)
  }
}

const OUT_DIR = 'sinopeg-output'
const MANIFEST_NAME = '.deploy-manifest.json'
const TEMP_MANIFEST = 'temp-manifest.json'

function md5(buf) {
  return createHash('md5').update(buf).digest('hex')
}

// 递归收集本地构建产物的 { 相对路径, md5, buffer }
function collectLocalFiles(dir, base = dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      files.push(...collectLocalFiles(full, base))
    } else {
      const buf = readFileSync(full)
      files.push({ rel: relative(base, full).replaceAll('\\', '/'), md5: md5(buf) })
    }
  }
  return files
}

// 上传单个文件到远程目录（相对 baseDir 的路径，子目录不存在自动创建）
async function uploadOne(client, baseDir, rel, localPath) {
  await client.cd(baseDir)   // 用绝对路径回到站点根，避免相对路径累积越走越深
  const parts = rel.split('/')
  const fileName = parts.pop()
  for (const dir of parts) await client.ensureDir(dir)
  await client.uploadFrom(localPath, fileName)
}

async function main() {
  console.log('🏗️  构建站点...')
  execSync('npx astro build', { stdio: 'inherit' })

  console.log('📤 上传到 FTP...')
  const client = new ftp.Client(300 * 1000)
  client.ftp.verbose = false
  try {
    await client.access({
      host: process.env.FTP_HOST,
      port: Number(process.env.FTP_PORT || 21),
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false
    })
    // 进入目标目录（不存在则逐级创建），记下绝对路径作为后续的"站点根"
    await client.ensureDir(process.env.FTP_REMOTE_DIR)
    const baseDir = await client.pwd()
    console.log(`📁 远程目录: ${baseDir}`)

    // 下载上次的部署清单（首次部署时不存在）
    let oldManifest = {}
    try {
      await client.downloadTo(TEMP_MANIFEST, MANIFEST_NAME)
      oldManifest = JSON.parse(readFileSync(TEMP_MANIFEST, 'utf8'))
      console.log(`📋 已加载上次部署清单（${Object.keys(oldManifest).length} 个文件）`)
    } catch {
      console.log('📋 无历史部署清单，本次全量上传（建立基线）')
    }

    const localFiles = collectLocalFiles(OUT_DIR)
    const changed = localFiles.filter(f => oldManifest[f.rel] !== f.md5)
    const unchanged = localFiles.length - changed.length

    if (changed.length === 0) {
      console.log(`✅ ${localFiles.length} 个文件全部无变化，无需上传`)
      return
    }

    console.log(`📊 共 ${localFiles.length} 个文件: 需上传 ${changed.length} 个, 跳过 ${unchanged} 个未变化文件`)

    let done = 0
    for (const f of changed) {
      await uploadOne(client, baseDir, f.rel, join(OUT_DIR, f.rel))
      done++
      if (done % 50 === 0 || done === changed.length) {
        console.log(`   ${done}/${changed.length}`)
      }
    }

    // 全部成功后才写新清单（中途失败下次会重传未确认的文件，安全）
    const newManifest = {}
    for (const f of localFiles) newManifest[f.rel] = f.md5
    writeFileSync(TEMP_MANIFEST, JSON.stringify(newManifest))
    await uploadOne(client, baseDir, MANIFEST_NAME, TEMP_MANIFEST)
    console.log('🎉 增量上传完成')
  } finally {
    client.close()
    rmSync(TEMP_MANIFEST, { force: true })
  }
}

main().catch(err => {
  console.error(`\n❌ ${err.message || err}`)
  process.exit(1)
})
