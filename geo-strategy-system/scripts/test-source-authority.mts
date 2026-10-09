import assert from "node:assert/strict"

const { classifySourceAuthority, findNonAuthoritativeCitations, sourceHosts } =
  await import("../src/lib/source-authority")

const tier = (url: string, title = "") => classifySourceAuthority(url, title)?.tier ?? null

// National bodies versus local government under gov.cn.
assert.equal(tier("https://www.gov.cn/zhengce/zhengceku/202408/content_6966835.htm"), "national")
assert.equal(tier("https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=1"), "national")
assert.equal(tier("http://zcwd.changsha.gov.cn/wjk/202110/t1.html"), "government")
assert.equal(tier("https://www.who.int/news/item/1"), "international")
assert.equal(tier("https://www.caict.ac.cn/kxyj/qwfb/bps/202401/t1.htm"), "institution")
assert.equal(tier("http://jl.news.cn/20231110/b79/c.html"), "media")
assert.equal(tier("https://www.reuters.com/business/article-1"), "media")

// Document mills, portals, self-media, homepages, user sections and advertorials are rejected.
assert.equal(tier("https://www.renrendoc.com/paper/353649067.html"), null)
assert.equal(tier("https://www.toutiao.com/article/7661839321946735138/"), null)
assert.equal(tier("https://b.jd.com/"), null)
assert.equal(tier("https://www.gsxt.gov.cn/index.html"), null, "homepages carry no citable content")
assert.equal(tier("https://blog.people.com.cn/article/1.html"), null)
assert.equal(tier("https://www.bjnews.com.cn/detail/1790739193129893.html", "国内正规语言服务商资质识别与多场景选型参考"), null,
  "advertorials on authoritative media domains are not citable")
assert.equal(tier("https://www.example-gov.cn.evil.com/a.html"), null, "lookalike hosts are not authoritative")

// Article citation check: only authoritative or user-supplied hosts may be linked.
const article = [
  "依据[指导意见](https://www.gov.cn/zhengce/content_1.htm)，",
  "参见[行业软文](https://www.toutiao.com/article/1/)和[官网介绍](https://brand.example.com/about)。",
].join("\n")
assert.deepEqual(findNonAuthoritativeCitations(article, sourceHosts(["brand.example.com"])),
  ["https://www.toutiao.com/article/1/"])
assert.deepEqual(findNonAuthoritativeCitations(article, sourceHosts(["https://brand.example.com", "https://www.toutiao.com/x"])), [])

console.log("source authority classification and citation checks passed")
