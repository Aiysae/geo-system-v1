import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ParagraphChild,
} from "docx"
import { extractQuestionAdvantages, resolveQuestionAdvantage } from "@/lib/geo-strategy/question-advantages"
import { SOURCE_PLATFORM_CATEGORY_LABELS } from "@/lib/source-platform-intelligence"
import type {
  GeoStrategyPlan,
  KeywordItem,
  MediaPlanItem,
  QuestionItem,
} from "@/types/geo-strategy"

export type KeywordStrategyWordVariant = "strategy" | "questions"

export type KeywordStrategyWordInput = {
  plan: GeoStrategyPlan
  questions: QuestionItem[]
  variant: KeywordStrategyWordVariant
  logoData?: Uint8Array
  generatedAt?: Date
}

const FONT = {
  ascii: "Arial",
  hAnsi: "Arial",
  eastAsia: "Microsoft YaHei",
  cs: "Arial",
} as const
const ACCENT = "1677FF"
const CYAN = "00AEEA"
const NAVY = "092A55"
const INK = "172B4D"
const MUTED = "5E718D"
const SOFT_BLUE = "EAF4FF"
const BORDER = "C9DDF2"
const WHITE = "FFFFFF"
const WEBSITE = "https://shitugeo.top"
const COMPANY = "杭州势途数字科技有限公司"

const tableBorders = {
  top: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  bottom: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  left: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  right: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  insideHorizontal: { style: BorderStyle.SINGLE, color: "DCE8F4", size: 3 },
  insideVertical: { style: BorderStyle.SINGLE, color: "DCE8F4", size: 3 },
} as const

function text(value: unknown): string {
  return String(value ?? "").trim()
}

function displayDate(value: Date): string {
  return value.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function safeProjectName(plan: GeoStrategyPlan): string {
  return text(plan.project_name) || text(plan.profile?.brand_or_product) || "GEO 策略"
}

function run(value: unknown, options: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}): TextRun {
  return new TextRun({
    text: text(value),
    font: FONT,
    bold: options.bold,
    color: options.color,
    size: options.size,
    italics: options.italics,
  })
}

function paragraph(value: unknown, options: {
  bold?: boolean
  color?: string
  size?: number
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
  before?: number
  after?: number
  keepNext?: boolean
  shading?: string
} = {}): Paragraph {
  return new Paragraph({
    alignment: options.alignment,
    keepNext: options.keepNext,
    spacing: { before: options.before ?? 0, after: options.after ?? 120, line: 340 },
    shading: options.shading
      ? { type: ShadingType.CLEAR, color: options.shading, fill: options.shading }
      : undefined,
    children: [run(value, options)],
  })
}

function heading(value: string, level: 1 | 2 | 3 = 1): Paragraph {
  return new Paragraph({
    heading: level === 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3,
    keepNext: true,
    spacing: {
      before: level === 1 ? 360 : level === 2 ? 260 : 180,
      after: level === 1 ? 180 : 120,
      line: 320,
    },
    children: [run(value, { bold: true })],
  })
}

function pageBreak(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [new PageBreak()],
  })
}

function note(value: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: SOFT_BLUE, fill: SOFT_BLUE },
    border: { left: { style: BorderStyle.SINGLE, color: CYAN, size: 18, space: 8 } },
    indent: { left: 220, right: 220 },
    spacing: { before: 80, after: 180, line: 340 },
    children: [run(value, { color: INK, size: 21 })],
  })
}

function bullet(value: string, keepNext = false): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    keepNext,
    spacing: { before: 0, after: 80, line: 340 },
    children: [run(value, { color: INK, size: 20 })],
  })
}

function cell(value: unknown, options: { header?: boolean; width?: number; bold?: boolean } = {}): TableCell {
  const header = Boolean(options.header)
  return new TableCell({
    width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: header
      ? { type: ShadingType.CLEAR, color: ACCENT, fill: ACCENT }
      : undefined,
    margins: { top: 105, bottom: 105, left: 125, right: 125 },
    children: [new Paragraph({
      alignment: header ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: 300 },
      children: [run(value, {
        bold: header || options.bold,
        color: header ? WHITE : INK,
        size: header ? 18 : 19,
      })],
    })],
  })
}

