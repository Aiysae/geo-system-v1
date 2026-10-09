import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "shitu-geo",
    timestamp: new Date().toISOString(),
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
