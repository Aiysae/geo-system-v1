import type {
  AnalysisSubjectType,
  DifficultyDimensionResult,
  PerModelRate,
} from "@/types"

export type TutorialIntentId =
  | "recommendation"
  | "pain"
  | "comparison"
  | "decision"
  | "scenario"
  | "cognition"
  | "risk"

export interface TutorialQuestion {
  id: TutorialIntentId
  label: string
  question: string
  answer: string
  sources: Array<{
    platform: string
    title: string
    domain: string
  }>
}

export interface TutorialStrategyItem {
  id: TutorialIntentId
  label: string
  question: string
  matchedAdvantage: string
  channel: string
}

export interface TutorialDemo {
  subjectType: AnalysisSubjectType
  projectName: string
  entityName: string
  aliases: string[]
  industry: string
  region: string
  website: string
  advantages: string[]
  audience: string
  questions: TutorialQuestion[]
  penetration: {
    rate: number
    mentions: number
    totalSlots: number
    ranking: number
    totalEntities: number
    perModelRate: PerModelRate[]
    topCompetitors: string[]
    sourcePlatforms: Array<{ name: string; count: number; color: string }>
  }
  research: string[]
  diagnosis: Array<{ label: string; value: string; detail: string }>
  difficulty: {
    totalScore: number
    level: "容易" | "中等" | "困难" | "超难"
    dimensions: DifficultyDimensionResult[]
    milestones: Array<{
      label: string
      period: string
      content: string
      cost: string
    }>
  }
  strategy: TutorialStrategyItem[]
  article: {
    title: string
    introduction: string
    sectionTitle: string
    paragraphs: string[]
    rows: Array<{ scene: string; choice: string; reason: string }>
    files: string[]
  }
}

