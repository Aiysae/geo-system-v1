import "server-only"

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  LevelFormat,
  Packer,
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
} from "docx"

export type MaterialTemplateSubjectType = "brand" | "person"

const FONT = {
  ascii: "Arial",
  hAnsi: "Arial",
  eastAsia: "Microsoft YaHei",
  cs: "Arial",
} as const
const CONTENT_WIDTH = 9_360
const LABEL_WIDTH = 2_700
const VALUE_WIDTH = CONTENT_WIDTH - LABEL_WIDTH
const ACCENT = "1677FF"
const INK = "0B2545"
const MUTED = "64748B"
const LIGHT_BLUE = "EAF4FF"
const BORDER = "C9DDF2"

type Field = {
  label: string
  prompt: string
  tall?: boolean
}

const tableBorders = {
  top: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  bottom: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  left: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  right: { style: BorderStyle.SINGLE, color: BORDER, size: 4 },
  insideHorizontal: { style: BorderStyle.SINGLE, color: "DCE8F4", size: 3 },
  insideVertical: { style: BorderStyle.SINGLE, color: "DCE8F4", size: 3 },
} as const

function heading(text: string, pageBreakBefore = false): Paragraph {
  return new Paragraph({
    style: "TemplateHeading1",
    pageBreakBefore,
    keepNext: true,
    children: [new TextRun({ text, font: FONT })],
  })
}

function fieldTable(fields: Field[]): Table {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [LABEL_WIDTH, VALUE_WIDTH],
    borders: tableBorders,
    rows: fields.map(field => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: LABEL_WIDTH, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          shading: { type: ShadingType.CLEAR, color: LIGHT_BLUE, fill: LIGHT_BLUE },
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0, line: 280 },
            children: [new TextRun({ text: field.label, bold: true, color: INK, font: FONT, size: 20 })],
          })],
        }),
        new TableCell({
          width: { size: VALUE_WIDTH, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 120, bottom: field.tall ? 320 : 120, left: 160, right: 160 },
          children: [new Paragraph({
            spacing: { before: 0, after: 0, line: 300 },
            children: [new TextRun({ text: field.prompt, color: MUTED, font: FONT, size: 20, italics: true })],
          })],
        }),
      ],
    })),
  })
}

function evidenceTable(subjectType: MaterialTemplateSubjectType): Table {
  const firstLabel = subjectType === "person" ? "专业优势 / 可信特征" : "核心优势 / 卖点"
  const widths = [1_900, 4_100, 3_360]
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [firstLabel, "事实佐证", "公开来源网址"].map((text, index) => new TableCell({
      width: { size: widths[index], type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      shading: { type: ShadingType.CLEAR, color: ACCENT, fill: ACCENT },
      margins: { top: 120, bottom: 120, left: 120, right: 120 },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0, line: 280 },
        children: [new TextRun({ text, bold: true, color: "FFFFFF", font: FONT, size: 19 })],
      })],
    })),
  })
  const rows = Array.from({ length: 5 }, (_, index) => new TableRow({
    cantSplit: true,
    children: [
      `第 ${index + 1} 项：请填写`,
      "填写参数、资质、案例、用户反馈或其他可核验依据",
      "填写官网、媒体报道、证书公示或案例链接；没有则留空",
    ].map((text, column) => new TableCell({
      width: { size: widths[column], type: WidthType.DXA },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 130, bottom: 220, left: 130, right: 130 },
      children: [new Paragraph({
        spacing: { before: 0, after: 0, line: 300 },
        children: [new TextRun({ text, color: MUTED, font: FONT, size: 19, italics: true })],
      })],
    })),
  }))
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    borders: tableBorders,
    rows: [header, ...rows],
  })
}

function note(text: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.CLEAR, color: LIGHT_BLUE, fill: LIGHT_BLUE },
    border: { left: { style: BorderStyle.SINGLE, color: ACCENT, size: 18, space: 8 } },
    indent: { left: 220, right: 220 },
    spacing: { before: 100, after: 180, line: 300 },
    children: [new TextRun({ text, color: INK, font: FONT, size: 21 })],
  })
}

function numbered(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "template-instructions", level: 0 },
    spacing: { before: 0, after: 80, line: 300 },
    children: [new TextRun({ text, color: "334155", font: FONT, size: 21 })],
  })
}

