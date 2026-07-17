import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[background-color,border-color,color,box-shadow,filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4096FF]/35 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-[#1677FF] bg-gradient-to-r from-[#1677FF] to-[#0958D9] text-white shadow-[0_12px_24px_-16px_rgba(9,88,217,0.74)] hover:brightness-105",
        destructive: "border border-[#FF5B6E] bg-[#FF5B6E] text-white shadow-sm hover:border-[#E5485A] hover:bg-[#E5485A]",
        outline: "border border-[#C8D7E8] bg-white text-[#38536E] shadow-[0_1px_2px_rgba(23,59,102,0.04)] hover:border-[#91CAFF] hover:bg-[#F4F9FF] hover:text-[#0958D9]",
        secondary: "border border-[#CFE1F5] bg-[#EEF5FC] text-[#0958D9] hover:bg-[#E4F0FC]",
        ghost: "text-[#526A83] hover:bg-[#EEF5FC] hover:text-[#0958D9]",
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
