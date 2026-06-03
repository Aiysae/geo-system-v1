// 小六壬六个掌诀宫位
export type XiaoLiuRenPalace =
  | "大安"   // 1 - 吉
  | "留连"   // 2 - 凶
  | "速喜"   // 3 - 吉
  | "赤口"   // 4 - 凶
  | "小吉"   // 5 - 吉
  | "空亡"   // 6 - 凶

// 五行属性
export type WuXing = "木" | "火" | "土" | "金" | "水"

// 每个掌诀宫的元数据
export interface PalaceMeta {
  name: XiaoLiuRenPalace
  position: number        // 掌诀序号 1-6
  wuXing: WuXing          // 五行
  direction: string       // 方位
  lucky: string           // 吉凶
  description: string     // 掌诀断辞
}

// 小六壬排盘输入
export interface XiaoLiuRenInput {
  lunarMonth: number      // 农历月 (1-12)
  lunarDay: number        // 农历日 (1-30)
  hourDiZhi: string       // 时辰地支 (子丑寅卯辰巳午未申酉戌亥)
}

// 小六壬排盘结果
export interface XiaoLiuRenResult {
  palace: XiaoLiuRenPalace
  palaceMeta: PalaceMeta
  steps: DivinationStep[] // 推算过程（可解释性）
}

// 推算步骤记录
export interface DivinationStep {
  stage: "month" | "day" | "hour"  // 推算阶段
  startPosition: number            // 起始宫位序号
  counts: number                   // 顺数步数
  endPosition: number              // 落宫序号
}
