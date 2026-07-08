import * as React from "react"
import { cn } from "@/lib/utils"

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#00A6FB]/35 focus:ring-offset-2",
        variant === "default" && "border-transparent bg-gradient-to-r from-[#0077B6] to-[#7C3AED] text-white shadow",
        variant === "secondary" && "border-transparent bg-cyan-50 text-[#006AA3] ring-1 ring-cyan-100",
        variant === "outline" && "border-slate-200 bg-white/70 text-slate-700",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
