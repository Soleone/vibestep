const stateLabel = document.querySelector('#state')
const message = document.querySelector('#message')
const indicator = document.querySelector('#indicator')
const update = document.querySelector('#update')
const installUpdate = document.querySelector('#install-update')

function render(status) {
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

window.beatFiendCompanion.getStatus().then(render)
window.beatFiendCompanion.onStatus(render)
document.querySelector('#open').addEventListener('click', () => window.beatFiendCompanion.openApp())
document.querySelector('#pair').addEventListener('click', () => window.beatFiendCompanion.pair())
document.querySelector('#check-update').addEventListener('click', () => window.beatFiendCompanion.checkUpdates())
installUpdate.addEventListener('click', () => window.beatFiendCompanion.installUpdate())
document.querySelector('#quit').addEventListener('click', () => window.beatFiendCompanion.quit())
