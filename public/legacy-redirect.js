// 旧站 .html 地址的兼容跳转。
// 旧入口（proex.html?id=、news_ex.html?id=、prolist.html?category_id= 等）在迁移后已不存在，
// 搜索引擎收录、用户书签和外部引用仍指向它们，这里按旧参数规则转到新路由，尽量保留原有 query。
(function () {
  var script = document.currentScript;
  var mode = (script && script.getAttribute('data-legacy')) || '';
  var search = window.location.search;
  var params = new URLSearchParams(search);
  var encode = encodeURIComponent;

  // 去掉已用于拼路径的参数，其余原样保留
  function restQuery(dropKeys) {
    var query = new URLSearchParams(search);
    dropKeys.forEach(function (key) { query.delete(key); });
    var text = query.toString();
    return text ? '?' + text : '';
  }

  var id = params.get('id') || '';
  var categoryId = params.get('category_id') || '';
  var page = params.get('page') || '';
  var target = '/';

  if (mode === 'proex') {
    target = id ? '/product/' + encode(id) + '/' + restQuery(['id']) : '/project/';
  } else if (mode === 'news_ex') {
    target = id ? '/news/' + encode(id) + '/' + restQuery(['id']) : '/news/';
  } else if (mode === 'prolist' || mode === 'project') {
    // 新路由的分页是路径形态（/project/{分类}/page/{N}/），旧站是 ?page=N，这里做一次转换
    if (categoryId) {
      var pageSuffix = page && Number(page) > 1 ? 'page/' + encode(page) + '/' : '';
      target = '/project/' + encode(categoryId) + '/' + pageSuffix + restQuery(['category_id', 'page']);
    } else {
      target = '/project/' + restQuery(['page']);
    }
  } else if (mode === 'news') {
    target = '/news/' + restQuery([]);
  } else if (mode === 'tech') {
    // 带 id 时直接进详情（lc_id 作为兜底参数无需保留）；只有遗留 lc_id 时保留参数交给页面脚本解析
    target = id ? '/tech/' + encode(id) + '/' + restQuery(['id', 'lc_id']) : '/tech/' + restQuery([]);
  } else if (mode === 'service') {
    target = id ? '/service/' + encode(id) + '/' + restQuery(['id', 'lc_id']) : '/service/' + restQuery([]);
  } else if (mode === 'search') {
    target = '/search/' + restQuery([]);
  } else if (mode === 'contact' || mode === 'map') {
    target = '/contact/';
  }

  var fallback = document.getElementById('legacy-fallback');
  if (fallback) fallback.setAttribute('href', target);
  window.location.replace(target);
})();
