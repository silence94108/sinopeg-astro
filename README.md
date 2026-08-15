# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

## `requestData` 本地数据读取

`requestData` 用于在 Astro 页面、布局或组件的构建阶段，读取 `src/lib/jsonDatas` 中的 JSON 数据。不传筛选参数时可以读取数组或对象；传入筛选参数时可对列表数组完成筛选、排序、分页和详情上下条处理。

它适合以下场景：

- 项目构建时已经拿到了 JSON 数据，页面只需要渲染本地数据。
- 列表页需要按栏目、分类、类型或自定义字段筛选。
- 列表需要分页、排序或搜索。
- 详情页需要当前数据以及上一条、下一条数据。

`requestData` 不会发送 `fetch` 或 Ajax 请求，不适合处理阅读量、访问统计等浏览器副作用。这类请求应使用 `src/scripts/analytics.ts` 中的方法。

### 基本用法

`api` 是 JSON 文件相对于 `src/lib/jsonDatas` 的路径，不需要写 `.json` 扩展名。

```astro
---
import { requestData } from '../lib/utils'

// 读取 src/lib/jsonDatas/news.json，返回原始数组
const allNews = requestData('news')

// 读取 src/lib/jsonDatas/goods/list.json
const allGoods = requestData('goods/list')

// 读取 src/lib/jsonDatas/site.json，返回站点信息对象
const siteInfo = requestData('site')
---
```

`site.json` 这类顶层为对象的 JSON 只能直接读取，不能传入分页或筛选参数。

### 列表和分页

```ts
const result = requestData('news', {
  data_type: 'page',
  page: 1,
  limit: 10,
  category_id: '12',
  sort: 'timeDesc'
})

// result 结构：
// {
//   total: 25,
//   last_page: 3,
//   data: [...]
// }
```

`category_id` 支持单个 ID 或逗号分隔的多个 ID。当 JSON 数据中的 `category_id` 是 `"10,12,15"` 时，传入 `"12"` 也可以筛选到该数据。

```ts
const list = requestData('goods', {
  data_type: 'list',
  category_id: '12',
  list_type: 'alone',
  limit: -1
})
```

`list_type` 可选值：

- `alone`：只匹配当前分类。
- `all`：匹配当前分类及所有子分类。
- `children`：只匹配所有子分类。

### 详情数据

```ts
const detail = requestData('news', {
  data_type: 'show',
  id: '1001',
  sort: 'timeDesc',
  limit: -1
})

// detail 结构：
// {
//   up: 上一条数据或 null,
//   down: 下一条数据或 null,
//   info: 当前详情数据
// }
```

### 搜索和自定义字段筛选

```ts
const result = requestData('news', {
  data_type: 'list',
  search_name: '关键词',
  search_fields: ['title', 'intro'],
  search_to_lowerCase: true,
  isIndex: true,
  limit: -1
})
```

除内置参数外，传入的其他字段会按 JSON 中的同名字段做精确筛选。例如 `isIndex: true` 会筛选出 `isIndex` 为 `true` 的数据；如果字段在数据中不存在，控制台会输出警告。

### 常用参数

| 参数 | 说明 |
| :--- | :--- |
| `data_type` | 返回格式：`page`、`list` 或 `show`，默认为 `page` |
| `page` | 当前页码，默认为 `1` |
| `limit` | 每页数量，默认为 `10`；传 `-1` 时不分页 |
| `category_id` | 分类 ID，支持逗号分隔的多个 ID |
| `column_id` | 栏目 ID |
| `id` | 数据 ID，通常配合 `data_type: 'show'` 使用 |
| `sort` | `sortAsc`、`sortDesc`、`timeAsc` 或 `timeDesc` |
| `type` | 按数据的 `type` 字段筛选 |
| `search_name` | 搜索关键词 |
| `search_fields` | 指定搜索字段，默认只搜索 `title` |
| `exact_search` | 是否精确匹配搜索内容 |
| `search_to_lowerCase` | 是否忽略英文大小写 |
