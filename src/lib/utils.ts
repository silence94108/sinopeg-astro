/* 数据列表处理
  * api 需要获取的数据JSON文件
  * datas {
    ** data_type 数据返回格式 'page || list || show' 默认'page'
    *** 'page': {
        total: (总条数)
        last_page: (总页数)
        data: (数据列表)
      }
    *** 'list': list(数据列表)
    *** 'show': {
        up: (上一条数据),
        down: (下一条数据),
        info: (详情内容)
      }
    ** page 当前页 默认1
    ** limit 每页显示条数 默认10  获取全部数据时可设置为-1
    ** category_id 分类id筛选
    ** id  列表数据id筛选
    ** sort 排序筛选 timeAsc时间正序、timeDesc时间倒序、sortAsc排序ID正序、sortDesc排序ID倒序
    ** list_type all取所有数据（包含所有子级） alone只取当前分类所有数据（不包含所有子级）children分类子集递归查询 默认为alone
    ** type 类型筛选（主要用于category.json分类筛选） goods产品 content文章 text信息 carousel轮播 image图片
    ** column_id 栏目ID筛选(栏目ID从制作端查看)
    ** search_name 标题或指定字段模糊查找
    ** browse  兼容旧参数；阅读量由详情页客户端调用 submitReadCount
    ** method  兼容旧参数；构建期本地 JSON 不再使用 session 请求缓存
  } 数据筛选条件
*/

export type DataItem = Record<string, any>
export type DataType = 'page' | 'list' | 'show'
export type ListType = 'alone' | 'all' | 'children'
export type SortType = 'sortAsc' | 'sortDesc' | 'timeAsc' | 'timeDesc'

export interface ParamsConfig {
  data_type?: DataType;
  page?: number;
  limit?: number;
  category_id?: string | number;
  id?: string | number;
  sort?: SortType;
  list_type?: ListType;
  type?: string;
  column_id?: string | number;
  search_name?: string;
  search_fields?: string[];
  exact_search?: boolean;
  search_to_lowerCase?: boolean;
  search_in_intro_detail?: boolean;
  // 兼容旧调用；阅读量已移到客户端 submitReadCount，不再由筛选方法处理。
  browse?: number | boolean;
  // 兼容旧调用；本地构建期 JSON 不再需要 session 请求缓存。
  method?: string;
  // 支持 isIndex、isNav、recommend 等数据中已有字段的动态精确筛选。
  [key: string]: unknown;
}

type JsonData = unknown[] | Record<string, unknown>

const jsonFiles = import.meta.glob(
  './jsonDatas/**/*.json',
  {
    eager: true,
    import: 'default'
  }
) as Record<string, JsonData>

/**
 * 按相对名称读取 jsonDatas 目录中的 JSON。
 * 例如 getJsonData('news') 读取 news.json，getJsonData('goods/123') 读取 goods/123.json。
 */
export function getJsonData<T = JsonData>(name: string): T {
  const path = `./jsonDatas/${name}.json`
  const result = jsonFiles[path]

  if (!result) {
    throw new Error(`找不到数据文件：${path}`)
  }

  return result as T
}

/**
 * 读取指定列表 JSON，并根据 params 完成筛选、排序、分页或详情处理。
 * 不传 params 时直接返回原始列表数据。
 */
export function requestData(
  api: string,
  params: ParamsConfig | null = null
) {
  const source = getJsonData<DataItem[]>(api)

  if (!Array.isArray(source)) {
    throw new Error(`${api}.json 不是列表数据`)
  }

  if (!params) return source

  // category.json 是分类树和分类名称补全的数据源；请求分类本身时直接复用 source。
  const cateJson = api === 'category'
    ? source
    : getJsonData<DataItem[]>('category')

  return filterDataList(api, params, source, cateJson)
}

type DateInput = string | number | Date

/**
 * 将日期或时间戳格式化为指定字符串。
 *
 * 支持的占位符：Y 年、m 月、d 日、h 时、i 分、s 秒。
 * 例如：timeStamp2String(time, 'Y-m-d h:i:s')。
 */
