// 八卦模块类型定义（占位，后续实现）
// 起卦逻辑：基于时间或随机数，输出本卦、变卦、互卦

export type BaGuaName =
  | "乾" | "坤" | "震" | "巽"
  | "坎" | "离" | "艮" | "兑"

export interface YaoLine {
  position: number    // 1-6，初爻到上爻
  type: "阳" | "阴"
  changing: boolean   // 是否为动爻
}

export interface Gua {
  name: BaGuaName
  element: string     // 五行
  nature: string      // 卦德
  yaoLines: YaoLine[]
}

export interface BaGuaResult {
  originalGua: Gua    // 本卦
  changingYao: number[] // 动爻位置
  mutualGua: Gua      // 互卦
  derivedGua: Gua     // 变卦（之卦）
}
