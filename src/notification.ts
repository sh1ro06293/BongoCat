import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { monitorFromPoint } from '@tauri-apps/api/window'

import { INVOKE_KEY, WINDOW_LABEL } from '@/constants'

import './assets/css/notification.css'

interface AiNotification {
  provider: string
  status: 'complete' | 'attention' | 'error'
  title: string
  message: string
  project?: string
}

const appWindow = getCurrentWebviewWindow()
const notificationElement = document.querySelector<HTMLButtonElement>('#notification')!
const iconElement = document.querySelector<HTMLElement>('#icon')!
const providerElement = document.querySelector<HTMLElement>('#provider')!
const projectElement = document.querySelector<HTMLElement>('#project')!
const titleElement = document.querySelector<HTMLElement>('#title')!
const messageElement = document.querySelector<HTMLElement>('#message')!

let closeTimer: ReturnType<typeof setTimeout> | undefined
let polling = false

async function positionAboveCat() {
  const mainWindow = await WebviewWindow.getByLabel(WINDOW_LABEL.MAIN)
  if (!mainWindow) return

  const [mainPosition, mainSize, bubbleSize] = await Promise.all([
    mainWindow.outerPosition(),
    mainWindow.outerSize(),
    appWindow.outerSize(),
  ])
  const monitor = await monitorFromPoint(
    mainPosition.x + mainSize.width / 2,
    mainPosition.y + mainSize.height / 2,
  )
  const centeredX = Math.round(mainPosition.x + (mainSize.width - bubbleSize.width) / 2)
  const aboveY = Math.round(mainPosition.y - bubbleSize.height + 18)

  let x = centeredX
  let y = aboveY

  if (monitor) {
    const { position, size } = monitor.workArea
    const maxX = position.x + size.width - bubbleSize.width
    const maxY = position.y + size.height - bubbleSize.height

    x = Math.max(position.x, Math.min(centeredX, maxX))
    y = aboveY >= position.y
      ? Math.min(aboveY, maxY)
      : Math.max(position.y, Math.min(mainPosition.y + mainSize.height - 18, maxY))
  }

  await appWindow.setPosition(new PhysicalPosition(x, y))
}

async function destroyIfIdle() {
  const notifications = await takePending()
  if (notifications.length > 0) {
    await showNotification(notifications.at(-1)!)
    return
  }

  await appWindow.destroy()
}

async function showNotification(notification: AiNotification) {
  notificationElement.className = `notification is-${notification.status}`
  iconElement.textContent = notification.status === 'error'
    ? '!'
    : notification.status === 'attention' ? '?' : '✓'
  providerElement.textContent = notification.provider === 'codex' ? 'Codex' : 'Claude Code'
  projectElement.textContent = notification.project ?? ''
  projectElement.hidden = !notification.project
  titleElement.textContent = notification.title
  messageElement.textContent = notification.message
  notificationElement.hidden = false

  clearTimeout(closeTimer)
  await positionAboveCat().catch(() => {})
  await appWindow.show()
  closeTimer = setTimeout(() => void destroyIfIdle(), 8000)
}

async function takePending() {
  return invoke<AiNotification[]>(INVOKE_KEY.TAKE_PENDING_AI_NOTIFICATIONS)
    .catch(() => [])
}

async function poll() {
  if (polling) return
  polling = true

  try {
    const notifications = await takePending()
    if (notifications.length > 0) {
      await showNotification(notifications.at(-1)!)
    }
  } finally {
    polling = false
  }
}

notificationElement.addEventListener('click', () => void appWindow.destroy())
window.addEventListener('beforeunload', () => clearTimeout(closeTimer))

void poll()
setInterval(() => void poll(), 250)
