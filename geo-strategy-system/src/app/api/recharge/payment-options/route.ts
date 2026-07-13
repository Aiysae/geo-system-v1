import { NextResponse } from "next/server"
import { publicPaymentOptions } from "@/lib/payment-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(publicPaymentOptions(), {
    headers: { "Cache-Control": "private, no-store" },
  })
}
