import { Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui'
import type { PlayRun } from '../game/run-history'

export type RunFeedbackSummary = {
  notesWithFeedback: number
  repeatedIssues: number
  consistentlyEarly: number
  consistentlyLate: number
  mixedTiming: number
}

export function RunFeedbackSummaryCard({
  summary,
  lastRun,
  onDiscardRun,
}: {
  summary: RunFeedbackSummary
  lastRun: PlayRun | null
  onDiscardRun: (runId: string) => Promise<void>
}) {
  const hasFeedback = summary.notesWithFeedback > 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run feedback</CardTitle>
        <CardDescription>
          {hasFeedback
            ? 'Aggregates all Play attempts that match each note’s current timing, lane, and duration.'
            : 'Play this beatmap to collect note timing feedback.'}
        </CardDescription>
      </CardHeader>
      {hasFeedback ? (
        <CardContent className="run-feedback-summary">
          <div className="metric-row">
            <Badge tone="muted">Notes {summary.notesWithFeedback}</Badge>
            <Badge tone={summary.repeatedIssues > 0 ? 'danger' : 'success'}>Repeated issues {summary.repeatedIssues}</Badge>
          </div>
          <div className="metric-row">
            <Badge tone="warning">Early {summary.consistentlyEarly}</Badge>
            <Badge tone="warning">Late {summary.consistentlyLate}</Badge>
            <Badge tone={summary.mixedTiming > 0 ? 'danger' : 'muted'}>Mixed {summary.mixedTiming}</Badge>
          </div>
          <p>Changing a note’s timing, lane, or duration resets only that note’s feedback. Unchanged notes keep their history.</p>
        </CardContent>
      ) : null}
      {lastRun ? (
        <CardFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm('Discard the most recent run and recompute editor feedback?')) void onDiscardRun(lastRun.id)
            }}
          >
            <Trash2 />Discard most recent run
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}
