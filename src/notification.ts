import { invoke } from '@tauri-apps/api/core'
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi'
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
let positionUpdatePending = false
let positionUpdateRunning = false
let stopFollowingCat: (() => void) | undefined

const DEFAULT_BUBBLE_WIDTH = 380
const MIN_BUBBLE_HEIGHT = 124
const MAX_BUBBLE_HEIGHT = 196
const SCREEN_MARGIN = 8
const BUBBLE_VERTICAL_SPACE = 28

async function getCatWindowLayout() {
  const mainWindow = await WebviewWindow.getByLabel(WINDOW_LABEL.MAIN)
  if (!mainWindow) return null

  const [mainPosition, mainSize, scaleFactor] = await Promise.all([
    mainWindow.outerPosition(),
    mainWindow.outerSize(),
    mainWindow.scaleFactor(),
  ])
  const center = new PhysicalPosition(
    mainPosition.x + mainSize.width / 2,
    mainPosition.y + mainSize.height / 2,
  ).toLogical(scaleFactor)
  const monitor = await monitorFromPoint(
    center.x,
    center.y,
  )

  return { mainPosition, mainSize, monitor }
}

function nextAnimationFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
}

async function resizeToContent() {
  const layout = await getCatWindowLayout()
  const monitor = layout?.monitor
  const monitorScaleFactor = monitor?.scaleFactor ?? await appWindow.scaleFactor()
  const availableWidth = monitor
    ? monitor.workArea.size.width / monitorScaleFactor - SCREEN_MARGIN * 2
    : DEFAULT_BUBBLE_WIDTH
  const availableHeight = monitor
    ? monitor.workArea.size.height / monitorScaleFactor - SCREEN_MARGIN * 2
    : MAX_BUBBLE_HEIGHT
  const width = Math.max(1, Math.min(DEFAULT_BUBBLE_WIDTH, availableWidth))

  await appWindow.setSize(new LogicalSize(width, MIN_BUBBLE_HEIGHT))
  await nextAnimationFrame()

  const contentHeight = Math.ceil(
    notificationElement.getBoundingClientRect().height + BUBBLE_VERTICAL_SPACE,
  )
  const height = Math.max(
    1,
    Math.min(Math.max(MIN_BUBBLE_HEIGHT, contentHeight), MAX_BUBBLE_HEIGHT, availableHeight),
  )

  await appWindow.setSize(new LogicalSize(width, height))
}

async function positionAboveCat() {
  const layout = await getCatWindowLayout()
  if (!layout) return

  const { mainPosition, mainSize, monitor } = layout
  const bubbleSize = await appWindow.outerSize()
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

function schedulePositionUpdate() {
  if (notificationElement.hidden) return

  positionUpdatePending = true
  if (positionUpdateRunning) return

  positionUpdateRunning = true
  requestAnimationFrame(async () => {
    do {
      positionUpdatePending = false
      await positionAboveCat().catch(() => {})
    } while (positionUpdatePending && !notificationElement.hidden)

    positionUpdateRunning = false
  })
}

async function followCatWindow() {
  const mainWindow = await WebviewWindow.getByLabel(WINDOW_LABEL.MAIN)
  if (!mainWindow) return

  const [unlistenMoved, unlistenResized] = await Promise.all([
    mainWindow.onMoved(schedulePositionUpdate),
    mainWindow.onResized(schedulePositionUpdate),
  ])

  stopFollowingCat = () => {
    unlistenMoved()
    unlistenResized()
  }
}

async function hideIfIdle() {
  const notifications = await takePending()
  if (notifications.length > 0) {
    await showNotification(notifications.at(-1)!)
    return
  }

  notificationElement.hidden = true
  await appWindow.hide()
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
  notificationElement.classList.add('is-measuring')

  clearTimeout(closeTimer)
  await appWindow.show()
  await resizeToContent().catch(() => {})
  await positionAboveCat().catch(() => {})
  notificationElement.classList.remove('is-measuring')
  closeTimer = setTimeout(() => void hideIfIdle(), 8000)
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

notificationElement.addEventListener('click', () => {
  clearTimeout(closeTimer)
  notificationElement.hidden = true
  void appWindow.hide()
})
window.addEventListener('beforeunload', () => {
  clearTimeout(closeTimer)
  stopFollowingCat?.()
})

void followCatWindow()
void poll()
setInterval(() => void poll(), 250)
