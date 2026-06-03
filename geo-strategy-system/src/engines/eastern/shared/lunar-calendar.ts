// 农历/干支/节气 基础工具层
// 生产环境应替换为 lunar-javascript (npm i lunar-javascript) 以获得精确历法数据
// 此处提供骨架接口定义，方便各引擎解耦调用

export interface LunarDate {
  year: number
  month: number          // 农历月 (1-12, 闰月为负)
  day: number
  isLeap: boolean
}

export interface GanZhi {
  tianGan: string        // 天干：甲乙丙丁戊己庚辛壬癸
  diZhi: string          // 地支：子丑寅卯辰巳午未申酉戌亥
}

export interface SolarTermInfo {
  name: string            // 节气名
  date: Date              // 节气交点（精确到分钟）
}

// 天干地支序列表
export const TIAN_GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"]
export const DI_ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"]

// 地支配属相
export const DI_ZHI_ZODIAC: Record<string, string> = {
  "子": "鼠", "丑": "牛", "寅": "虎", "卯": "兔", "辰": "龙", "巳": "蛇",
  "午": "马", "未": "羊", "申": "猴", "酉": "鸡", "戌": "狗", "亥": "猪",
}

// 地支对应农历月份（寅月为正月）
const DI_ZHI_MONTH_MAP = ["寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥", "子", "丑"]

// 地支对应时辰（子时 23:00-01:00）
const DI_ZHI_HOUR_MAP = [
  "子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥",
]

/** 根据公历月份(1-12)获取月地支 */
export function getMonthDiZhi(lunarMonth: number): string {
  const idx = ((lunarMonth - 1) % 12 + 12) % 12
  return DI_ZHI_MONTH_MAP[idx]
}

/** 根据公历小时(0-23)获取时辰地支 */
export function getHourDiZhi(hour: number): string {
  const idx = Math.floor(((hour + 1) % 24) / 2)
  return DI_ZHI_HOUR_MAP[idx]
}

/** 获取地支在列表中的序号 (0-11) */
export function diZhiIndex(diZhi: string): number {
  return DI_ZHI.indexOf(diZhi)
}

/** 获取天干在列表中的序号 (0-9) */
export function tianGanIndex(tianGan: string): number {
  return TIAN_GAN.indexOf(tianGan)
}
