"use client"

import { useEffect, useRef } from "react"

type DiamondStar = {
  x: number
  y: number
  size: number
  phase: number
  speed: number
  driftX: number
  driftY: number
  depth: number
  color: string
}

const STAR_COLORS = ["139,233,255", "255,255,255", "0,207,255"] as const

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function buildStars(count: number, seed: number): DiamondStar[] {
  const random = seededRandom(seed)
  return Array.from({ length: count }, (_, index) => ({
    x: random(),
    y: random(),
    size: 0.55 + random() * 1.35,
    phase: random() * Math.PI * 2,
    speed: 0.00045 + random() * 0.00075,
    driftX: (random() - 0.5) * 0.00026,
    driftY: (random() - 0.5) * 0.00018,
    depth: 0.25 + random() * 0.75,
    color: STAR_COLORS[index % STAR_COLORS.length],
  }))
}

export default function DiamondStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    const activeCanvas: HTMLCanvasElement = canvas
    const activeContext: CanvasRenderingContext2D = context

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let width = 0
    let height = 0
    let stars: DiamondStar[] = []
    let frame = 0
    let targetParallaxX = 0
    let targetParallaxY = 0
    let parallaxX = 0
    let parallaxY = 0

    function resize() {
      const bounds = activeCanvas.getBoundingClientRect()
      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)
      activeCanvas.width = Math.round(width * pixelRatio)
      activeCanvas.height = Math.round(height * pixelRatio)
      activeContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      const count = width < 640 ? 22 : width < 1024 ? 38 : 62
      stars = buildStars(count, Math.round(width * 11 + height * 7))
      if (reducedMotion) draw(0)
    }

    function draw(time: number) {
      activeContext.clearRect(0, 0, width, height)
      parallaxX += (targetParallaxX - parallaxX) * 0.035
      parallaxY += (targetParallaxY - parallaxY) * 0.035

      for (const star of stars) {
        const driftedX = star.x * width + time * star.driftX
        const driftedY = star.y * height + time * star.driftY
        const x = ((driftedX + width + 24) % (width + 48)) - 24 + parallaxX * star.depth
        const y = ((driftedY + height + 24) % (height + 48)) - 24 + parallaxY * star.depth
        const pulse = reducedMotion ? 0.62 : 0.42 + (Math.sin(time * star.speed + star.phase) + 1) * 0.24
        const size = star.size * (0.85 + pulse * 0.28)

        activeContext.save()
        activeContext.translate(x, y)
        activeContext.globalAlpha = pulse
        activeContext.fillStyle = `rgb(${star.color})`
        activeContext.shadowColor = `rgba(${star.color},0.7)`
        activeContext.shadowBlur = size * 5
        activeContext.beginPath()
        activeContext.moveTo(0, -size * 1.8)
        activeContext.lineTo(size * 0.72, 0)
        activeContext.lineTo(0, size * 1.8)
        activeContext.lineTo(-size * 0.72, 0)
        activeContext.closePath()
        activeContext.fill()

        if (pulse > 0.64) {
          activeContext.shadowBlur = 0
          activeContext.strokeStyle = `rgba(${star.color},${Math.min(0.72, pulse)})`
          activeContext.lineWidth = 0.55
          activeContext.beginPath()
          activeContext.moveTo(-size * 3.4, 0)
          activeContext.lineTo(size * 3.4, 0)
          activeContext.moveTo(0, -size * 4.4)
          activeContext.lineTo(0, size * 4.4)
          activeContext.stroke()
        }
        activeContext.restore()
      }
    }

    function animate(time: number) {
      draw(time)
      frame = window.requestAnimationFrame(animate)
    }

    function handlePointerMove(event: PointerEvent) {
      targetParallaxX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 9
      targetParallaxY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 7
    }

    function handleVisibilityChange() {
      window.cancelAnimationFrame(frame)
      if (!document.hidden && !reducedMotion) frame = window.requestAnimationFrame(animate)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(activeCanvas)
    resize()
    draw(0)

    if (!reducedMotion) {
      window.addEventListener("pointermove", handlePointerMove, { passive: true })
      document.addEventListener("visibilitychange", handleVisibilityChange)
      frame = window.requestAnimationFrame(animate)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      window.removeEventListener("pointermove", handlePointerMove)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
}
