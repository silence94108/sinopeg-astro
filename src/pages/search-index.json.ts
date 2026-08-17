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

const toText = (value: unknown) => {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map(toText).join(' ')
  if (typeof value === 'object') return Object.values(value).map(toText).join(' ')
  return String(value)
}

export const GET: APIRoute = () => {
  const goods = requestData('goods', {
    data_type: 'list',
    limit: -1,
    sort: 'sortDesc'
  }) as DataItem[]

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
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  })
}
