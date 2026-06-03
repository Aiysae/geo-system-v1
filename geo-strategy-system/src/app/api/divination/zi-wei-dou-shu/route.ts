import { NextResponse } from "next/server"
import { buildZiWeiSystemPrompt, buildZiWeiUserMessage } from "@/prompts/zi-wei-dou-shu"
import { chatDeepSeek, isDeepSeekConfigured } from "@/lib/llm/deepseek"
import type { ZiWeiInput, ZiWeiResult } from "@/engines/eastern/zi-wei-dou-shu/types"

// 请求体 —— 生产环境排盘由后端 engine 计算，此处接收排盘所需原始参数
interface ZiWeiRequest {
  birthDate: string          // ISO 日期字符串
  birthHour: number          // 公历小时 0-23
  gender: "male" | "female"
  longitude: number          // 出生地经度
  isLeapMonth: boolean
  question?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ZiWeiRequest
    const { birthDate, birthHour, gender, longitude, isLeapMonth, question } = body

    // ----- 1. 参数校验 -----
    if (!birthDate || birthHour == null || !gender || longitude == null) {
      return NextResponse.json(
        { error: "缺少必填参数：birthDate、birthHour、gender、longitude" },
        { status: 400 }
      )
    }

    // ----- 2. 纯代码排盘（TODO: 接入 ZiWeiEngine.calculate()）-----
    // 当前阶段 engine 尚未实现，返回明确提示
    // 实现引擎时替换为：const chart = calculateZiWei(input)
    return NextResponse.json(
      {
        error: "紫微斗数排盘引擎尚未实现",
        hint: "引擎实现位置：src/engines/eastern/zi-wei-dou-shu/engine.ts",
        requiredInput: { birthDate, birthHour, gender, longitude, isLeapMonth },
      },
      { status: 501 }
    )

    // ----- 以下为引擎就绪后的完整链路（取消注释即可启用）-----
    /*
    const input: ZiWeiInput = {
      birthDate: new Date(birthDate),
      birthHour,
      gender,
      longitude,
      isLeapMonth,
    }
    const chart: ZiWeiResult = calculateZiWei(input)

    if (!isDeepSeekConfigured()) {
      return NextResponse.json({
        mode: "calculation-only",
        chart,
        note: "DeepSeek API 未配置，仅返回排盘数据",
      })
    }

    const systemPrompt = buildZiWeiSystemPrompt()
    const userMessage = buildZiWeiUserMessage(chart, question)

    const interpretation = await chatDeepSeek({
      system: systemPrompt,
      user: userMessage,
      temperature: 0.7,
      maxTokens: 4096,
    })

    return NextResponse.json({
      mode: "full",
      chart,
      interpretation,
    })
    */
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[紫微斗数·API]", message)
    return NextResponse.json({ error: `紫微斗数排盘失败：${message}` }, { status: 500 })
  }
}
