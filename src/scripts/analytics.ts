const API_URLS = {
  realIp: 'https://api.china9.cn/api/getRealIpAddr',
  readCount: 'https://jzt2.china9.cn/api/readnum/addRead',
  statistics: 'https://jzt2.china9.cn/api/statistics/submit'
} as const

type FormValue = string | number | boolean | null | undefined

/**
 * 按 application/x-www-form-urlencoded 格式提交数据，保持与原 jQuery.post 一致。
 */
const postForm = async (
  url: string,
  data: Record<string, FormValue>,
  keepalive = false
): Promise<Response> => {
  const body = new URLSearchParams()

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      body.set(key, String(value))
    }
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body,
    keepalive
  })

  if (!response.ok) {
    throw new Error(`请求失败：${response.status} ${response.statusText}`)
  }

  return response
}

/** 从字符串或 JSON 响应中提取 IP。 */
const extractIp = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim()
  }

  if (!value || typeof value !== 'object') return ''

  const result = value as Record<string, unknown>
  const possibleValues = [result.ip, result.data, result.result, result.address]

  for (const possibleValue of possibleValues) {
    const ip = extractIp(possibleValue)
    if (ip) return ip
  }

  return ''
}

/**
 * 提交详情阅读量。应由产品或文章详情页的客户端脚本显式调用。
 */
export const submitReadCount = async (
  api: string,
  id: string | number
): Promise<void> => {
  if (typeof window === 'undefined') return

  try {
    await postForm(API_URLS.readCount, { id, type: api }, true)
  } catch (error) {
    console.error('[readCount] 提交阅读量失败：', error)
  }
}

/**
 * 获取当前访客公网 IP。服务端调用时返回空字符串，避免统计构建服务器 IP。
 */
export const getRealIp = async (): Promise<string> => {
  if (typeof window === 'undefined') return ''

  try {
    const response = await fetch(API_URLS.realIp, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain, */*'
      },
      cache: 'no-store'
    })

    if (!response.ok) {
      throw new Error(`请求失败：${response.status} ${response.statusText}`)
    }

    const text = (await response.text()).trim()
    if (!text) return ''

    try {
      return extractIp(JSON.parse(text))
    } catch {
      return extractIp(text.replace(/^"|"$/g, ''))
    }
  } catch (error) {
    console.error('[statistics] 获取访客 IP 失败：', error)
    return ''
  }
}

/** 网站访问统计。应在全站布局的客户端脚本中调用一次。 */
export const submitStatistics = async (): Promise<void> => {
  if (typeof window === 'undefined') return

  const data: Record<string, FormValue> = {
    url: window.location.hostname
  }

  const ip = await getRealIp()
  if (ip) data.ip = ip

  try {
    await postForm(API_URLS.statistics, data, true)
  } catch (error) {
    console.error('[statistics] 提交访问统计失败：', error)
  }
}
