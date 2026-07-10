import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087F9C]/30 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-[#087F9C] bg-[#087F9C] text-white shadow-sm hover:border-[#066B83] hover:bg-[#066B83]",
        destructive: "border border-[#D14D64] bg-[#D14D64] text-white shadow-sm hover:border-[#B83F55] hover:bg-[#B83F55]",
        outline: "border border-[#cbd8d8] bg-white text-slate-700 shadow-sm hover:border-[#87afb4] hover:bg-[#f1f7f6] hover:text-[#0b665f]",
        secondary: "border border-[#cfe3df] bg-[#e9f4f2] text-[#0b665f] hover:bg-[#dceeea]",
        ghost: "text-slate-600 hover:bg-[#edf4f3] hover:text-[#0b665f]",
        link: "text-[#087F9C] underline-offset-4 hover:text-[#0B665F] hover:underline",
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
