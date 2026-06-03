// 梅花易数模块类型定义（占位，后续实现）
// 支持时间起卦和物象起卦，输出体用关系

export interface MeiHuaInput {
  mode: "time" | "object"
  upperNumber?: number   // 上卦数（时间起卦则为年月日之和）
  lowerNumber?: number   // 下卦数（时间起卦则为年月日时之和）
  movingYaoNumber?: number // 动爻数
}

export interface TiYongRelation {
  ti: string      // 体卦（代表问卦者自身）
  yong: string    // 用卦（代表所问之事）
  relation: string // 体用生克关系
  analysis: string // 简要分析方向
}

export interface MeiHuaResult {
  upperGua: string
  lowerGua: string
  originalGua: string    // 本卦
  mutualGua: string      // 互卦
  derivedGua: string     // 变卦
  movingYao: number      // 动爻位置
  tiYong: TiYongRelation // 体用关系
}
