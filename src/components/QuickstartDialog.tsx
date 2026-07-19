import { CircleHelp, Gamepad2, Music2, SlidersHorizontal } from 'lucide-react'
import { appBrand } from '../branding'
import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui'

export type QuickstartDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
}

const playBindings = [
  ['A', 'Kick'],
  ['D', 'Snare'],
  ['←', 'Low'],
  ['↓', 'Mid'],
  ['→', 'High'],
] as const

export function QuickstartDialog({ open, onOpenChange, onOpenSettings }: QuickstartDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="quickstart-dialog">
        <DialogHeader>
          <DialogTitle>Welcome to {appBrand.name}</DialogTitle>
          <DialogDescription>Play a beatmap, or turn any song into one by lining up its beat grid first.</DialogDescription>
        </DialogHeader>

        <div className="quickstart-sections">
          <section className="quickstart-section">
            <div className="quickstart-section__heading"><Gamepad2 /><h3>Play</h3></div>
            <p>Press the matching lane key when a projectile reaches its pad. The default controls are:</p>
            <div className="quickstart-bindings" aria-label="Default keyboard controls">
              {playBindings.map(([key, lane]) => <div key={lane}><kbd>{key}</kbd><span>{lane}</span></div>)}
            </div>
            <p>You can change keyboard and gamepad controls in Settings.</p>
          </section>

          <section className="quickstart-section quickstart-section--foundation">
            <div className="quickstart-section__heading"><Music2 /><h3>Build the beat grid first</h3></div>
            <ol>
              <li><strong>Import a song in Settings.</strong> Choose an audio file, or connect the companion for YouTube imports.</li>
              <li><strong>Find the song&apos;s BPM.</strong> Look it up, detect it with another tool, or use <em>Start tap</em> in the Editor.</li>
              <li><strong>Set Beat 1.</strong> Move the playhead to the first downbeat, then choose <em>Set beat 1 here</em>. Use the 10ms nudges to align the grid precisely.</li>
            </ol>
            <p className="quickstart-callout"><SlidersHorizontal /> BPM and Beat 1 are the foundation. Set both before recording or placing notes.</p>
          </section>

          <section className="quickstart-section">
            <div className="quickstart-section__heading"><CircleHelp /><h3>Edit</h3></div>
            <p>Create a blank beatmap, arm the lanes you want, then record by playing along or place and adjust notes in the timeline. Save when the grid and notes feel right.</p>
          </section>
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="secondary" />}>Got it</DialogClose>
          <Button type="button" onClick={onOpenSettings}>Open settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
