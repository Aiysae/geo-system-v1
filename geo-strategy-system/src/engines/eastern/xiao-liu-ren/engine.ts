import type { XiaoLiuRenPalace, PalaceMeta, XiaoLiuRenInput, XiaoLiuRenResult, DivinationStep } from "./types"
import { DI_ZHI, diZhiIndex } from "../shared/lunar-calendar"

// 六个掌诀宫的完整元数据（断辞取自传统小六壬歌诀）
const PALACES: Record<XiaoLiuRenPalace, PalaceMeta> = {
  "大安": {
    name: "大安", position: 1, wuXing: "木", direction: "东方",
    lucky: "大吉",
    description: "大安事事昌，求谋在东方。失物去不远，宅舍保安康。行人身未动，病者主无妨。将军回田野，仔细好推详。",
  },
  "留连": {
    name: "留连", position: 2, wuXing: "水", direction: "南方",
    lucky: "凶",
    description: "留连事难成，求谋日不明。官事宜迟缓，失物难寻踪。急行无去路，退步保平安。",
  },
  "速喜": {
    name: "速喜", position: 3, wuXing: "火", direction: "南方",
    lucky: "大吉",
    description: "速喜喜来临，求财向南行。失物申午见，官事有吉人。行人立刻至，交易大吉昌。",
  },
  "赤口": {
    name: "赤口", position: 4, wuXing: "金", direction: "西方",
    lucky: "大凶",
    description: "赤口主口舌，官非切要防。失物急去寻，行人有惊慌。鸡犬多作怪，病者出西方。更须防口舌，交易恐遭殃。",
  },
  "小吉": {
    name: "小吉", position: 5, wuXing: "水", direction: "东北方",
    lucky: "吉",
    description: "小吉最吉昌，路上好商量。阳人来报喜，失物在坤方。行人立便至，交易甚是强。凡事皆和合，病者祷上苍。",
  },
  "空亡": {
    name: "空亡", position: 6, wuXing: "土", direction: "北方",
    lucky: "大凶",
    description: "空亡事不长，阴人多主张。求财无利益，行人有灾殃。失物寻不见，官事主刑伤。病人逢暗鬼，祷告求安康。",
  },
}

// 序号 → 掌诀名映射
const POSITION_TO_PALACE: Record<number, XiaoLiuRenPalace> = {
  1: "大安", 2: "留连", 3: "速喜", 4: "赤口", 5: "小吉", 6: "空亡",
}

/**
 * 小六壬排盘核心算法
 *
 * 推算逻辑（传统"寅上起月，月上起日，日上起时"）：
 * 1. 月上起日：从大安（1）起正月，顺数至农历月份，落宫为月宫
 * 2. 日上起时：从月宫起初一，顺数至农历日期，落宫为日宫
 * 3. 时上起时：从日宫起子时，顺数至时辰地支，落宫即为最终掌诀
 */
export function calculateXiaoLiuRen(input: XiaoLiuRenInput): XiaoLiuRenResult {
  const { lunarMonth, lunarDay, hourDiZhi } = input

  const hourIndex = diZhiIndex(hourDiZhi)
  if (hourIndex === -1) {
    throw new Error(`无效的时辰地支: ${hourDiZhi}，有效值: ${DI_ZHI.join("")}`)
  }

  // 上证：从大安(1)起正月，顺数 lunarMonth 位
  const monthEndPos = circularStep(1, lunarMonth)
  const monthStep: DivinationStep = {
    stage: "month", startPosition: 1, counts: lunarMonth, endPosition: monthEndPos,
  }

  // 上证：从月宫起初一，顺数 lunarDay 位
  const dayEndPos = circularStep(monthEndPos, lunarDay)
  const dayStep: DivinationStep = {
    stage: "day", startPosition: monthEndPos, counts: lunarDay, endPosition: dayEndPos,
  }

  // 下证：从日宫起子时，顺数至时辰地支（hourIndex + 1 位，因为子时为第1位）
  const hourCounts = hourIndex + 1
  const hourEndPos = circularStep(dayEndPos, hourCounts)
  const hourStep: DivinationStep = {
    stage: "hour", startPosition: dayEndPos, counts: hourCounts, endPosition: hourEndPos,
  }

  const palace = POSITION_TO_PALACE[hourEndPos]
  return {
    palace,
    palaceMeta: PALACES[palace],
    steps: [monthStep, dayStep, hourStep],
  }
}

/**
 * 从 startPos 开始，顺数 n 步，返回落地宫位序号 (1-6)
 * 小六壬在左手食指、中指、无名指六节上顺时针循环
 */
function circularStep(startPos: number, n: number): number {
  // 第一步落在 startPos 自身，所以实际移动 (n - 1) 步
  const moved = ((startPos - 1) + (n - 1)) % 6
  return moved + 1
}

export { PALACES, POSITION_TO_PALACE }