function brandBody(): Array<Paragraph | Table> {
  return [
    heading("1. 品牌与项目基础信息"),
    fieldTable([
      { label: "品牌 / 产品名称", prompt: "请填写正式名称，以及常用简称" },
      { label: "品牌别名", prompt: "填写中文、英文、旧称、产品系列名等；没有则留空" },
      { label: "公司主体", prompt: "填写公司全称、成立年份及总部地区" },
      { label: "行业与细分品类", prompt: "填写所属行业、具体品类和主要业务范围" },
      { label: "官网与官方账号", prompt: "每行填写一个可公开访问的网址或官方账号主页", tall: true },
      { label: "重点服务区域", prompt: "填写全国、省、市或具体商圈" },
    ]),
    heading("2. 产品、服务与目标人群"),
    fieldTable([
      { label: "主营产品 / 服务", prompt: "按重要顺序填写名称、用途和适用场景", tall: true },
      { label: "核心目标客户", prompt: "填写决策者、使用者、年龄、职业、企业规模等" },
      { label: "典型痛点", prompt: "每行一个真实痛点，优先写用户会主动搜索的问题", tall: true },
      { label: "购买 / 使用场景", prompt: "填写触发需求的时间、地点、情境和任务" },
      { label: "价格或服务边界", prompt: "只填可公开信息；不确定或不可公开则留空" },
    ]),
    heading("3. 核心优势与可验证证据"),
    note("每一项优势都尽量附上事实依据。不要填写无法核验的排名、承诺、案例或数据。"),
    evidenceTable("brand"),
    heading("4. 竞品、信任资产与案例"),
    fieldTable([
      { label: "主要竞品 / 替代方案", prompt: "每行一个，填写品牌名称及其常用别名", tall: true },
      { label: "资质与认证", prompt: "填写证书、专利、标准、奖项及可核验链接" },
      { label: "客户案例", prompt: "填写客户类型、场景、过程和可公开结果；不得虚构", tall: true },
      { label: "媒体与第三方背书", prompt: "填写报道标题、发布平台和文章网址", tall: true },
    ]),
    heading("5. GEO 目标与内容边界", true),
    fieldTable([
      { label: "希望覆盖的问题", prompt: "每行填写一个希望 AI 搜索能回答的用户问题", tall: true },
      { label: "重点关键词", prompt: "每行一个关键词，可包含地区词和场景词" },
      { label: "阶段目标", prompt: "填写希望提升提及、推荐、信源引用或品牌认知的目标" },
      { label: "禁止或敏感表述", prompt: "填写不能公开、不能承诺、容易误解或需审核的内容", tall: true },
      { label: "补充说明", prompt: "填写其他有助于理解品牌的信息；没有则留空", tall: true },
    ]),
  ]
}

function personBody(): Array<Paragraph | Table> {
  return [
    heading("1. 人物与职业基础信息"),
    fieldTable([
      { label: "姓名 / 个人 IP 名称", prompt: "填写真实姓名、公开使用的称呼" },
      { label: "姓名别名", prompt: "填写英文名、曾用名、账号昵称；注意区分同名人物" },
      { label: "职业与专业方向", prompt: "例如：医生、律师、设计师；继续写明细分领域" },
      { label: "职称 / 职务", prompt: "只填写可公开核验的职称、职位或社会身份" },
      { label: "所属机构", prompt: "填写医院、律所、公司、学校或工作室；机构不作为同行人物" },
      { label: "服务地区", prompt: "填写执业地、服务城市或可覆盖区域" },
      { label: "官方主页", prompt: "每行填写一个个人官网、机构主页或已认证账号网址", tall: true },
    ]),
    heading("2. 专业服务、受众与场景"),
    fieldTable([
      { label: "专业服务 / 擅长领域", prompt: "按重要顺序填写，不要加入未提供的能力" },
      { label: "目标人群", prompt: "填写主要服务对象和决策人" },
      { label: "用户痛点", prompt: "每行一个用户会主动搜索的问题或顾虑", tall: true },
      { label: "典型服务场景", prompt: "填写需求发生的情境、阶段和地域" },
      { label: "服务边界", prompt: "填写不提供的服务、适用限制及需面诊/咨询确认的事项" },
    ]),
    heading("3. 专业优势与可验证证据"),
    note("个人 IP 容易出现同名串人。每项履历、资质、案例和数据都应附可核验来源，无法确认的内容请留空。"),
    evidenceTable("person"),
    heading("4. 同行人物、资质与案例"),
    fieldTable([
      { label: "主要同行人物", prompt: "每行一个具名人物，并填写其常用别名；不要填写机构名称", tall: true },
      { label: "教育 / 执业经历", prompt: "填写时间、机构、身份及公开来源" },
      { label: "资质与认证", prompt: "填写执业证书、专业认证、奖项及公示网址" },
      { label: "公开案例", prompt: "填写可公开的场景、过程和结果；医疗、法律等敏感信息需脱敏", tall: true },
      { label: "媒体 / 学术 / 社会背书", prompt: "填写文章、论文、采访、协会任职及网址", tall: true },
    ]),
    heading("5. GEO 目标与内容边界", true),
    fieldTable([
      { label: "希望覆盖的问题", prompt: "每行填写一个希望 AI 搜索能回答的用户问题", tall: true },
      { label: "重点关键词", prompt: "每行一个姓名词、专业词、地区词或场景词" },
      { label: "阶段目标", prompt: "填写希望提升人物提及、专业认知、推荐或信源引用的目标" },
      { label: "禁止或敏感表述", prompt: "填写不能公开、不能承诺、需合规审核或易与同名者混淆的内容", tall: true },
      { label: "补充说明", prompt: "填写其他有助于准确识别人物的信息；没有则留空", tall: true },
    ]),
  ]
}

