import type { APIRoute } from 'astro'
import { requestData, type DataItem } from '../lib/utils'

type SearchIndexItem = {
  id: string;
  category_id: string;
  title: string;
  casNo: string;
  productNo: string;
  abbrName: string;
  keywords: string;
  webKey: string;
  webDesc: string;
  intro: string;
  searchText: string;
}

/**
 * 后端 JSON 中的字段可能是字符串、数组或对象。
 * endpoint 统一转成普通字符串，浏览器端就不需要反复判断数据类型。
 */
const toText: any = (value: unknown) => {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map(toText).join(' ')
  if (typeof value === 'object') return Object.values(value).map(toText).join(' ')
  return String(value)
}

// 当前项目是静态构建，这个 endpoint 会在 build 时生成 /search-index.json。
export const prerender = true

export const GET: APIRoute = () => {
  // 这里只读取后端提供的 goods.json，不会修改或回写原始 JSON。
  const goods = requestData('goods', {
    data_type: 'list',
    limit: -1,
    sort: 'sortDesc'
  }) as DataItem[]

  // 只输出搜索会用到的字段，减少首页首次搜索时的下载体积。
  const searchIndex: SearchIndexItem[] = goods.map(item => ({
    id: toText(item.id),
    category_id: toText(item.category_id),
    title: toText(item.title),
    casNo: toText(item.casNo),
    productNo: toText(item.productNo),
    abbrName: toText(item.abbrName),
    keywords: toText(item.keywords),
    webKey: toText(item.webKey),
    webDesc: toText(item.webDesc),
    intro: toText(item.intro),
    searchText: toText(item.searchText)
  }))

  return new Response(JSON.stringify(searchIndex), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 每次部署后浏览器会重新校验文件，避免长期使用旧产品数据。
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  })
}
