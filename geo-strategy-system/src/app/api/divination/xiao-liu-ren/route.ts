import { NextResponse } from "next/server"
import { calculateXiaoLiuRen } from "@/engines/eastern/xiao-liu-ren/engine"
import { buildXiaoLiuRenPrompt } from "@/prompts/xiao-liu-ren"
import { getHourDiZhi } from "@/engines/eastern/shared/lunar-calendar"
import { chatDeepSeek, isDeepSeekConfigured } from "@/lib/llm/deepseek"

// 请求体
interface XiaoLiuRenRequest {
  lunarMonth: number
  lunarDay: number
  hour?: number                         // 公历小时 0-23，服务端自动转为时辰地支
  hourDiZhi?: string                    // 或直接传入时辰地支名
  question?: string                     // 用户想问的具体问题
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as XiaoLiuRenRequest
    const { lunarMonth, lunarDay, hour, hourDiZhi: directDiZhi, question } = body

    // ----- 1. 参数校验 -----
    if (!lunarMonth || !lunarDay) {
      return NextResponse.json(
        { error: "缺少必填参数：lunarMonth（农历月）和 lunarDay（农历日）" },
        { status: 400 }
      )
    }
    if (lunarMonth < 1 || lunarMonth > 12) {
      return NextResponse.json({ error: "农历月份需在 1-12 之间" }, { status: 400 })
    }
    if (lunarDay < 1 || lunarDay > 30) {
      return NextResponse.json({ error: "农历日期需在 1-30 之间" }, { status: 400 })
    }

    // 获取时辰地支（服务端自动转换，也可由前端直接传入）
    const resolvedDiZhi = directDiZhi ?? getHourDiZhi(hour ?? new Date().getHours())

    // ----- 2. 纯代码排盘（禁止 LLM 参与）-----
    const divinationResult = calculateXiaoLiuRen({
      lunarMonth,
      lunarDay,
      hourDiZhi: resolvedDiZhi,
    })

    // ----- 3. 检查 API 配置 -----
    if (!isDeepSeekConfigured()) {
      // DeepSeek 未配置时，返回纯排盘 JSON 数据（降级模式）
      return NextResponse.json({
        mode: "calculation-only",
        ...divinationResult,
        note: "DeepSeek API 未配置（DEEPSEEK_API_KEY 环境变量缺失），仅返回排盘数据",
      })
    }

    // ----- 4. 组装业务 Prompt -----
    const systemPrompt = buildXiaoLiuRenPrompt(divinationResult, question)
    const userMessage = question ?? "请为我解析今日运势"

    // ----- 5. 调用 DeepSeek API 进行话术渲染 -----
    const interpretation = await chatDeepSeek({
      system: systemPrompt,
      user: userMessage,
      temperature: 0.7,
      maxTokens: 2048,
    })

    // ----- 6. 返回完整结果：排盘数据 + LLM 解析 -----
    return NextResponse.json({
      mode: "full",
      divination: {
        palace: divinationResult.palace,
        palaceMeta: divinationResult.palaceMeta,
        steps: divinationResult.steps,
        inputLunarMonth: lunarMonth,
        inputLunarDay: lunarDay,
        inputHourDiZhi: resolvedDiZhi,
      },
      interpretation,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[小六壬·API]", message)
    return NextResponse.json({ error: `小六壬占卜失败：${message}` }, { status: 500 })
  }
}
