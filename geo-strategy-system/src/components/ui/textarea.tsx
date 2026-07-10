import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-[0_1px_2px_rgba(8,28,36,0.04)] placeholder:text-slate-400 focus-visible:border-[#6ca2aa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087F9C]/12 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
