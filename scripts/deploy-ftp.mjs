/**
 * 构建产物 FTP 上传脚本
 *
 * 用法: node scripts/deploy-ftp.mjs
 * 环境变量: FTP_HOST / FTP_PORT(默认21) / FTP_USER / FTP_PASS / FTP_REMOTE_DIR 必填
 *
 * 流程: astro build → 用 basic-ftp 把 sinopeg-output/ 同步到 FTP 远程目录
 *       （ensureDir 进入远程目录 → clearWorkingDir 清空旧文件 → 整体上传，
 *         保证服务器内容和构建产物完全一致，删除的数据不会残留）
 *
 * 本地跑也可用: 项目根目录建 .env 写好 FTP 配置（参考 .env.example）
 */

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import ftp from 'basic-ftp'

// 本地跑时读 .env（不带 dotenv 依赖，够用）
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
    // 先进入远程目录并清空旧文件再整体上传——
    // 数据删除后产物里已不存在的页面不能残留在服务器上
    await client.ensureDir(process.env.FTP_REMOTE_DIR)
    await client.clearWorkingDir()
    await client.uploadFromDir(OUT_DIR)
    console.log('🎉 FTP 上传完成')
  } finally {
    client.close()
  }
}

main().catch(err => {
  console.error(`\n❌ ${err.message || err}`)
  process.exit(1)
})