function dataTable(headers: string[], rows: unknown[][], widths?: number[]): Table {
  const normalizedRows = rows.length > 0 ? rows : [["暂无数据", ...headers.slice(1).map(() => "-")]]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: tableBorders,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: headers.map((header, index) => cell(header, { header: true, width: widths?.[index] })),
      }),
      ...normalizedRows.map(row => new TableRow({
        cantSplit: true,
        children: headers.map((_, index) => cell(row[index] ?? "", { width: widths?.[index] })),
      })),
    ],
  })
}

function labelValueTable(rows: Array<[string, unknown]>): Table {
  const visible = rows.filter(([, value]) => text(value))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: tableBorders,
    rows: (visible.length > 0 ? visible : [["信息", "暂无数据"]]).map(([label, value]) => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 22, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, color: SOFT_BLUE, fill: SOFT_BLUE },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 110, bottom: 110, left: 130, right: 130 },
          children: [paragraph(label, { bold: true, color: NAVY, after: 0 })],
        }),
        new TableCell({
          width: { size: 78, type: WidthType.PERCENTAGE },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 110, bottom: 110, left: 140, right: 140 },
          children: [paragraph(value, { color: INK, after: 0 })],
        }),
      ],
    })),
  })
}

function imageRun(logoData: Uint8Array, width: number, height: number): ImageRun {
  return new ImageRun({
    type: "png",
    data: logoData,
    transformation: { width, height },
  })
}

function coverChildren(input: KeywordStrategyWordInput): Array<Paragraph | Table> {
  const projectName = safeProjectName(input.plan)
  const generatedAt = input.generatedAt || new Date()
  const reportTitle = input.variant === "strategy" ? "GEO 关键词策略报告" : "GEO 疑问句与优势报告"
  const children: Array<Paragraph | Table> = [
    paragraph("SHITU GEO · STRATEGY REPORT", {
      bold: true,
      color: CYAN,
      size: 20,
      alignment: AlignmentType.CENTER,
      before: 340,
      after: 300,
    }),
  ]
  if (input.logoData) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 260 },
      children: [imageRun(input.logoData, 102, 116)],
    }))
  } else {
    children.push(paragraph("势途 GEO", {
      bold: true,
      color: NAVY,
      size: 38,
      alignment: AlignmentType.CENTER,
      after: 300,
    }))
  }
  children.push(
    paragraph(reportTitle, {
      bold: true,
      color: NAVY,
      size: 58,
      alignment: AlignmentType.CENTER,
      after: 150,
    }),
    paragraph(projectName, {
      bold: true,
      color: ACCENT,
      size: 30,
      alignment: AlignmentType.CENTER,
      after: 440,
    }),
    new Table({
      width: { size: 74, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, color: "B7D8FF", size: 4 },
        bottom: { style: BorderStyle.SINGLE, color: "B7D8FF", size: 4 },
        left: { style: BorderStyle.SINGLE, color: "B7D8FF", size: 4 },
        right: { style: BorderStyle.SINGLE, color: "B7D8FF", size: 4 },
        insideHorizontal: { style: BorderStyle.SINGLE, color: "DCEBFF", size: 3 },
        insideVertical: { style: BorderStyle.NONE, color: WHITE, size: 0 },
      },
      rows: [
        ["报告项目", projectName],
        ["报告类型", input.variant === "strategy" ? "完整策略方案" : `疑问句池 · ${input.questions.length} 条`],
        ["生成日期", displayDate(generatedAt)],
        ["出品方", "势途 GEO 全链路操作工具"],
      ].map(([label, value]) => new TableRow({
        cantSplit: true,
        children: [
          cell(label, { width: 28, bold: true }),
          cell(value, { width: 72 }),
        ],
      })),
    }),
    paragraph("本报告基于系统内已生成并保存的数据整理，适用于项目沟通、执行与复盘。", {
      color: MUTED,
      size: 19,
      alignment: AlignmentType.CENTER,
      before: 360,
      after: 560,
    }),
    paragraph(COMPANY, {
      color: MUTED,
      size: 18,
      alignment: AlignmentType.CENTER,
      after: 60,
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      children: [new ExternalHyperlink({
        link: WEBSITE,
        children: [run("shitugeo.top", { color: ACCENT, size: 18 })],
      })],
    }),
  )
  return children
}

