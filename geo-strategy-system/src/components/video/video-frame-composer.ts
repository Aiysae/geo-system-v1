"use client"

/**
 * The generated images carry no text: covers and pages get their words drawn here,
 * in the viewer's own Chinese fonts (the server has none), plus the AI label that
 * 《人工智能生成合成内容标识办法》 requires on generated media.
 */
const WIDTH = 1080
const HEIGHT = 1920
const FONT_FAMILY = "\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"Noto Sans CJK SC\", sans-serif"

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("图片加载失败"))
    image.src = url
  })
}

function drawCoverFit(context: CanvasRenderingContext2D, image: HTMLImageElement) {
  const scale = Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  context.drawImage(image, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height)
}

/** Breaks text into lines that fit, honouring the writer's own line breaks. */
function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\n+/).map(part => part.trim()).filter(Boolean)) {
    let line = ""
    for (const char of Array.from(paragraph)) {
      if (line && context.measureText(line + char).width > maxWidth) {
        lines.push(line)
        line = char
      } else {
        line += char
      }
    }
    if (line) lines.push(line)
  }
  return lines.slice(0, maxLines)
}

function drawAiLabel(context: CanvasRenderingContext2D) {
  context.font = `600 30px ${FONT_FAMILY}`
  const label = "AI 生成"
  const width = context.measureText(label).width + 36
  context.fillStyle = "rgba(0, 0, 0, 0.45)"
  context.beginPath()
  context.roundRect(WIDTH - width - 36, HEIGHT - 96, width, 56, 28)
  context.fill()
  context.fillStyle = "rgba(255, 255, 255, 0.92)"
  context.textBaseline = "middle"
  context.fillText(label, WIDTH - width - 18, HEIGHT - 68)
}

export async function composeVideoFrame(input: {
  imageUrl: string
  kind: "cover" | "page"
  text: string
  brand?: string
}): Promise<Blob> {
  const image = await loadImage(input.imageUrl)
  const canvas = document.createElement("canvas")
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext("2d")
  if (!context) throw new Error("浏览器不支持图片合成")
  drawCoverFit(context, image)

  const text = input.text.trim()
  if (text) {
    const isCover = input.kind === "cover"
    const fontSize = isCover ? 112 : 88
    context.font = `800 ${fontSize}px ${FONT_FAMILY}`
    const lines = wrapLines(context, text, WIDTH - 160, isCover ? 3 : 2)
    const lineHeight = fontSize * 1.28
    const blockHeight = lines.length * lineHeight
    const top = isCover ? 220 : HEIGHT * 0.3 - blockHeight / 2

    const shade = context.createLinearGradient(0, top - 200, 0, top + blockHeight + 220)
    shade.addColorStop(0, "rgba(0, 0, 0, 0)")
    shade.addColorStop(0.35, "rgba(0, 0, 0, 0.42)")
    shade.addColorStop(0.65, "rgba(0, 0, 0, 0.42)")
    shade.addColorStop(1, "rgba(0, 0, 0, 0)")
    context.fillStyle = shade
    context.fillRect(0, top - 200, WIDTH, blockHeight + 420)

    context.textAlign = "center"
    context.textBaseline = "top"
    context.shadowColor = "rgba(0, 0, 0, 0.5)"
    context.shadowBlur = 18
    context.fillStyle = "#FFFFFF"
    lines.forEach((line, index) => context.fillText(line, WIDTH / 2, top + index * lineHeight))
    context.shadowBlur = 0

    if (isCover && input.brand) {
      context.font = `600 44px ${FONT_FAMILY}`
      context.fillStyle = "#FFD666"
      context.fillText(input.brand, WIDTH / 2, top + blockHeight + 36)
    }
    context.textAlign = "start"
  }
  drawAiLabel(context)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("图片合成失败")), "image/jpeg", 0.9)
  })
}
