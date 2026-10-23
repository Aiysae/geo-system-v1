"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-fetch"

// The admin's "not a competitor" names, fetched once per page load and
// shared by every component that works out a ranking.

let cached: Promise<string[]> | null = null

function load(): Promise<string[]> {
  cached ||= apiFetch("/api/penetration/excluded-subjects", { cache: "no-store" })
    .then(async response => {
      if (!response.ok) return []
      const data = await response.json() as { global?: unknown }
      return Array.isArray(data.global) ? data.global.map(String) : []
    })
    .catch(() => {
      cached = null
      return []
    })
  return cached
}

/** Forgets the cached list, after an admin changes it. */
export function refreshGlobalExcludedSubjects(): void {
  cached = null
}

export function useGlobalExcludedSubjects(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let active = true
    void load().then(list => {
      if (active) setNames(list)
    })
    return () => {
      active = false
    }
  }, [])
  return names
}
