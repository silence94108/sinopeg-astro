/**
 * 构建产物 FTP 上传脚本
 *
 * 用法: node scripts/deploy-ftp.mjs
 * 环境变量: FTP_HOST / FTP_PORT(默认21) / FTP_USER / FTP_PASS / FTP_REMOTE_DIR 必填
 *
 * 流程: astro build → 用 basic-ftp 把 sinopeg-output/ 覆盖上传到 FTP 远程目录
 *       （不删除远程已有文件，同名文件直接覆盖——服务器上有主机自动放的
 *         .user.ini 等文件不能动，只管传自己的产物）
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
    // 进入目标目录（不存在则逐级创建），直接覆盖上传，不动远程已有文件
    await client.ensureDir(process.env.FTP_REMOTE_DIR)
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