function headerFor(input: KeywordStrategyWordInput): Header {
  const title = input.variant === "strategy" ? "关键词策略报告" : "疑问句与优势报告"
  const leftChildren: ParagraphChild[] = []
  if (input.logoData) leftChildren.push(imageRun(input.logoData, 22, 25))
  leftChildren.push(run(input.logoData ? "  势途 GEO" : "势途 GEO", { bold: true, color: NAVY, size: 18 }))
  return new Header({
    children: [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        bottom: { style: BorderStyle.SINGLE, color: "B9D7F5", size: 5 },
        left: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        right: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        insideHorizontal: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        insideVertical: { style: BorderStyle.NONE, color: WHITE, size: 0 },
      },
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 55, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 50, bottom: 90, left: 0, right: 80 },
            children: [new Paragraph({ spacing: { after: 0 }, children: leftChildren })],
          }),
          new TableCell({
            width: { size: 45, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 50, bottom: 90, left: 80, right: 0 },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 0 },
              children: [run(title, { color: MUTED, size: 18 })],
            })],
          }),
        ],
      })],
    })],
  })
}

function footerFor(): Footer {
  return new Footer({
    children: [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, color: "D5E4F2", size: 4 },
        bottom: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        left: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        right: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        insideHorizontal: { style: BorderStyle.NONE, color: WHITE, size: 0 },
        insideVertical: { style: BorderStyle.NONE, color: WHITE, size: 0 },
      },
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 0, left: 0, right: 80 },
            children: [paragraph("势途 GEO 出品 · shitugeo.top", { color: MUTED, size: 17, after: 0 })],
          }),
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 90, bottom: 0, left: 80, right: 0 },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 0 },
              children: [new TextRun({
                children: ["第 ", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES, " 页"],
                color: MUTED,
                font: FONT,
                size: 17,
              })],
            })],
          }),
        ],
      })],
    })],
  })
}

function keywordRows(items: KeywordItem[]): unknown[][] {
  return items.map(item => [`P${text(item.priority)}`, item.keyword, item.logic])
}

function mediaRows(items: MediaPlanItem[]): unknown[][] {
  return items.map(item => [
    item.platform,
    `${SOURCE_PLATFORM_CATEGORY_LABELS[item.platform_type || "other"]} · ${item.source_origin === "penetration_detected" ? `检测采信 ${item.adoption_rate || 0}%` : "系统建议"}`,
    item.role,
    `${item.keyword_focus}\n标题：${item.sample_title}`,
    item.cadence,
  ])
}

function questionSection(plan: GeoStrategyPlan, questions: QuestionItem[]): Array<Paragraph | Table> {
  if (questions.length === 0) return [heading("疑问句池与优势匹配"), note("当前方案尚未生成疑问句。")]
  const advantages = extractQuestionAdvantages(plan)
  const counts = questions.reduce<Record<string, number>>((result, question) => {
    const category = text(question.category) || "未分类"
    result[category] = (result[category] || 0) + 1
    return result
  }, {})
  return [
    pageBreak(),
    heading("疑问句池与优势匹配"),
    note(`共 ${questions.length} 条疑问句。优势仅在生成完成后独立匹配，不植入疑问句正文。`),
    paragraph(`生成类型：${Object.entries(counts).map(([category, count]) => `${category} ${count} 条`).join("；")}`, {
      color: MUTED,
      size: 19,
      after: 180,
    }),
    dataTable(
      ["#", "疑问句", "匹配优势", "生成类型", "关键词"],
      questions.map((question, index) => [
        index + 1,
        question.question,
        resolveQuestionAdvantage(question, advantages) || "未匹配",
        question.category,
        question.keyword,
      ]),
      [6, 39, 28, 14, 13],
    ),
  ]
}

