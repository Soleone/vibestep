import { appBrand } from '../branding'

export function AppBrand() {
  const wordmark = appBrand.wordmark

  return (
    <div className="panel-brand">
      {appBrand.icon ? <img className="panel-brand__icon" src={appBrand.icon} alt="" /> : null}
      <h1>
        {wordmark.type === 'text'
          ? wordmark.value
          : <img className="panel-brand__wordmark-image" src={wordmark.src} alt={wordmark.alt ?? appBrand.name} />}
      </h1>
    </div>
  )
}
