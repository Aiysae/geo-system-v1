"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function BillingLink({
  children,
  className,
  onNavigate,
  title,
}: {
  children: React.ReactNode
  className?: string
  onNavigate?: () => void
  title?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)

    try {
      const res = await fetch("/api/me", {
        cache: "no-store",
        credentials: "same-origin",
      })
      onNavigate?.()
      if (res.ok) {
        router.push("/billing")
        router.refresh()
      } else {
        router.push("/sign-in?redirect_url=/billing")
      }
    } catch {
      onNavigate?.()
      router.push("/sign-in?redirect_url=/billing")
    } finally {
      setPending(false)
    }
  }

  return (
    <a
      href="/billing"
      title={title}
      aria-busy={pending}
      onClick={handleClick}
      className={className}
    >
      {children}
    </a>
  )
}
