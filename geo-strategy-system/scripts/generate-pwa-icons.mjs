import { mkdir } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"

const outputDirectory = path.join(process.cwd(), "public", "pwa")
const sourcePath = path.join(process.cwd(), "public", "brand", "shitu-lockup-transparent-v2.png")

await mkdir(outputDirectory, { recursive: true })

const metadata = await sharp(sourcePath).metadata()
if (!metadata.width || !metadata.height) {
  throw new Error("Unable to read the Shitu brand mark dimensions.")
}

const symbolRegion = {
  left: Math.round(metadata.width * 0.08),
  top: Math.round(metadata.height * 0.06),
  width: Math.round(metadata.width * 0.84),
  height: Math.round(metadata.height * 0.68),
}

async function whiteSymbol(size, scale) {
  const extractedSymbol = await sharp(sourcePath)
    .extract(symbolRegion)
    .png()
    .toBuffer()

  const croppedSymbol = await sharp(extractedSymbol)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const { data: alpha, info } = await sharp(croppedSymbol)
    .resize({
      width: Math.round(size * scale),
      height: Math.round(size * scale),
      fit: "inside",
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer({ resolveWithObject: true })

  const rgba = Buffer.alloc(info.width * info.height * 4)
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4
    rgba[offset] = 255
    rgba[offset + 1] = 255
    rgba[offset + 2] = 255
    rgba[offset + 3] = alpha[index]
  }

  return {
    data: await sharp(rgba, {
      raw: { width: info.width, height: info.height, channels: 4 },
    }).png().toBuffer(),
    width: info.width,
    height: info.height,
  }
}

async function renderIcon(fileName, size, scale) {
  const symbol = await whiteSymbol(size, scale)
  const background = Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#020B2D"/>
          <stop offset="0.48" stop-color="#0637A6"/>
          <stop offset="1" stop-color="#00AEEA"/>
        </linearGradient>
        <linearGradient id="facet" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#8BE9FF" stop-opacity="0"/>
          <stop offset="0.5" stop-color="#8BE9FF" stop-opacity="0.24"/>
          <stop offset="1" stop-color="#8BE9FF" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#base)"/>
      <path d="M0 ${size * 0.78} L${size * 0.78} 0 H${size} V${size * 0.2} L${size * 0.2} ${size} H0Z" fill="url(#facet)"/>
      <path d="M${size * 0.58} 0 L${size} ${size * 0.42} V${size * 0.7} L${size * 0.3} 0Z" fill="#1677FF" opacity="0.2"/>
    </svg>
  `)

  await sharp(background)
    .composite([{
      input: symbol.data,
      left: Math.round((size - symbol.width) / 2),
      top: Math.round((size - symbol.height) / 2),
    }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(outputDirectory, fileName))
}

await Promise.all([
  renderIcon("icon-192.png", 192, 0.68),
  renderIcon("icon-512.png", 512, 0.68),
  renderIcon("icon-maskable-512.png", 512, 0.52),
  renderIcon("apple-touch-icon.png", 180, 0.64),
])

console.log(`Generated PWA icons in ${outputDirectory}`)
