import * as React from "react"
import { cn } from "@/lib/utils"

type FieldProps = React.HTMLAttributes<HTMLDivElement> & {
  label: React.ReactNode
  htmlFor?: string
  required?: boolean
  help?: React.ReactNode
  error?: React.ReactNode
  aside?: React.ReactNode
}

function Field({
  label,
  htmlFor,
  required,
  help,
  error,
  aside,
  className,
  children,
  ...props
}: FieldProps) {
  return (
    <div className={cn("min-w-0", className)} {...props}>
      <label htmlFor={htmlFor} className="geo-field-label">
        <span>
          {label}
          {required ? <span className="ml-1 text-[#E5485A]">*</span> : null}
        </span>
        {aside ? <span className="font-normal text-[#7E91A7]">{aside}</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[11px] leading-5 text-[#D9363E]">{error}</p>
      ) : help ? (
        <p className="geo-field-help">{help}</p>
      ) : null}
    </div>
  )
}

function FieldGroup({
  title,
  description,
  action,
  className,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("geo-panel", className)}>
      <div className="geo-panel-header">
        <div className="min-w-0">
          <div className="geo-panel-title">{title}</div>
          {description ? <div className="geo-panel-description">{description}</div> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="geo-panel-content">{children}</div>
    </section>
  )
}

export { Field, FieldGroup }
