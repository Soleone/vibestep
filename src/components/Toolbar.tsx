import type { ReactNode } from 'react'

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="edit-toolbar" role="toolbar" aria-label="Beatmap editing tools">{children}</div>
}
