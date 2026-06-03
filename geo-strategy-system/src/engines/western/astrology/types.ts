// 西洋占星模块类型定义（占位，后续实现）
// 需要引入瑞士星历表 swisseph 计算行星经度及相位

// Zodiac signs
export type ZodiacSign =
  | "Aries" | "Taurus" | "Gemini" | "Cancer"
  | "Leo" | "Virgo" | "Libra" | "Scorpio"
  | "Sagittarius" | "Capricorn" | "Aquarius" | "Pisces"

export interface PlanetPosition {
  planet: string          // Sun / Moon / Mercury / Venus / Mars / Jupiter / Saturn / Uranus / Neptune / Pluto
  sign: ZodiacSign
  degree: number          // 0 - 29.999
  house: number           // 1 - 12
  retrograde: boolean
}

export interface Aspect {
  planetA: string
  planetB: string
  type: string            // conjunction / sextile / square / trine / opposition
  orb: number             // 容许度
}

export interface NatalChart {
  planets: PlanetPosition[]
  ascendant: ZodiacSign
  midheaven: ZodiacSign
  houses: { number: number; sign: ZodiacSign; degree: number }[]
  aspects: Aspect[]
}