function strategyChildren(input: KeywordStrategyWordInput): Array<Paragraph | Table> {
  const plan = input.plan
  const children: Array<Paragraph | Table> = [
    heading("策略总览"),
    note(text(plan.summary) || "当前方案暂无策略摘要。"),
  ]

  if (plan.profile) {
    const profile = plan.profile
    children.push(
      heading("客户与项目画像"),
      labelValueTable([
        [profile.subject_type === "person" ? "个人 IP / 人物" : "品牌 / 产品", profile.brand_or_product],
        ["行业", profile.industry],
        ["目标受众", profile.audience],
        ["产品或服务说明", profile.product_description],
        ["商业目标", profile.business_goals],
        ["主要竞品", profile.competitors?.join("、")],
        ["重点地区词", profile.terms?.join("、")],
        ["用户痛点", profile.pain_points?.join("；")],
        ["核心优势", profile.advantages?.join("；")],
        ["当前劣势", profile.weaknesses?.join("；")],
        ["重点场景", profile.scenes?.join("；")],
      ]),
    )
  }

  const strategy = plan.keyword_strategy
  if (strategy) {
    children.push(pageBreak(), heading("关键词策略"))
    const groups: Array<[string, KeywordItem[]]> = [
      ["核心关键词", strategy.core_keywords || []],
      ["痛点 / 优势关键词", strategy.pain_advantage_keywords || []],
      ["劣势转化关键词", strategy.weakness_conversion_keywords || []],
      ["场景需求关键词", strategy.scenario_keywords || []],
    ]
    for (const [title, items] of groups) {
      if (items.length === 0) continue
      children.push(heading(title, 2), dataTable(["优先级", "关键词", "策略逻辑"], keywordRows(items), [14, 28, 58]))
    }
  }

  if (plan.official_site_strategy?.length) {
    children.push(
      pageBreak(),
      heading("官网建设策略"),
      dataTable(
        ["模块", "建设动作", "目标"],
        plan.official_site_strategy.map(item => [item.module, item.action, item.goal]),
        [22, 48, 30],
      ),
    )
  }

  if (plan.third_party_site_strategy?.length) {
    children.push(heading("第三方网站策略"))
    for (const [index, item] of plan.third_party_site_strategy.entries()) {
      children.push(
        heading(`${index + 1}. ${text(item.suggested_name) || text(item.site_type) || "第三方网站"}`, 2),
        labelValueTable([
          ["优先级", item.priority],
          ["网站类型", item.site_type],
          ["定位", item.positioning],
          ["内容栏目", item.content_pillars],
          ["劣势转优势", item.weakness_conversion],
          ["交叉验证作用", item.cross_validation_role],
        ]),
      )
    }
  }

  const snapshot = plan.source_platform_snapshot
  if (snapshot?.platforms?.length) {
    children.push(
      pageBreak(),
      heading("AI 信源平台采信率排名"),
      note(`统计基于 ${snapshot.successful_answer_count} 次成功联网回答、${snapshot.successful_model_count} 个模型与 ${snapshot.total_citation_events} 次引用事件。相同平台被不同模型或问题重复采信会分别计入。`),
      dataTable(
        ["排名", "平台", "类型", "采信率", "命中回答", "引用事件", "模型覆盖"],
        snapshot.platforms.map((platform, index) => [
          index + 1,
          platform.platform,
          SOURCE_PLATFORM_CATEGORY_LABELS[platform.category],
          `${platform.adoption_rate}%`,
          `${platform.answer_hits}/${snapshot.successful_answer_count}`,
          platform.citation_events,
          `${platform.model_keys.length}/${snapshot.successful_model_count}`,
        ]),
        [7, 18, 16, 13, 16, 14, 16],
      ),
    )
  }

  if (plan.media_plan?.length) {
    children.push(
      heading("自媒体发文策略"),
      dataTable(["平台", "类型与依据", "传播角色", "关键词与选题", "节奏"], mediaRows(plan.media_plan), [16, 18, 20, 30, 16]),
    )
  }

  if (plan.authority_media_plan?.length) {
    children.push(
      heading("官媒与权威信源策略"),
      dataTable(["平台", "类型与依据", "传播角色", "关键词与选题", "节奏"], mediaRows(plan.authority_media_plan), [16, 18, 20, 30, 16]),
    )
  }

  children.push(...questionSection(plan, input.questions))

  if (plan.execution_roadmap?.length) {
    children.push(
      heading("执行排期"),
      dataTable(
        ["阶段", "执行重点", "交付物"],
        plan.execution_roadmap.map(item => [item.phase, item.focus, item.deliverable]),
        [20, 48, 32],
      ),
    )
  }

  if (plan.geo_monitoring_plan?.length) {
    children.push(
      heading("GEO 复盘指标"),
      dataTable(
        ["指标", "复盘方法", "阶段目标"],
        plan.geo_monitoring_plan.map(item => [item.metric, item.method, item.target]),
        [24, 46, 30],
      ),
    )
  }

  children.push(
    heading("使用说明"),
    bullet("本报告用于项目策略沟通、内容执行与阶段复盘，策略应结合最新检测结果持续更新。", true),
    bullet("疑问句与优势为独立字段；优势用于内容佐证，不应机械植入疑问句。", true),
    bullet("排名、资质、案例、参数和承诺类信息发布前应再次核验。"),
  )
  return children
}