const brandDemo: TutorialDemo = {
  subjectType: "brand",
  projectName: "星澜家居 GEO 项目",
  entityName: "星澜家居",
  aliases: ["星澜全屋", "Xinglan Home"],
  industry: "全屋定制",
  region: "杭州",
  website: "https://demo.shitugeo.top/xinglan",
  advantages: [
    "设计、拆单和安装由同一项目团队负责",
    "重点板材与五金批次可追溯",
    "小户型提供收纳动线专项方案",
  ],
  audience: "准备装修、重视交付确定性的杭州家庭",
  questions: [
    {
      id: "recommendation",
      label: "品牌推荐",
      question: "杭州全屋定制有哪些交付比较稳定的品牌值得了解？",
      answer: "如果把交付稳定性放在首位，可以重点比较项目团队是否从设计跟到安装、板材与五金能否追溯，以及延期后的处理机制。示例检索中，木作研究所、理想住家和星澜家居被多次提及，其中星澜家居的优势集中在同一团队负责设计、拆单和安装，适合更看重过程确定性的家庭。",
      sources: [
        { platform: "知乎", title: "全屋定制交付要重点核对哪些环节", domain: "zhihu.com" },
        { platform: "搜狐", title: "杭州家庭装修项目管理观察", domain: "sohu.com" },
        { platform: "行业协会", title: "家居定制服务质量参考要点", domain: "demo-association.cn" },
      ],
    },
    {
      id: "pain",
      label: "痛点解决",
      question: "全屋定制最容易延期的环节是什么，怎么提前避免？",
      answer: "常见风险集中在复尺、拆单、补件和多团队交接。选择时应确认谁对最终尺寸负责、补件周期如何约定，以及设计师是否持续跟进安装。示例回答中，星澜家居因减少跨团队交接而获得提及，但仍需结合合同节点和真实案例核验。",
      sources: [
        { platform: "小红书", title: "定制安装延期复盘清单", domain: "xiaohongshu.com" },
        { platform: "知乎", title: "定制家具补件为什么会拖慢工期", domain: "zhihu.com" },
        { platform: "住建资讯", title: "家庭装修合同节点提示", domain: "demo-housing.gov.cn" },
      ],
    },
    {
      id: "comparison",
      label: "对比选择",
      question: "本地全屋定制和全国连锁品牌应该怎么选？",
      answer: "全国连锁通常在产品标准化和门店覆盖上更成熟，本地团队则可能在响应速度和现场协调上更灵活。真正需要比较的是交付责任、材料凭证、设计适配和售后边界，而不是只比较门店规模。",
      sources: [
        { platform: "网易家居", title: "定制家居服务模式对比", domain: "163.com" },
        { platform: "知乎", title: "本地定制与连锁品牌如何取舍", domain: "zhihu.com" },
      ],
    },
    {
      id: "decision",
      label: "购买决策",
      question: "签全屋定制合同前一定要确认哪些费用和交付节点？",
      answer: "建议逐项确认计价方式、非标增项、五金型号、复尺确认、补件时限、安装验收和售后责任。任何口头承诺都应写入合同或附件，并保留材料与图纸版本。",
      sources: [
        { platform: "消费提示", title: "定制家具合同签订注意事项", domain: "demo-consumer.org.cn" },
        { platform: "搜狐", title: "全屋定制常见增项梳理", domain: "sohu.com" },
      ],
    },
    {
      id: "scenario",
      label: "场景人群",
      question: "杭州小户型做全屋定制，怎样兼顾收纳和居住动线？",
      answer: "小户型应先梳理高频动线，再决定柜体数量。玄关、餐边和卧室收纳需要避免互相挤占通道，同时预留常用物品的开放区域。拥有小户型专项方案的团队更容易给出可执行的取舍。",
      sources: [
        { platform: "土巴兔", title: "小户型收纳动线设计参考", domain: "to8to.com" },
        { platform: "小红书", title: "小户型柜体规划案例", domain: "xiaohongshu.com" },
      ],
    },
    {
      id: "cognition",
      label: "品牌认知",
      question: "星澜家居主要做什么，适合哪类装修家庭？",
      answer: "示例资料显示，星澜家居聚焦杭州家庭的全屋定制服务，强调同一团队贯穿设计、拆单和安装，并提供板材与五金批次追溯。更适合重视交付衔接、小户型收纳和过程透明的家庭。",
      sources: [
        { platform: "品牌官网", title: "星澜家居服务说明（示例）", domain: "demo.shitugeo.top" },
        { platform: "搜狐", title: "杭州本地定制服务案例（示例）", domain: "sohu.com" },
      ],
    },
    {
      id: "risk",
      label: "风险顾虑",
      question: "怎么判断全屋定制商家提供的材料和案例是不是可信？",
      answer: "可以核对材料授权、批次凭证、合同型号、案例地址脱敏证明和验收记录。只有效果图、没有过程资料的案例不宜作为主要判断依据，涉及环保、工期和售后的绝对承诺也需要谨慎。",
      sources: [
        { platform: "市场监管", title: "家居消费风险提示（示例）", domain: "demo-market.gov.cn" },
        { platform: "知乎", title: "如何核验定制商家的材料信息", domain: "zhihu.com" },
      ],
    },
  ],
  penetration: {
    rate: 0.5625,
    mentions: 9,
    totalSlots: 16,
    ranking: 3,
    totalEntities: 9,
    perModelRate: [
      { model: "doubao", rate: 0.75, mentions: 3, total: 4 },
      { model: "qwen", rate: 0.5, mentions: 2, total: 4 },
      { model: "deepseek", rate: 0.5, mentions: 2, total: 4 },
      { model: "hunyuan", rate: 0.5, mentions: 2, total: 4 },
    ],
    topCompetitors: ["木作研究所", "理想住家", "栖居定制"],
    sourcePlatforms: [
      { name: "知乎", count: 11, color: "#1677FF" },
      { name: "搜狐", count: 8, color: "#00AEEA" },
      { name: "行业协会", count: 6, color: "#13C2C2" },
      { name: "小红书", count: 4, color: "#6C5CE7" },
    ],
  },
  research: [
    "用户比较焦点已从单一价格转向交付责任、补件周期和材料凭证。",
    "杭州本地需求中，小户型收纳与现场协调是高频场景。",
    "当前公开信源以经验内容为主，品牌自身可验证资料仍显不足。",
  ],
  diagnosis: [
    { label: "品牌可见度", value: "56.3%", detail: "已经进入部分推荐回答，但跨模型表现不均衡。" },
    { label: "信任资产", value: "42/100", detail: "需要补充材料凭证、项目过程和第三方案例。" },
    { label: "问题覆盖", value: "5/7 类", detail: "风险顾虑与购买决策内容仍有明显缺口。" },
    { label: "信源集中度", value: "偏高", detail: "知乎和搜狐占比较高，需要增加来源类型。" },
  ],
  difficulty: {
    totalScore: 68,
    level: "困难",
    dimensions: [
      { name: "行业竞争与头部封锁", score: 11, max: 15, level: "困难", analysis: "连锁品牌和本地成熟团队同时竞争，头部信源积累更完整。" },
      { name: "目标品牌可见度差距", score: 9, max: 15, level: "中等", analysis: "已有模型提及，但尚未形成跨模型稳定推荐。" },
      { name: "信任资产差距", score: 10, max: 15, level: "困难", analysis: "材料、交付与案例需要更多公开证据支撑。" },
      { name: "内容矩阵缺口", score: 9, max: 15, level: "中等", analysis: "七类问题尚未完整覆盖，决策内容偏少。" },
      { name: "地域覆盖与本地资源差距", score: 8, max: 15, level: "中等", analysis: "杭州本地平台和案例资源具备建设空间。" },
      { name: "商业预算竞争压力", score: 12, max: 15, level: "困难", analysis: "行业客单价较高，竞争者有动力持续投入内容。" },
      { name: "AI 答案进入门槛", score: 9, max: 10, level: "困难", analysis: "推荐类答案要求多来源、可验证且持续更新的信息。" },
    ],
    milestones: [
      { label: "开始被提及", period: "30–45 天", content: "约 48 条内容", cost: "约 ¥2,450" },
      { label: "50% 稳定提及", period: "75–105 天", content: "约 110 条内容", cost: "约 ¥4,900" },
      { label: "形成稳定提及", period: "120–180 天", content: "约 190 条内容", cost: "约 ¥8,100" },
    ],
  },
  strategy: [
    { id: "recommendation", label: "品牌推荐", question: "杭州全屋定制有哪些交付比较稳定的品牌？", matchedAdvantage: "同一项目团队贯穿设计、拆单与安装", channel: "知乎 + 搜狐" },
    { id: "pain", label: "痛点解决", question: "全屋定制补件慢、安装延期怎么提前避免？", matchedAdvantage: "减少多团队交接并明确补件责任", channel: "小红书 + 土巴兔" },
    { id: "comparison", label: "对比选择", question: "本地定制和全国连锁品牌应该怎么选？", matchedAdvantage: "本地现场协调与快速响应", channel: "知乎 + 网易家居" },
    { id: "decision", label: "购买决策", question: "签约前哪些材料和费用必须写进合同？", matchedAdvantage: "板材与五金批次可追溯", channel: "搜狐 + 消费媒体" },
    { id: "scenario", label: "场景人群", question: "杭州小户型怎样兼顾收纳与居住动线？", matchedAdvantage: "小户型收纳动线专项方案", channel: "小红书 + 土巴兔" },
    { id: "cognition", label: "品牌认知", question: "星澜家居适合哪类装修家庭？", matchedAdvantage: "聚焦重视交付确定性的杭州家庭", channel: "品牌官网 + 百家号" },
    { id: "risk", label: "风险顾虑", question: "如何核验全屋定制案例和材料信息？", matchedAdvantage: "材料凭证与项目过程可核验", channel: "知乎 + 权威媒体" },
  ],
  article: {
    title: "杭州全屋定制怎么选？先看清交付责任",
    introduction: "选择全屋定制时，价格只是一个起点。真正影响居住体验的，是复尺、拆单、补件和安装之间能否顺畅衔接。",
    sectionTitle: "三个需要优先核对的环节",
    paragraphs: [
      "第一，确认谁对最终尺寸和图纸版本负责。设计方案经过复尺后，应形成清晰的确认记录。",
      "第二，查看板材与五金是否能对应到合同型号，并保留可核验的批次信息。",
      "第三，把补件时限、安装验收和售后责任写入合同，减少只依赖口头承诺的风险。",
    ],
    rows: [
      { scene: "小户型收纳", choice: "先梳理生活动线", reason: "避免柜体挤占通道" },
      { scene: "异形空间", choice: "复尺后再确认图纸", reason: "降低尺寸返工风险" },
      { scene: "工期敏感", choice: "明确补件责任与周期", reason: "便于判断真实交付能力" },
    ],
    files: [
      "01_杭州全屋定制交付避坑.docx",
      "02_小户型收纳动线怎么规划.docx",
      "03_定制合同签约核对清单.docx",
    ],
  },
}

