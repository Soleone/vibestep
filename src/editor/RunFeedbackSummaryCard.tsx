import { Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Switch } from '../components/ui'
import type { PlayRun } from '../game/run-history'

export type RunFeedbackSummary = {
  notesWithFeedback: number
  repeatedIssues: number
  consistentlyEarly: number
  consistentlyLate: number
  mixedTiming: number
  perfectNotes: number
  goodNotes: number
  needsWorkNotes: number
}

export function RunFeedbackSummaryCard({
  summary,
  lastRun,
  showLastRunOnly,
  onShowLastRunOnlyChange,
  onDiscardRun,
}: {
  summary: RunFeedbackSummary
  lastRun: PlayRun | null
  showLastRunOnly: boolean
  onShowLastRunOnlyChange: (checked: boolean) => void
  onDiscardRun: (runId: string) => Promise<void>
}) {
  const hasFeedback = summary.notesWithFeedback > 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>Run feedback</CardTitle>
        <CardDescription>
          {hasFeedback ? 'Review current-revision feedback from your Play runs.' : 'Play this beatmap to collect note timing feedback.'}
        </CardDescription>
      </CardHeader>
      {hasFeedback ? (
        <CardContent className="run-feedback-summary">
          <div className="metric-row">
            <Badge tone="muted">Notes {summary.notesWithFeedback}</Badge>
            {showLastRunOnly ? (
              <>
                <Badge tone="success">Perfect {summary.perfectNotes}</Badge>
                <Badge tone="warning">Good {summary.goodNotes}</Badge>
              </>
            ) : <Badge tone={summary.repeatedIssues > 0 ? 'danger' : 'success'}>Repeated issues {summary.repeatedIssues}</Badge>}
          </div>
          <div className="metric-row">
            {showLastRunOnly ? <Badge tone="danger">Needs work {summary.needsWorkNotes}</Badge> : (
              <>
                <Badge tone="warning">Early {summary.consistentlyEarly}</Badge>
                <Badge tone="warning">Late {summary.consistentlyLate}</Badge>
                <Badge tone={summary.mixedTiming > 0 ? 'danger' : 'muted'}>Mixed {summary.mixedTiming}</Badge>
              </>
            )}
          </div>
          <p>Changing a note’s timing, lane, or duration resets only that note’s feedback. Unchanged notes keep their history.</p>
        </CardContent>
      ) : null}
      {lastRun ? (
        <CardContent className="run-feedback-controls">
          <div className="run-feedback-view-setting">
            <div>
              <strong>Show last run only</strong>
              <span>Off uses all revision-compatible runs.</span>
            </div>
            <Switch
              checked={showLastRunOnly}
              onCheckedChange={onShowLastRunOnlyChange}
              label="Last run only"
              className="run-feedback-view-switch"
              aria-label="Show last run only"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="run-feedback-discard"
            onClick={() => {
              if (window.confirm('Discard the most recent run and recompute editor feedback?')) void onDiscardRun(lastRun.id)
            }}
          >
            <Trash2 />Discard latest run
          </Button>
        </CardContent>
      ) : null}
    </Card>
  )
}
