import { Database } from "lucide-react"
import { ADMIN_INTERNAL_DATASET_NOTICE } from "@/lib/admin-internal-dataset"

export function AdminInternalDataNotice({
  className = "",
}: {
  className?: string
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50/90 px-3.5 py-3 text-xs leading-5 text-blue-900 ${className}`}
      role="note"
    >
      <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#1677FF]" />
      <span>{ADMIN_INTERNAL_DATASET_NOTICE}</span>
    </div>
  )
}
