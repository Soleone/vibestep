import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui'

type ConfigSectionProps = {
  icon: ReactNode
  title: string
  description: string
  status?: ReactNode
  className?: string
  children: ReactNode
}

export function ConfigSection({ icon, title, description, status, className = '', children }: ConfigSectionProps) {
  return (
    <Card className={`config-section ${className}`.trim()}>
      <CardHeader className="config-section__header">
        <div className="config-section__icon">{icon}</div>
        <div className="config-section__heading">
          <div className="config-section__title-row"><CardTitle>{title}</CardTitle>{status}</div>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="config-section__body">{children}</CardContent>
    </Card>
  )
}
