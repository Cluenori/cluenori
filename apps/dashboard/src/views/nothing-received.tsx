import { PlugIcon } from "lucide-react"

import { Panel } from "@/views/panel"

/**
 * A component that has sent nothing yet, in place of a page's content: that this is why the page
 * is empty, what the page will show, and the one step that starts it.
 */
export function NothingReceived({
  component,
  platform,
  shows,
  step,
}: {
  readonly component: string
  /** The component's platform in words, such as "Android app". */
  readonly platform: string
  /** What this page shows once data arrives, as a phrase. */
  readonly shows: string
  /** What to do to start, as a sentence. */
  readonly step: string
}) {
  return (
    <Panel icon={PlugIcon} title={`${component} has sent nothing yet`} subtitle={platform}>
      <div className="flex max-w-2xl flex-col gap-3 px-5 py-6">
        <p className="text-[15px]">{step}</p>
        <p className="text-sm text-muted-foreground">Once it does, this page shows {shows}.</p>
      </div>
    </Panel>
  )
}
