/**
 * 搜索索引中的单条产品数据。
 * 这些字段由 /search-index.json 提供，Header 和 Banner 共用同一份数据。
 */
export type ProductSearchItem = {
  title: string;
  casNo: string;
  productNo: string;
  abbrName: string;
  keywords: string;
  intro: string;
}

type ProductSearchOptions = {
  /** 搜索表单选择器。 */
  form: string;
  /** 关键词输入框选择器。 */
  input: string;
  /** 候选词列表选择器。 */
  list: string;
  /** 查询元素的范围，默认从整个 document 中查找。 */
  root?: ParentNode;
  /** 搜索索引地址，默认使用当前 Astro 项目的 base 路径。 */
  endpoint?: string;
  /** 最多显示多少条候选词。 */
  limit?: number;
  /** 输入停止多久后开始搜索，避免每次按键都立即筛选。 */
  debounceDelay?: number;
  /** 输入框失焦后延迟隐藏，给候选词点击事件留出执行时间。 */
  blurDelay?: number;
}

/**
 * 与原站 getProductSearchSuggestions() 保持一致的候选词字段。
 * 搜索结果页还可以使用更多字段，但输入提示只从这些字段中取值。
 */
const SUGGESTION_FIELDS: (keyof ProductSearchItem)[] = [
  'title',
  'casNo',
  'productNo',
  'abbrName',
  'keywords',
  'intro'
]

/**
 * 每个 endpoint 只保存一个 Promise。
 * Header 和 Banner 同时初始化时会共用这次请求，不会重复下载搜索索引。
 */
const searchIndexPromises = new Map<string, Promise<ProductSearchItem[]>>()

const normalizeText = (value: unknown) => String(value ?? '').trim()

/**
 * 首次调用时请求搜索索引，后续直接复用缓存的 Promise。
 * 请求失败会清除缓存，让用户下一次输入时可以重新尝试。
 */
const loadSearchIndex = (endpoint: string) => {
  const cachedPromise = searchIndexPromises.get(endpoint)
  if (cachedPromise) return cachedPromise

  const request = fetch(endpoint)
    .then(response => {
      if (!response.ok) {
        throw new Error(`搜索索引加载失败：${response.status}`)
      }
      return response.json() as Promise<unknown>
    })
    .then(data => Array.isArray(data) ? data as ProductSearchItem[] : [])
    .catch(error => {
      searchIndexPromises.delete(endpoint)
      throw error
    })

  searchIndexPromises.set(endpoint, request)
  return request
}

/**
 * 根据关键词从指定字段中提取候选词。
 * Set 用来去重，例如 title 和 abbrName 内容相同时只显示一次。
 */
export const getProductSearchSuggestions = (
  items: ProductSearchItem[],
  keyword: string,
  limit = 10
) => {
  const searchKeyword = normalizeText(keyword).toLowerCase()
  const suggestions: string[] = []
  const seen = new Set<string>()

  if (!searchKeyword) return suggestions

  for (const item of items) {
    for (const field of SUGGESTION_FIELDS) {
      const value = normalizeText(item[field])
      const isMatched = value.toLowerCase().includes(searchKeyword)

      if (!value || !isMatched || seen.has(value)) continue

      seen.add(value)
      suggestions.push(value)

      if (suggestions.length >= limit) return suggestions
    }
  }

  return suggestions
}

/**
 * 给一个搜索框绑定完整交互。
 * Header 和 Banner 只需要提供各自的表单、输入框、列表选择器即可。
 */
export const initProductSearch = ({
  form: formSelector,
  input: inputSelector,
  list: listSelector,
  root = document,
  endpoint = `${import.meta.env.BASE_URL}search-index.json`,
  limit = 10,
  debounceDelay = 200,
  blurDelay = 120
}: ProductSearchOptions) => {
  const form = root.querySelector<HTMLFormElement>(formSelector)
  const input = root.querySelector<HTMLInputElement>(inputSelector)
  const list = root.querySelector<HTMLUListElement>(listSelector)

  // 某个组件没有渲染完整搜索结构时直接结束，避免影响页面其他功能。
  if (!form || !input || !list) return

  let debounceTimer: number | undefined
  let hideTimer: number | undefined
  let requestVersion = 0

  const hideSuggestions = () => {
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
  }

  /** 使用 textContent 创建候选项，避免把产品文字当成 HTML 执行。 */
  const renderSuggestions = (suggestions: string[]) => {
    list.replaceChildren()

    for (const suggestion of suggestions) {
      const item = document.createElement('li')
      item.textContent = suggestion
      item.style.fontSize = '14px'
      item.style.cursor = 'pointer'

      // mousedown 早于 input 的 blur，能够先完成回填再隐藏列表。
      item.addEventListener('mousedown', event => {
        event.preventDefault()
        input.value = suggestion
        hideSuggestions()
      })

      list.append(item)
    }

    const hasSuggestions = suggestions.length > 0
    list.hidden = !hasSuggestions
    input.setAttribute('aria-expanded', String(hasSuggestions))
  }

  const updateSuggestions = async () => {
    const keyword = input.value.trim()

    // 每次搜索都生成一个新版本号，用来丢弃较慢的旧请求结果。
    const currentVersion = ++requestVersion

    if (!keyword) {
      list.replaceChildren()
      hideSuggestions()
      return
    }

    try {
      const searchIndex = await loadSearchIndex(endpoint)

      const keywordChanged = input.value.trim() !== keyword
      const isOldRequest = currentVersion !== requestVersion
      const inputLostFocus = document.activeElement !== input

      if (keywordChanged || isOldRequest || inputLostFocus) return

      renderSuggestions(getProductSearchSuggestions(searchIndex, keyword, limit))
    } catch {
      // 搜索提示失败不应影响页面和表单提交，只隐藏候选列表。
      if (currentVersion === requestVersion) hideSuggestions()
    }
  }

  const scheduleSuggestions = () => {
    window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      void updateSuggestions()
    }, debounceDelay)
  }

  input.addEventListener('input', scheduleSuggestions)

  input.addEventListener('focus', () => {
    window.clearTimeout(hideTimer)
    void updateSuggestions()
  })

  input.addEventListener('blur', () => {
    window.clearTimeout(debounceTimer)
    hideTimer = window.setTimeout(() => {
      requestVersion++
      hideSuggestions()
    }, blurDelay)
  })

  // 表单自身使用 GET 跳转，这里只负责拦截空关键词。
  form.addEventListener('submit', event => {
    if (input.value.trim()) return

    event.preventDefault()
    window.alert('请输入查询的关键词')
    input.focus()
  })
}