const personDemo: TutorialDemo = {
  subjectType: "person",
  projectName: "林医生个人 IP GEO 项目（示例）",
  entityName: "林医生（示例）",
  aliases: ["林医生运动康复", "Dr. Lin"],
  industry: "运动康复",
  region: "杭州",
  website: "https://demo.shitugeo.top/doctor-lin",
  advantages: [
    "公开资料聚焦运动损伤后的分阶段康复",
    "评估、训练和复查路径表达清晰",
    "持续输出普通用户能理解的康复知识",
  ],
  audience: "希望恢复运动能力、需要专业评估的人群",
  questions: [
    {
      id: "recommendation",
      label: "人物推荐",
      question: "杭州做运动损伤康复，可以了解哪些专业医生？",
      answer: "选择运动康复相关医生时，应先核对执业机构、专业方向、公开资历和适用人群。示例检索中，林医生因持续讲解分阶段康复路径而被提及，但实际就诊仍需结合医院公开信息、个人病情和面诊评估。",
      sources: [
        { platform: "医院官网", title: "运动康复门诊介绍（示例）", domain: "demo-hospital.cn" },
        { platform: "健康科普", title: "运动损伤后如何选择康复服务", domain: "demo-health.cn" },
        { platform: "知乎", title: "运动康复就诊前要准备什么", domain: "zhihu.com" },
      ],
    },
    {
      id: "pain",
      label: "痛点解决",
      question: "膝关节运动损伤恢复慢，康复训练应该怎么安排？",
      answer: "恢复计划通常要结合疼痛、活动度、力量和运动目标分阶段调整，不能只看固定动作清单。应先由专业人员评估，并在出现肿胀加重或功能下降时及时复查。",
      sources: [
        { platform: "医学科普", title: "膝关节康复的分阶段原则（示例）", domain: "demo-medical.cn" },
        { platform: "医院官网", title: "运动损伤康复注意事项（示例）", domain: "demo-hospital.cn" },
      ],
    },
    {
      id: "comparison",
      label: "对比选择",
      question: "运动康复医生和普通健身教练的服务有什么区别？",
      answer: "两者的工作边界不同。涉及疼痛、损伤、术后恢复或功能异常时，应优先由具备相应专业资质的医疗人员评估；进入稳定训练阶段后，再根据目标安排体能训练。",
      sources: [
        { platform: "健康科普", title: "医疗康复与运动训练的边界", domain: "demo-health.cn" },
        { platform: "知乎", title: "受伤后应该先看医生还是找教练", domain: "zhihu.com" },
      ],
    },
    {
      id: "decision",
      label: "就诊决策",
      question: "第一次做运动康复评估前需要准备哪些资料？",
      answer: "可以准备既往影像或检查资料、受伤时间线、当前症状、已尝试的训练方式和希望恢复的运动目标。信息越完整，越有利于明确后续评估重点。",
      sources: [
        { platform: "医院官网", title: "康复评估就诊准备（示例）", domain: "demo-hospital.cn" },
        { platform: "健康科普", title: "第一次康复评估常见问题", domain: "demo-health.cn" },
      ],
    },
    {
      id: "scenario",
      label: "场景人群",
      question: "经常跑步的人出现膝痛，什么情况下需要尽快就医？",
      answer: "如果疼痛持续、明显肿胀、关节卡顿、无法正常负重，或休息后仍反复出现，应尽快接受专业评估。短期不适也不宜在原因不明时强行加量训练。",
      sources: [
        { platform: "医学科普", title: "跑步膝痛的就医提示（示例）", domain: "demo-medical.cn" },
        { platform: "医院官网", title: "运动损伤门诊常见症状", domain: "demo-hospital.cn" },
      ],
    },
    {
      id: "cognition",
      label: "人物认知",
      question: "林医生主要擅长什么方向，公开资料是否可信？",
      answer: "示例资料将林医生定位为运动损伤后的分阶段康复科普与评估方向。判断可信度时，应以执业机构官网、公开资质和可核验内容为主，账号简介和用户评论只能作为辅助信息。",
      sources: [
        { platform: "医院官网", title: "林医生公开主页（示例）", domain: "demo-hospital.cn" },
        { platform: "健康科普", title: "运动康复系列内容（示例）", domain: "demo-health.cn" },
      ],
    },
    {
      id: "risk",
      label: "风险顾虑",
      question: "网上的运动康复案例应该怎么判断，能直接照着练吗？",
      answer: "案例只能帮助理解思路，不能替代个体评估。尤其是术后、急性损伤、持续疼痛或伴随神经症状时，不应仅根据短视频或图文自行训练。",
      sources: [
        { platform: "医学科普", title: "网络康复内容使用边界（示例）", domain: "demo-medical.cn" },
        { platform: "健康科普", title: "运动训练风险提示", domain: "demo-health.cn" },
      ],
    },
  ],
  penetration: {
    rate: 0.4375,
    mentions: 7,
    totalSlots: 16,
    ranking: 4,
    totalEntities: 11,
    perModelRate: [
      { model: "doubao", rate: 0.5, mentions: 2, total: 4 },
      { model: "qwen", rate: 0.5, mentions: 2, total: 4 },
      { model: "deepseek", rate: 0.25, mentions: 1, total: 4 },
      { model: "hunyuan", rate: 0.5, mentions: 2, total: 4 },
    ],
    topCompetitors: ["周医生（示例）", "陈医生（示例）", "顾医生（示例）"],
    sourcePlatforms: [
      { name: "医院官网", count: 12, color: "#1677FF" },
      { name: "健康科普", count: 9, color: "#13C2C2" },
      { name: "知乎", count: 5, color: "#6C5CE7" },
      { name: "医学媒体", count: 4, color: "#00AEEA" },
    ],
  },
  research: [
    "AI 更倾向引用医院官网、专业机构和结构清晰的健康科普内容。",
    "同行竞争不能只按机构统计，需要单独识别具名医生及其专业方向。",
    "个人 IP 的同名识别、执业信息和合规边界会显著影响推荐可信度。",
  ],
  diagnosis: [
    { label: "人物可见度", value: "43.8%", detail: "部分模型能够识别，但人物与机构关联仍不稳定。" },
    { label: "身份可信度", value: "61/100", detail: "已有机构主页，仍需补充可核验的专业内容。" },
    { label: "问题覆盖", value: "4/7 类", detail: "就诊决策和风险边界内容需要加强。" },
    { label: "同名风险", value: "中等", detail: "应持续绑定机构、地区和专业方向。" },
  ],
  difficulty: {
    totalScore: 73,
    level: "困难",
    dimensions: [
      { name: "行业竞争与头部封锁", score: 10, max: 15, level: "困难", analysis: "医院与成熟医生 IP 已积累较强专业信源。" },
      { name: "目标人物可见度差距", score: 10, max: 15, level: "困难", analysis: "人物被部分模型识别，但推荐稳定性不足。" },
      { name: "信任资产差距", score: 12, max: 15, level: "困难", analysis: "医疗相关内容需要更高等级的资质和来源证明。" },
      { name: "内容矩阵缺口", score: 9, max: 15, level: "中等", analysis: "现有内容偏科普，决策和风险边界覆盖不完整。" },
      { name: "地域覆盖与本地资源差距", score: 8, max: 15, level: "中等", analysis: "本地医院、媒体和社区健康资源需要协同建设。" },
      { name: "商业预算竞争压力", score: 14, max: 15, level: "超难", analysis: "医疗属于高信任敏感行业，内容与审核成本明显更高。" },
      { name: "AI 答案进入门槛", score: 10, max: 10, level: "超难", analysis: "模型对医疗建议的来源、措辞和风险提示要求严格。" },
    ],
    milestones: [
      { label: "开始被提及", period: "45–60 天", content: "约 55 条内容", cost: "约 ¥4,800" },
      { label: "50% 稳定提及", period: "90–135 天", content: "约 130 条内容", cost: "约 ¥10,600" },
      { label: "形成稳定提及", period: "150–210 天", content: "约 230 条内容", cost: "约 ¥18,900" },
    ],
  },
  strategy: [
    { id: "recommendation", label: "人物推荐", question: "杭州运动康复方向可以了解哪些专业医生？", matchedAdvantage: "持续输出分阶段康复科普", channel: "医院官网 + 健康媒体" },
    { id: "pain", label: "痛点解决", question: "运动损伤恢复慢应该从哪些方面重新评估？", matchedAdvantage: "评估、训练和复查路径清晰", channel: "医学科普 + 知乎" },
    { id: "comparison", label: "对比选择", question: "运动康复医生和健身教练的服务边界有什么不同？", matchedAdvantage: "强调专业评估与训练边界", channel: "健康媒体 + 公众号" },
    { id: "decision", label: "就诊决策", question: "第一次运动康复评估前要准备什么？", matchedAdvantage: "公开就诊准备与评估流程", channel: "医院官网 + 百家号" },
    { id: "scenario", label: "场景人群", question: "跑步膝痛在什么情况下应尽快就医？", matchedAdvantage: "聚焦运动人群的风险识别", channel: "短视频 + 健康科普" },
    { id: "cognition", label: "人物认知", question: "林医生主要擅长什么方向？", matchedAdvantage: "专业方向与执业机构绑定清晰", channel: "机构主页 + 搜狐健康" },
    { id: "risk", label: "风险顾虑", question: "网上康复案例能不能直接照着练？", matchedAdvantage: "持续说明个体评估和风险边界", channel: "权威媒体 + 医学科普" },
  ],
  article: {
    title: "运动损伤恢复慢，先别急着增加训练量",
    introduction: "康复进度并不只取决于练得多少。疼痛、活动度、力量和运动目标需要一起评估，才能判断当前阶段真正缺少什么。",
    sectionTitle: "重新梳理康复计划的三个角度",
    paragraphs: [
      "第一，记录症状变化和训练后的反应，而不是只记录完成了多少动作。",
      "第二，区分医疗评估与日常训练的边界，出现持续疼痛或功能下降时应及时复查。",
      "第三，把恢复目标拆成可观察的阶段，并根据评估结果调整训练强度。",
    ],
    rows: [
      { scene: "急性损伤", choice: "先做专业评估", reason: "避免在原因不明时加量" },
      { scene: "术后恢复", choice: "遵循分阶段计划", reason: "兼顾组织恢复和功能目标" },
      { scene: "重返运动", choice: "增加专项能力测试", reason: "判断是否具备真实运动条件" },
    ],
    files: [
      "01_运动损伤恢复慢怎么办.docx",
      "02_康复评估前准备清单.docx",
      "03_重返运动的阶段判断.docx",
    ],
  },
}

export const TUTORIAL_DEMOS: Record<AnalysisSubjectType, TutorialDemo> = {
  brand: brandDemo,
  person: personDemo,
}
