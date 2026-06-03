// 紫微斗数模块类型定义（占位，后续实现）
// 核心难点：真太阳时校准、农历转换、安星诀算法
// 输出十二宫 + 主星/辅星/四化的完整 JSON

export interface ZiWeiInput {
  birthDate: Date
  birthHour: number       // 公历小时 0-23
  gender: "male" | "female"
  longitude: number       // 出生地经度（用于真太阳时校准）
  isLeapMonth: boolean    // 是否为农历闰月
}

export interface Palace {
  name: string            // 命宫/兄弟/夫妻/子女/财帛/疾厄/迁移/交友/官禄/田宅/福德/父母
  diZhi: string           // 地支宫位
  daXianAge: number       // 大限起始年龄
  majorStars: string[]    // 主星
  minorStars: string[]    // 辅星
  siHua: string[]         // 四化（化禄/化权/化科/化忌）
}

export interface ZiWeiResult {
  mingGong: string        // 命宫地支
  shenGong: string        // 身宫地支
  wuXingJu: string        // 五行局
  palaces: Palace[]       // 十二宫完整排盘
  siHuaStars: {           // 四化分布
    huaLu: string
    huaQuan: string
    huaKe: string
    huaJi: string
  }
}
