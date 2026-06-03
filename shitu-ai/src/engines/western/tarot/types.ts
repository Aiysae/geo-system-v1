// 塔罗牌模块类型定义（占位，后续实现）
// 伪随机洗牌与抽牌，支持多种牌阵

export type SpreadType = "single" | "three-card" | "celtic-cross"

export interface TarotCard {
  id: number
  name: string            // 牌名
  arcana: "major" | "minor"
  suit?: "wands" | "cups" | "swords" | "pentacles"
  reversed: boolean       // 是否逆位
  keywords: string[]      // 关键词
  description: string     // 牌意简述
}

export interface TarotReading {
  spread: SpreadType
  cards: TarotCard[]
  positions: string[]     // 各牌位含义标签
}
