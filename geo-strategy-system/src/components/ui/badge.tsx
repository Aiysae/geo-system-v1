import * as React from "react"
import { cn } from "@/lib/utils"

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline"
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#4096FF]/35 focus:ring-offset-2",
        variant === "default" && "border-transparent bg-gradient-to-r from-[#1677FF] to-[#00C8FF] text-white shadow",
        variant === "secondary" && "border-transparent bg-[#E6F4FF] text-[#0958D9] ring-1 ring-[#BAE0FF]",
        variant === "outline" && "border-[#D6E7FF] bg-white/80 text-slate-700",
        className
      )}
      {...props}
    />
  )
}

export { Badge }
