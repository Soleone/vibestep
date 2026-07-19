import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import electronUpdater from 'electron-updater'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PORT } from '../companion/server.js'
import { startCompanion } from '../companion/index.js'
import { BEAT_FIEND_WEB_URL } from '../companion/config.js'
import { formatUpdateError } from './update-errors.js'
import { brandConfig, companionName } from '../brand.config.js'

const { autoUpdater } = electronUpdater
const directory = path.dirname(fileURLToPath(import.meta.url))
const pairingUrl = `http://127.0.0.1:${DEFAULT_PORT}/v1/pair`
let companionServer = null
let mainWindow = null
const companionBrand = {
  name: brandConfig.name,
  companionName,
  colors: brandConfig.colors,
  icon: brandConfig.companion.headerIcon ? path.basename(brandConfig.companion.headerIcon) : null,
  wordmark: brandConfig.companion.wordmark ? path.basename(brandConfig.companion.wordmark) : null,
}
let status = { state: 'starting', message: 'Preparing the local audio tools...', brand: companionBrand }

function publishStatus(next) {
  status = { ...status, ...next }
  mainWindow?.webContents.send('companion-status', status)
}

function openWebApp(pair = false) {
  void shell.openExternal(pair ? pairingUrl : BEAT_FIEND_WEB_URL)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 580,
    minWidth: 480,
    minHeight: 540,
    show: false,
    title: companionName,
    ...(brandConfig.companion.iconPng ? { icon: path.resolve(directory, '..', brandConfig.companion.iconPng) } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(directory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.loadFile(path.join(directory, 'status.html'))
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
}

function configureUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => publishStatus({ update: 'Checking for updates...' }))
  autoUpdater.on('update-not-available', () => publishStatus({ update: 'You have the latest version.' }))
  autoUpdater.on('update-available', ({ version }) => publishStatus({ update: `Downloading version ${version}...` }))
  autoUpdater.on('download-progress', ({ percent }) => publishStatus({ update: `Downloading update: ${Math.round(percent)}%` }))
  autoUpdater.on('update-downloaded', ({ version }) => publishStatus({ update: `Version ${version} is ready to install.`, updateReady: true }))
  autoUpdater.on('error', (error) => publishStatus({ update: formatUpdateError(error) }))
}

ipcMain.handle('get-status', () => status)
ipcMain.handle('open-app', () => openWebApp(false))
ipcMain.handle('pair', () => openWebApp(true))
ipcMain.handle('check-updates', () => app.isPackaged ? autoUpdater.checkForUpdates() : publishStatus({ update: 'Updates are available in packaged builds.' }))
ipcMain.handle('install-update', () => { if (status.updateReady) autoUpdater.quitAndInstall(false, true) })
ipcMain.handle('quit', () => { app.isQuitting = true; app.quit() })

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus() })
  app.whenReady().then(async () => {
    createWindow()
    configureUpdater()
    try {
      companionServer = await startCompanion(process.env, ['--no-open'])
      publishStatus({ state: 'ready', message: `Ready. ${brandConfig.name} can now import YouTube audio.` })
      openWebApp(true)
      if (app.isPackaged) setTimeout(() => void autoUpdater.checkForUpdates(), 5000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publishStatus({ state: 'error', message })
      void dialog.showMessageBox(mainWindow, { type: 'error', title: `${companionName} could not start`, message, detail: 'Close any other companion instance, then try again.' })
    }
  })
}

app.on('before-quit', () => {
  app.isQuitting = true
  companionServer?.close()
})
app.on('window-all-closed', () => app.quit())
