import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <span className="relative block">
    <select
      ref={ref}
      className={cn(
        "geo-control h-10 appearance-none px-3 py-2 pr-9 text-sm",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7E91A7]"
    />
  </span>
))
Select.displayName = "Select"

export { Select }
