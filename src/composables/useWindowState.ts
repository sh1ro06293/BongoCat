import type { Event } from '@tauri-apps/api/event'
import type { Monitor } from '@tauri-apps/api/window'

import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { availableMonitors, cursorPosition } from '@tauri-apps/api/window'
import { useDebounceFn } from '@vueuse/core'
import { isNumber } from 'es-toolkit/compat'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { WINDOW_LABEL } from '@/constants'
import { useAppStore } from '@/stores/app'
import { useCatStore } from '@/stores/cat'
import { getCursorMonitor } from '@/utils/monitor'

export type WindowState = Record<string, Partial<PhysicalPosition & PhysicalSize> | undefined>

const appWindow = getCurrentWebviewWindow()
const { label } = appWindow

export function useWindowState() {
  const appStore = useAppStore()
  const catStore = useCatStore()
  const isRestored = ref(false)
  let monitorConfiguration = ''
  let monitorPollTimer: ReturnType<typeof setInterval> | undefined

  onMounted(() => {
    appWindow.onMoved(onChange)

    appWindow.onResized(onChange)

    appWindow.onScaleChanged(() => void checkMonitorConfiguration().catch(() => {}))

    if (label === WINDOW_LABEL.MAIN) {
      void checkMonitorConfiguration().catch(() => {})
      monitorPollTimer = setInterval(
        () => void checkMonitorConfiguration().catch(() => {}),
        1000,
      )
    }
  })

  onUnmounted(() => clearInterval(monitorPollTimer))

  const clampWindowToMonitor = async (monitor: Monitor) => {
    const { position: monitorPos, size: monitorSize } = monitor.workArea
    const windowSize = await appWindow.outerSize()
    const windowPos = await appWindow.outerPosition()

    const minX = monitorPos.x
    const maxX = Math.max(minX, monitorPos.x + monitorSize.width - windowSize.width)
    const minY = monitorPos.y
    const maxY = Math.max(minY, monitorPos.y + monitorSize.height - windowSize.height)

    const clampedX = Math.max(minX, Math.min(windowPos.x, maxX))
    const clampedY = Math.max(minY, Math.min(windowPos.y, maxY))

    if (clampedX === windowPos.x && clampedY === windowPos.y) return

    await appWindow.setPosition(new PhysicalPosition(clampedX, clampedY))
  }

  const clampToMonitor = useDebounceFn(async () => {
    if (label !== WINDOW_LABEL.MAIN || !catStore.window.keepInScreen) return

    const monitor = await getCursorMonitor()

    if (!monitor) return

    return clampWindowToMonitor(monitor)
  }, 500)

  const checkMonitorConfiguration = async () => {
    if (label !== WINDOW_LABEL.MAIN) return

    const monitors = await availableMonitors()
    if (monitors.length === 0) return

    const nextConfiguration = monitors
      .map(({ position, size, scaleFactor }) => (
        `${position.x},${position.y},${size.width},${size.height},${scaleFactor}`
      ))
      .sort()
      .join('|')

    if (nextConfiguration === monitorConfiguration) return

    const isInitialConfiguration = monitorConfiguration === ''
    monitorConfiguration = nextConfiguration
    if (isInitialConfiguration) return

    const [windowPos, windowSize] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ])
    const intersectsConnectedMonitor = monitors.some(({ position, size }) => (
      windowPos.x < position.x + size.width
      && windowPos.x + windowSize.width > position.x
      && windowPos.y < position.y + size.height
      && windowPos.y + windowSize.height > position.y
    ))

    if (intersectsConnectedMonitor) return

    const cursor = await cursorPosition()
    const targetMonitor = monitors.find(({ position, size }) => (
      cursor.x >= position.x
      && cursor.x < position.x + size.width
      && cursor.y >= position.y
      && cursor.y < position.y + size.height
    )) ?? monitors[0]

    await clampWindowToMonitor(targetMonitor)
  }

  watch(() => catStore.window.keepInScreen, clampToMonitor)

  const onChange = async (event: Event<PhysicalPosition | PhysicalSize>) => {
    const minimized = await appWindow.isMinimized()

    if (minimized) return

    appStore.windowState[label] ??= {}

    Object.assign(appStore.windowState[label], event.payload)

    clampToMonitor()
  }

  const restoreState = async () => {
    const { x, y, width, height } = appStore.windowState[label] ?? {}

    if (isNumber(x) && isNumber(y)) {
      const monitors = await availableMonitors()

      const monitor = monitors.find((monitor) => {
        const { position, size } = monitor

        const inBoundsX = x >= position.x && x <= position.x + size.width
        const inBoundsY = y >= position.y && y <= position.y + size.height

        return inBoundsX && inBoundsY
      })

      if (monitor) {
        await appWindow.setPosition(new PhysicalPosition(x, y))
      }
    }

    if (width && height) {
      await appWindow.setSize(new PhysicalSize(width, height))
    }

    isRestored.value = true

    clampToMonitor()
  }

  return {
    isRestored,
    restoreState,
  }
}
