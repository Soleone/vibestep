import { appBrand } from '../branding'

export function AppBrand() {
  const wordmark = appBrand.wordmark

  return (
    <div className="panel-brand">
      {appBrand.headerIcon ? <img className="panel-brand__icon" src={appBrand.headerIcon} alt="" /> : null}
      <h1>
        {wordmark.type === 'text'
          ? wordmark.parts.map((part, index) => <span key={`${part.text}-${index}`} className={`panel-brand__wordmark-part panel-brand__wordmark-part--${part.color}`}>{part.text}</span>)
          : <img className="panel-brand__wordmark-image" src={wordmark.src} alt={wordmark.alt ?? appBrand.name} />}
      </h1>
    </div>
  )
}
