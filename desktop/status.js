const stateLabel = document.querySelector('#state')
const message = document.querySelector('#message')
const indicator = document.querySelector('#indicator')
const update = document.querySelector('#update')
const installUpdate = document.querySelector('#install-update')
const brandIcon = document.querySelector('#brand-icon')
const brandWordmark = document.querySelector('#brand-wordmark')
const brandName = document.querySelector('#brand-name')
const openButton = document.querySelector('#open')
let appliedBrandName = ''

function applyBrand(brand) {
  if (!brand || appliedBrandName === brand.name) return
  appliedBrandName = brand.name
  document.title = brand.companionName
  document.documentElement.style.setProperty('--brand-vibe', brand.colors.vibe)
  document.documentElement.style.setProperty('--brand-step', brand.colors.step)
  openButton.textContent = `Open ${brand.name}`

  brandIcon.classList.toggle('hidden', !brand.icon)
  if (brand.icon) brandIcon.src = brand.icon

  brandWordmark.classList.toggle('hidden', !brand.wordmark)
  if (brand.wordmark) {
    brandWordmark.src = brand.wordmark
    brandWordmark.alt = brand.name
  }
  brandName.classList.toggle('hidden', Boolean(brand.wordmark))
  brandName.textContent = brand.name.toUpperCase()
}

function render(status) {
  applyBrand(status.brand)
  stateLabel.textContent = status.state === 'ready' ? 'Ready' : status.state === 'error' ? 'Needs attention' : 'Starting'
  message.textContent = status.message
  message.title = status.message
  indicator.className = `indicator ${status.state}`
  if (status.update) {
    update.textContent = status.update
    update.title = status.update
  }
  installUpdate.classList.toggle('hidden', !status.updateReady)
}

window.vibestepCompanion.getStatus().then(render)
window.vibestepCompanion.onStatus(render)
openButton.addEventListener('click', () => window.vibestepCompanion.openApp())
document.querySelector('#pair').addEventListener('click', () => window.vibestepCompanion.pair())
document.querySelector('#check-update').addEventListener('click', () => window.vibestepCompanion.checkUpdates())
installUpdate.addEventListener('click', () => window.vibestepCompanion.installUpdate())
document.querySelector('#quit').addEventListener('click', () => window.vibestepCompanion.quit())