function questionDocumentChildren(input: KeywordStrategyWordInput): Array<Paragraph | Table> {
  const plan = input.plan
  return [
    heading("文档概览"),
    labelValueTable([
      ["项目名称", safeProjectName(plan)],
      ["品牌 / 产品", plan.profile?.brand_or_product],
      ["行业", plan.profile?.industry],
      ["目标受众", plan.profile?.audience],
      ["疑问句数量", `${input.questions.length} 条`],
      ["可用优势", `${extractQuestionAdvantages(plan).length} 项`],
    ]),
    ...questionSection(plan, input.questions),
    heading("应用提示"),
    bullet("疑问句可用于 AI 搜索渗透率检测、内容选题和问答资产建设。", true),
    bullet("匹配优势应作为回答中的事实佐证使用，不应直接拼接进问题。"),
  ]
}

export function createKeywordStrategyWordDocument(input: KeywordStrategyWordInput): Document {
  const projectName = safeProjectName(input.plan)
  const title = input.variant === "strategy"
    ? `${projectName} GEO 关键词策略报告`
    : `${projectName} GEO 疑问句与优势报告`
  const body = input.variant === "strategy" ? strategyChildren(input) : questionDocumentChildren(input)

  return new Document({
    creator: "势途 GEO 全链路操作工具",
    title,
    description: "势途 GEO 关键词策略专业报告",
    subject: "GEO 关键词策略与内容执行",
    keywords: "GEO, AI 搜索优化, 关键词策略, 疑问句",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21, color: INK },
          paragraph: { spacing: { after: 120, line: 340 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 34, bold: true, color: NAVY },
          paragraph: {
            spacing: { before: 360, after: 180 },
            border: { bottom: { style: BorderStyle.SINGLE, color: ACCENT, size: 10, space: 8 } },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 27, bold: true, color: "0D4F9E" },
          paragraph: { spacing: { before: 260, after: 130 } },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 23, bold: true, color: "155FA8" },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12_240, height: 15_840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1_240, right: 1_440, bottom: 1_240, left: 1_440 },
          },
        },
        children: coverChildren(input),
      },
      {
        properties: {
          page: {
            size: { width: 12_240, height: 15_840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1_300, right: 1_440, bottom: 1_280, left: 1_440, header: 620, footer: 620 },
          },
        },
        headers: { default: headerFor(input) },
        footers: { default: footerFor() },
        children: body,
      },
    ],
  })
}

export async function buildKeywordStrategyWordBlob(input: KeywordStrategyWordInput): Promise<Blob> {
  return Packer.toBlob(createKeywordStrategyWordDocument(input))
}