export const timeStamp2String = (
  time: DateInput,
  format = 'Y-m-d h:i:s'
): string => {
  let date: Date

  if (time instanceof Date) {
    date = new Date(time.getTime())
  } else if (
    typeof time === 'number' ||
    (typeof time === 'string' && /^\d+$/.test(time))
  ) {
    const timestamp = Number(time)
    // 10 位 Unix 时间戳按秒处理，其余数字按毫秒处理。
    date = new Date(String(Math.trunc(Math.abs(timestamp))).length === 10
      ? timestamp * 1000
      : timestamp)
  } else {
    // 兼容 Safari 对 YYYY-MM-DD HH:mm:ss 格式的解析。
    date = new Date(time.replace(/-/g, '/'))
  }

  if (Number.isNaN(date.getTime())) return ''

  const pad = (value: number) => String(value).padStart(2, '0')
  const values: Record<string, string> = {
    Y: String(date.getFullYear()),
    m: pad(date.getMonth() + 1),
    d: pad(date.getDate()),
    h: pad(date.getHours()),
    i: pad(date.getMinutes()),
    s: pad(date.getSeconds())
  }

  return format.replace(/[Ymdhis]/g, token => values[token])
}

/**
 * 将搜索字段统一转换为可比较的字符串，并按需转成小写。
 * 数组和对象会先合并其内容，null 和 undefined 会转换为空字符串。
 */
function normalizeSearchFieldValue(value: unknown, toLowerCase: boolean) {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) {
    value = value.map(item => {
      if (item === undefined || item === null) return ''
      if (typeof item === 'object') return Object.values(item as Record<string, unknown>).join(' ')
      return item
    }).join(' ')
  } else if (typeof value === 'object') {
    value = Object.values(value as Record<string, unknown>).join(' ')
  }
  const normalizedValue = String(value).trim()
  return toLowerCase ? normalizedValue.toLowerCase() : normalizedValue
}

/** 判断单个字段是否符合关键词，支持精确匹配和包含匹配。 */
function matchSearchFieldValue(
  value: unknown,
  keyword: unknown,
  exactSearch: boolean,
  toLowerCase: boolean
) {
  const source = normalizeSearchFieldValue(value, toLowerCase)
  const target = normalizeSearchFieldValue(keyword, toLowerCase)
  if (!source || !target) return false
  return exactSearch ? source === target : source.includes(target)
}

/** 判断一条数据的任意指定字段是否命中搜索关键词。 */
function matchSearchKeywordByFields(
  item: DataItem,
  keyword: unknown,
  fields: string[],
  exactSearch: boolean,
  toLowerCase: boolean
) {
  if (!item || !Array.isArray(fields) || !fields.length) return false
  return fields.some(field => matchSearchFieldValue(item[field], keyword, exactSearch, toLowerCase))
}

/** 将单个 ID 或逗号分隔的多个 ID 统一转成字符串数组。 */
const splitIds = (value: unknown): string[] => {
  if (value === undefined || value === null) return []

  return String(value)
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
}
/** 判断两个 ID 集合是否存在交集，左右两边都支持逗号分隔。 */
const hasIdIntersection = (left: unknown, right: unknown): boolean => {
  const rightIds = new Set(splitIds(right))
  return splitIds(left).some(id => rightIds.has(id))
}

/**
 * 复制数据并转换 create_time。
 * 这样筛选过程中增加 category、children、level 等字段时不会污染原始 JSON。
 */
const cloneDataList = (data: DataItem[]): DataItem[] => {
  return data.map(item => {
    const copy = { ...item }

    if (typeof copy.create_time === 'string') {
      const timestamp = new Date(copy.create_time.replace(/-/g, '/')).getTime()
      if (!Number.isNaN(timestamp)) copy.create_time = timestamp
    }

    return copy
  })
}

/** 按指定字段排序；没有传 sort 时保持 JSON 原有顺序。 */
const dataSort = (sort: SortType | undefined, arr: DataItem[]): DataItem[] => {
  if (!sort) return arr

  return arr.sort((a, b) => {
    switch (sort) {
      case 'sortAsc':
        return Number(a.sort || 0) - Number(b.sort || 0)
      case 'sortDesc':
        return Number(b.sort || 0) - Number(a.sort || 0)
      case 'timeAsc':
        return Number(a.create_time || 0) - Number(b.create_time || 0)
      case 'timeDesc':
        return Number(b.create_time || 0) - Number(a.create_time || 0)
      default:
        return 0
    }
  })
}

