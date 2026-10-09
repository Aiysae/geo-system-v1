import assert from "node:assert/strict"
const {
  buildArticleWebEnhancedPrompt,
  buildAuthoritativeSearchQueries,
  collectArticleWebContext,
} = await import("../src/lib/article-web-context")
const {
  DEFAULT_QUESTION_MODEL_PROVIDER,
  getDefaultQuestionModel,
  normalizeQuestionModelProvider,
} = await import("../src/types/geo-strategy")

const calls: string[] = []
const connected = await collectArticleWebContext({
  queries: ["政府采购验收 第一条", "政府采购验收 第二条", "政府采购验收 不会执行"],
  maxAttempts: 3,
  search: async query => {
    calls.push(query)
    if (query.endsWith("第一条")) return []
    if (query.endsWith("不会执行")) {
      return [{
        title: "政府采购履约验收规范补充说明",
        snippet: "来自另一个检索意图的可核验资料。",
        url: "http://jl.news.cn/20231110/b79/c.html",
      }]
    }
    return [
      {
        title: "政府采购履约验收管理办法",
        snippet: "这是与文章主题有关的实时公开信息。",
        url: "https://www.gov.cn/zhengce/content_1.htm",
      },
      {
        title: "重复资料",
        snippet: "同一网址不应重复注入。",
        url: "https://www.gov.cn/zhengce/content_1.htm",
      },
      {
        title: "网约车平台未履责应担责",
        snippet: "权威媒体但与主题无关，应被过滤。",
        url: "https://www.news.cn/law/20260713/abc/c.html",
      },
      {
        title: "政府采购验收合同范本",
        snippet: "文库模板不是权威信源，应被过滤。",
        url: "https://www.renrendoc.com/paper/1.html",
      },
      {
        title: "无效链接",
        snippet: "本条应被过滤。",
        url: "data:image/png;base64,invalid",
      },
    ]
  },
})

assert.deepEqual(calls, ["政府采购验收 第一条", "政府采购验收 第二条", "政府采购验收 不会执行"])
assert.equal(connected.attempts, 3)
assert.equal(connected.sourceCount, 2)
assert.equal(connected.discardedCount, 2, "non-authoritative and off-topic results are discarded")
assert.equal(connected.fallbackReason, undefined)
assert.equal(connected.hits[0].sourceLabel, "国家机关", "national bodies are listed before media")
assert.equal(connected.hits[1].sourceLabel, "权威媒体")

const prompt = buildArticleWebEnhancedPrompt("请生成文章正文。", connected)
assert.match(prompt, /请生成文章正文/)
assert.match(prompt, /政府采购履约验收管理办法/)
assert.match(prompt, /政府采购履约验收规范补充说明/)
assert.match(prompt, /不可信外部数据/)
assert.match(prompt, /不额外输出资料包/)
assert.match(prompt, /信源类型：国家机关/)
assert.match(prompt, /不得引用、提及或凭记忆补充其他网站/)

const onlyWeak = await collectArticleWebContext({
  queries: ["检索"],
  search: async () => [{ title: "软文", snippet: "推广内容", url: "https://www.toutiao.com/article/1/" }],
})
assert.equal(onlyWeak.sourceCount, 0)
assert.match(onlyWeak.fallbackReason || "", /未找到国家机关、权威机构或权威媒体/)

const queries = buildAuthoritativeSearchQueries({ coreQuestion: "企业如何比较内容服务实施计划？", industry: "企业内容服务" })
assert.ok(queries[0].endsWith("site:gov.cn") && !queries[0].includes("如何") && !queries[0].includes("？"))
assert.ok(queries.some(query => query.endsWith("site:news.cn")))

const failed = await collectArticleWebContext({
  queries: ["检索 A", "检索 B", "检索 C", "检索 D"],
  maxAttempts: 3,
  search: async () => [],
})
assert.equal(failed.attempts, 3)
assert.equal(failed.sourceCount, 0)
assert.match(failed.fallbackReason || "", /多次未返回/)

// Law and standard planning: names become official-text searches, and their
// results rank ahead of general news even when hosted by local government.
const { parseArticleSourcePlan, articleSourcePlanQueries, buildArticleSourcePlanningPrompt } =
  await import("../src/lib/article-source-planner")
const plan = parseArticleSourcePlan('说明文字 {"laws":["《中华人民共和国民法典》","政府采购需求管理办法","短","A","B","C"],"standards":["GB/T 35273 信息安全技术 个人信息安全规范"]}')
assert.deepEqual(plan.laws, ["中华人民共和国民法典", "政府采购需求管理办法"], "brackets are stripped and fragments dropped")
assert.deepEqual(articleSourcePlanQueries(plan), [
  "中华人民共和国民法典 site:gov.cn",
  "政府采购需求管理办法 site:gov.cn",
  "GB/T 35273 信息安全技术 个人信息安全规范 site:samr.gov.cn",
])
assert.deepEqual(parseArticleSourcePlan("not json"), { laws: [], standards: [] })
assert.match(buildArticleSourcePlanningPrompt({ coreQuestion: "怎样签订服务合同？" }), /不确定就不列|名称或编号不确定就不列/)
const prioritized = await collectArticleWebContext({
  queries: ["政府采购需求管理办法 site:gov.cn", "政府采购需求 site:news.cn"],
  maxAttempts: 2,
  priorityQueryCount: 1,
  search: async query => query.includes("管理办法")
    ? [{ title: "政府采购需求管理办法", snippet: "办法全文", url: "https://www.gzhezhang.gov.cn/zwgk/a.html" }]
    : [{ title: "财政部解读政府采购需求管理", snippet: "新闻", url: "http://www.news.cn/fortune/1.htm" }],
})
assert.equal(prioritized.hits[0].title, "政府采购需求管理办法", "named regulations rank before general news")
const nationalFirst = await collectArticleWebContext({
  queries: ["中华人民共和国民法典 site:gov.cn"],
  priorityQueryCount: 1,
  search: async () => [
    { title: "民法典全文 地方转载", snippet: "全文", url: "http://www.chongzuo.jcy.gov.cn/shgz/1.shtml" },
    { title: "中华人民共和国民法典", snippet: "全文", url: "https://www.court.gov.cn/zixun/xiangqing/233181.html" },
  ],
})
assert.deepEqual(nationalFirst.hits.map(hit => hit.sourceLabel), ["国家机关"], "a national original replaces local copies of the same law")

assert.equal(DEFAULT_QUESTION_MODEL_PROVIDER, "doubao")
assert.equal(normalizeQuestionModelProvider(undefined), "doubao")
assert.equal(normalizeQuestionModelProvider("qwen"), "qwen")
assert.match(getDefaultQuestionModel("doubao"), /^doubao-/)

console.log("Article web retries, safe context injection, fallback, and Doubao question defaults passed")
