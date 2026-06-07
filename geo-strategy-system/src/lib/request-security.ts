export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")
  if (forwardedProto) return forwardedProto.split(",")[0]?.trim() === "https"

  return new URL(request.url).protocol === "https:"
}