export function materialTemplateFileName(subjectType: MaterialTemplateSubjectType): string {
  return subjectType === "person" ? "个人IP资料填写模板.docx" : "品牌资料填写模板.docx"
}

export async function buildMaterialTemplateDocx(
  subjectType: MaterialTemplateSubjectType,
): Promise<Buffer> {
  const isPerson = subjectType === "person"
  const title = isPerson ? "个人 IP 资料填写模板" : "品牌资料填写模板"
  const document = new Document({
    creator: "势途 GEO",
    title,
    description: "用于关键词策略资料整理与 GEO 分析",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, color: "1F2937" },
          paragraph: { spacing: { before: 0, after: 120, line: 300 } },
        },
      },
      paragraphStyles: [
        {
          id: "TemplateTitle",
          name: "Template Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 48, bold: true, color: INK },
          paragraph: { spacing: { before: 0, after: 100, line: 300 } },
        },
        {
          id: "TemplateSubtitle",
          name: "Template Subtitle",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 24, color: MUTED },
          paragraph: { spacing: { before: 0, after: 260, line: 300 } },
        },
        {
          id: "TemplateHeading1",
          name: "Template Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: FONT, size: 32, bold: true, color: ACCENT },
          paragraph: { spacing: { before: 360, after: 200, line: 300 }, keepNext: true },
        },
      ],
    },
    numbering: {
      config: [{
        reference: "template-instructions",
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: 540, hanging: 270 }, spacing: { after: 80, line: 300 } },
            run: { font: FONT, color: INK, size: 21 },
          },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12_240, height: 15_840, orientation: PageOrientation.PORTRAIT },
          margin: { top: 1_440, right: 1_440, bottom: 1_440, left: 1_440, header: 708, footer: 708 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: "势途 GEO · 客户资料模板", color: MUTED, font: FONT, size: 18 })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ children: ["第 ", PageNumber.CURRENT, " 页"], color: MUTED, font: FONT, size: 18 })],
          })],
        }),
      },
      children: [
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [new TextRun({ text: "GEO MATERIAL BRIEF", bold: true, color: "00AEEA", font: FONT, size: 19 })],
        }),
        new Paragraph({ style: "TemplateTitle", children: [new TextRun({ text: title, font: FONT })] }),
        new Paragraph({
          style: "TemplateSubtitle",
          children: [new TextRun({
            text: isPerson ? "用于准确识别人物、同行与可信资历" : "用于整理品牌、产品、证据与竞争信息",
            font: FONT,
          })],
        }),
        note("填写完成后，可将本 Word 文件直接上传到“关键词策略 - 上传资料”。不确定的信息请留空，不要猜测或编造。"),
        heading("填写说明"),
        numbered("请直接替换表格中的灰色提示文字；没有的信息可以留空。"),
        numbered("案例、数据、资质、排名和承诺应附公开来源网址，无法核验的内容不要填写。"),
        numbered(isPerson ? "个人 IP 请重点区分同名人物，机构名称不要填入“同行人物”。" : "品牌请补充中英文名、旧称和产品系列名，便于合并同一主体。"),
        ...(isPerson ? personBody() : brandBody()),
      ],
    }],
  })
  return Buffer.from(await Packer.toBuffer(document))
}
