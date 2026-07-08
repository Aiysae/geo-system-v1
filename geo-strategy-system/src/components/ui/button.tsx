import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00A6FB]/35 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-0 bg-gradient-to-r from-[#0077B6] via-[#00A6FB] to-[#7C3AED] text-white shadow-lg shadow-sky-500/20 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/20",
        destructive: "bg-gradient-to-r from-[#F43F5E] to-[#F97316] text-white shadow-sm hover:-translate-y-0.5 hover:shadow-lg hover:shadow-rose-500/20",
        outline: "border border-slate-200 bg-white/85 text-slate-700 shadow-sm hover:border-[#00A6FB]/40 hover:bg-sky-50 hover:text-[#005b8a]",
        secondary: "bg-gradient-to-r from-cyan-50 to-violet-50 text-[#005b8a] shadow-sm ring-1 ring-sky-100 hover:from-cyan-100 hover:to-violet-100",
        ghost: "text-slate-600 hover:bg-sky-50 hover:text-[#005b8a]",
        link: "text-[#0077B6] underline-offset-4 hover:text-[#7C3AED] hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
