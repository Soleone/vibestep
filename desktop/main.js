import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PORT } from '../companion/server.js'
import { startCompanion } from '../companion/index.js'
import { BEAT_FIEND_WEB_URL } from '../companion/config.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
const pairingUrl = `http://127.0.0.1:${DEFAULT_PORT}/v1/pair`
let companionServer = null
let mainWindow = null
let tray = null
let status = { state: 'starting', message: 'Preparing the local audio tools...' }

function publishStatus(next) {
  status = { ...status, ...next }
  mainWindow?.webContents.send('companion-status', status)
  tray?.setToolTip(`Beat Fiend Companion: ${status.state}`)
}

function openBeatFiend(pair = false) {
  void shell.openExternal(pair ? pairingUrl : BEAT_FIEND_WEB_URL)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 520,
    minWidth: 420,
    minHeight: 460,
    show: false,
    title: 'Beat Fiend Companion',
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
  mainWindow.on('close', (event) => {
    if (app.isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(directory, 'icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('Beat Fiend Companion')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Beat Fiend', click: () => openBeatFiend(false) },
    { label: 'Pair this browser', click: () => openBeatFiend(true) },
    { label: 'Companion status', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } },
  ]))
  tray.on('double-click', () => mainWindow?.show())
}

function configureUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => publishStatus({ update: 'Checking for updates...' }))
  autoUpdater.on('update-not-available', () => publishStatus({ update: 'You have the latest version.' }))
  autoUpdater.on('update-available', ({ version }) => publishStatus({ update: `Downloading version ${version}...` }))
  autoUpdater.on('download-progress', ({ percent }) => publishStatus({ update: `Downloading update: ${Math.round(percent)}%` }))
  autoUpdater.on('update-downloaded', ({ version }) => publishStatus({ update: `Version ${version} is ready to install.`, updateReady: true }))
  autoUpdater.on('error', (error) => publishStatus({ update: `Update check failed: ${error.message}` }))
}

ipcMain.handle('get-status', () => status)
ipcMain.handle('open-app', () => openBeatFiend(false))
ipcMain.handle('pair', () => openBeatFiend(true))
ipcMain.handle('check-updates', () => app.isPackaged ? autoUpdater.checkForUpdates() : publishStatus({ update: 'Updates are available in packaged builds.' }))
ipcMain.handle('install-update', () => { if (status.updateReady) autoUpdater.quitAndInstall(false, true) })
ipcMain.handle('quit', () => { app.isQuitting = true; app.quit() })

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus() })
  app.whenReady().then(async () => {
    createWindow()
    createTray()
    configureUpdater()
    try {
      companionServer = await startCompanion(process.env, ['--no-open'])
      publishStatus({ state: 'ready', message: 'Ready. Beat Fiend can now import YouTube audio.' })
      openBeatFiend(true)
      if (app.isPackaged) setTimeout(() => void autoUpdater.checkForUpdates(), 5000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publishStatus({ state: 'error', message })
      void dialog.showMessageBox(mainWindow, { type: 'error', title: 'Beat Fiend Companion could not start', message, detail: 'Close any other companion instance, then try again.' })
    }
  })
}

app.on('before-quit', () => {
  app.isQuitting = true
  companionServer?.close()
})
app.on('window-all-closed', () => {})
