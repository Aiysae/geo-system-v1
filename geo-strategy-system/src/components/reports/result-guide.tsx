import type { ReactNode } from "react"

interface ResultGuideProps {
  title: string
  summary: string
  nextSteps: string[]
  status: string
  note?: string
  facts?: Array<{ label: string; value: ReactNode }>
}

/** A reading guide only: data, actions and access checks stay in the owning module. */
export default function ResultGuide({ title, summary, nextSteps, status, note, facts = [] }: ResultGuideProps) {
  return (
    <section aria-label={title} className="min-w-0 border-b border-slate-200 bg-white px-5 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{status}</span>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="max-w-[70ch] break-words text-base leading-7 text-slate-800">{summary}</p>
          {facts.length > 0 && <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {facts.map(fact => <div key={fact.label} className="min-w-0">
              <dt className="text-xs leading-5 text-slate-600">{fact.label}</dt>
              <dd className="mt-1 break-words text-base font-semibold tabular-nums text-slate-900">{fact.value}</dd>
            </div>)}
          </dl>}
          {note && <p className="mt-4 max-w-[75ch] text-sm leading-6 text-slate-600">{note}</p>}
        </div>
        <div className="min-w-0 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
          <h3 className="text-sm font-semibold text-slate-900">接下来做什么</h3>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-6 text-slate-700">
            {nextSteps.filter(step => step.trim()).map((step, index) => <li key={`${index}-${step}`} className="break-words pl-1">{step}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}