/**
 * 数据列表处理。
 *
 * 保持 requestData(api, params) 的调用方式不变，支持栏目、分类、类型、搜索、
 * 动态字段、排序、分页和详情上下条筛选，并为结果补充分类层级信息。
 */
const filterDataList = (
  api: string,
  condition: ParamsConfig,
  data: DataItem[],
  cateJson: DataItem[]
) => {
  const data_type = condition.data_type || 'page'
  const page = condition.page || 1
  const limit = condition.limit || 10
  const category_id = condition.category_id
  const id = condition.id
  const sort = condition.sort
  const type = condition.type
  const column_id = condition.column_id
  const list_type = condition.list_type || 'alone'
  const search_name = condition.search_name
  const search_fields = Array.isArray(condition.search_fields) ? condition.search_fields : null
  const exact_search = condition.exact_search || false
  const search_to_lowerCase = condition.search_to_lowerCase || false
  const search_in_intro_detail = condition.search_in_intro_detail || false
  let newData = cloneDataList(data)
  let total = newData.length
  let last_page = Math.ceil(total / limit)
  let up: DataItem | null = null
  let down: DataItem | null = null

  // 栏目id筛选
  if (column_id) {
    newData = newData.filter((item: any) => item.column_id == column_id)
  }

  // 置顶数据优先，两组内部再应用用户指定的排序方式。
  const topList = dataSort(sort, newData.filter((item: DataItem) => item.is_top == 1))
  const dataList = dataSort(sort, newData.filter((item: DataItem) => item.is_top != 1))
  if (topList.length || dataList.length) newData = topList.concat(dataList)
  else newData = dataSort(sort, newData)

  if (category_id && list_type == 'alone') {
    newData = newData.filter((item: DataItem) => {
      if (api == 'category' || api == 'navigation' || api == 'nav' || type == 'navigation') {
        return hasIdIntersection(item.pid, category_id)
      }

      // 例如数据为 "a,b,c"，用户传入 "b" 时也能正确命中。
      return hasIdIntersection(item.category_id, category_id)
    })
  }
  if (category_id && (list_type == 'all' || list_type == 'children')) {
    let type_category = condition.type || api
    if (api == 'category' || type == 'navigation') type_category = type || ''
    if (api == 'navigation' || api == 'nav') type_category = 'navigation'

    // 分类树使用独立副本，避免 children 字段写回原始 category.json。
    let cateList = cloneDataList(cateJson)
    if (column_id) cateList = cateList.filter(item => item.column_id == column_id)
    if (type_category) cateList = cateList.filter(item => item.type == type_category)
    cateList = dataSort(sort, cateList)

    const childrenByPid = new Map<string, DataItem[]>()
    cateList.forEach(item => {
      const pid = String(item.pid ?? '')
      const children = childrenByPid.get(pid) || []
      children.push(item)
      childrenByPid.set(pid, children)
    })

    // 用 visited 防止异常分类数据形成循环引用后无限递归。
    const childTree = (pid: string, nested: boolean, visited = new Set<string>()): DataItem[] => {
      if (visited.has(pid)) return []

      const nextVisited = new Set(visited)
      nextVisited.add(pid)
      const children = childrenByPid.get(pid) || []

      if (nested) {
        return children.map(item => ({
          ...item,
          children: childTree(String(item.id), true, nextVisited)
        }))
      }

      return children.flatMap(item => [
        item,
        ...childTree(String(item.id), false, nextVisited)
      ])
    }

    const rootIds = splitIds(category_id)
    const rootIdSet = new Set(rootIds)
    const rootCategories = cateList.filter(item => rootIdSet.has(String(item.id)))
    const descendantCategories = rootIds.flatMap(rootId => childTree(rootId, false))
    const matchedCategories = list_type == 'children'
      ? descendantCategories
      : rootCategories.concat(descendantCategories)
    const matchedCategoryIds = new Set(matchedCategories.map(item => String(item.id)))

    if (api == 'category' || api == 'navigation' || api == 'nav' || type == 'navigation') {
      newData = list_type == 'children'
        ? rootIds.flatMap(rootId => childTree(rootId, true))
        : matchedCategories
    } else {
      newData = newData.filter(item => {
        return splitIds(item.category_id).some(itemCategoryId => matchedCategoryIds.has(itemCategoryId))
      })
    }
  }
  if (type) {
    newData = newData.filter(item => item.type == type)
  }
  if (search_name) {
    const fieldList: string[] = search_fields?.length
      ? search_fields
      : search_in_intro_detail
        ? ['title', 'intro', 'details']
        : ['title']

    newData = newData.filter(item => matchSearchKeywordByFields(item, search_name, fieldList, exact_search, search_to_lowerCase))
  }
  if (id) {
    const currentIndex = newData.findIndex(item => item.id == id)

    if (currentIndex >= 0) {
      up = currentIndex > 0 ? newData[currentIndex - 1] : null
      down = currentIndex < newData.length - 1 ? newData[currentIndex + 1] : null
      newData = [newData[currentIndex]]
    } else {
      newData = []
    }

  }

  // 自动按字段过滤：除上述保留字外，condition 上传啥字段就按啥精确匹配（item[key] == condition[key]）
  // 让 requestData 支持 isIndex: true / isNav: true / recommend: true 这类布尔筛选，不用每次新增字段都改这里
  const RESERVED_KEYS = new Set([
    'data_type', 'page', 'limit', 'sort', 'list_type', 'type',
    'column_id', 'category_id', 'id', 'search_name',
    'search_fields', 'exact_search', 'search_to_lowerCase', 'search_in_intro_detail',
    'browse', 'method'
  ])
  Object.keys(condition).forEach(key => {
    if (RESERVED_KEYS.has(key)) return
    const expectedValue = condition[key]
    if (expectedValue === undefined || expectedValue === null) return

    const sourceHasField = data.some(item => key in item)
    newData = newData.filter(item => item[key] == expectedValue)

    if (!sourceHasField) {
      console.warn(`[requestData] 参数 "${key}" 在 ${api}.json 中不存在，可能是字段名写错了`)
    }
  })

  total = newData.length
  last_page = limit > -1 ? Math.ceil(total / limit) : 1;
  if (limit > -1) newData = newData.slice((page - 1) * limit, limit * page)

  if (api != 'category' && api != 'navigation' && api != 'nav' && type != 'navigation') {
    let cateLists = cloneDataList(cateJson)
    if (column_id) cateLists = cateLists.filter(item => item.column_id == column_id)
    cateLists = dataSort(sort, cateLists)

    const categoryById = new Map(cateLists.map(item => [String(item.id), item]))

    // 从当前分类向上查找父分类，并为根分类到当前分类计算 level。
    const getCategoryPath = (category: DataItem): DataItem[] => {
      const path: DataItem[] = []
      const visited = new Set<string>()
      let current: DataItem | undefined = category

      while (current) {
        const currentId = String(current.id)
        if (visited.has(currentId)) break

        visited.add(currentId)
        path.push({ ...current })
        current = categoryById.get(String(current.pid))
      }

      const depth = path.length
      return path.map((item, index) => ({ ...item, level: depth - index }))
    }

    newData = newData.map(item => {
      const categoryMap = new Map<string, DataItem>()

      // 一个条目属于多个分类时，每个 category_id 都补充对应分类链。
      splitIds(item.category_id).forEach(itemCategoryId => {
        const category = categoryById.get(itemCategoryId)
        if (!category) return

        getCategoryPath(category).forEach(categoryItem => {
          const categoryItemId = String(categoryItem.id)
          if (!categoryMap.has(categoryItemId)) {
            categoryMap.set(categoryItemId, categoryItem)
          }
        })
      })

      if (!categoryMap.size) return item
      return { ...item, category: Array.from(categoryMap.values()) }
    })
  }
  if (data_type == 'page') {
    return {
      total,
      last_page,
      data: newData
    }
  }
  if (data_type == 'list') {
    return newData
  }
  if (data_type == 'show') {
    return {
      up,
      down,
      info: total > 0 ? newData[0] : {}
    }
  }
}
