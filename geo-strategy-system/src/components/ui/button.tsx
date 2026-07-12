import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4096FF]/35 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-[#1677FF] bg-gradient-to-r from-[#1677FF] to-[#0958D9] text-white shadow-[0_10px_22px_-15px_rgba(9,88,217,0.72)] hover:border-[#0958D9] hover:from-[#0958D9] hover:to-[#003EB3]",
        destructive: "border border-[#FF5B6E] bg-[#FF5B6E] text-white shadow-sm hover:border-[#E5485A] hover:bg-[#E5485A]",
        outline: "border border-[#BDD8FF] bg-white text-slate-700 shadow-sm hover:border-[#91CAFF] hover:bg-[#F0F7FF] hover:text-[#0958D9]",
        secondary: "border border-[#BAE0FF] bg-[#E6F4FF] text-[#0958D9] hover:bg-[#D6EBFF]",
        ghost: "text-slate-600 hover:bg-[#EAF3FF] hover:text-[#0958D9]",
        link: "text-[#0958D9] underline-offset-4 hover:text-[#003EB3] hover:underline",
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
