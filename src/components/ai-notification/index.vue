<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { monitorFromPoint } from '@tauri-apps/api/window'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { INVOKE_KEY, WINDOW_LABEL } from '@/constants'

interface AiNotification {
  provider: string
  status: 'complete' | 'attention' | 'error'
  title: string
  message: string
  project?: string
}

const appWindow = getCurrentWebviewWindow()
const current = ref<AiNotification>()
let timer: ReturnType<typeof setTimeout> | undefined
let pollTimer: ReturnType<typeof setInterval> | undefined
let polling = false

const providerLabel = computed(() => current.value?.provider === 'codex' ? 'Codex' : 'Claude Code')
const icon = computed(() => {
  if (current.value?.status === 'error') return '!'
  if (current.value?.status === 'attention') return '?'
  return '✓'
})

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

async function show(notification: AiNotification) {
  current.value = notification
  clearTimeout(timer)
  await positionAboveCat().catch(() => {})
  await appWindow.show()

  timer = setTimeout(() => {
    current.value = undefined
    void appWindow.hide()
  }, 8000)
}

function dismiss() {
  current.value = undefined
  void appWindow.hide()
}

async function takePending() {
  if (polling) return
  polling = true

  try {
    const notifications = await invoke<AiNotification[]>(INVOKE_KEY.TAKE_PENDING_AI_NOTIFICATIONS)
    notifications.forEach(show)
  } finally {
    polling = false
  }
}

onMounted(() => {
  void takePending()
  pollTimer = setInterval(takePending, 500)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  clearInterval(pollTimer)
})
</script>

<template>
  <Transition name="ai-pop">
    <button
      v-if="current"
      class="ai-notification"
      :class="`is-${current.status}`"
      type="button"
      @click="dismiss"
    >
      <span class="ai-notification__icon">{{ icon }}</span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <strong>{{ providerLabel }}</strong>
          <small v-if="current.project">{{ current.project }}</small>
        </span>
        <span class="block font-bold">{{ current.title }}</span>
        <span class="ai-notification__message">{{ current.message }}</span>
      </span>
    </button>
  </Transition>
</template>

<style scoped>
.ai-notification {
  position: absolute;
  z-index: 20;
  bottom: 14px;
  left: 50%;
  display: flex;
  width: calc(100% - 12px);
  max-height: calc(100% - 18px);
  transform: translateX(-50%);
  gap: 8px;
  border: 2px solid rgb(52 211 153 / 80%);
  border-radius: 16px;
  background: rgb(17 24 39 / 92%);
  padding: 9px 12px;
  color: white;
  font-size: 13px;
  text-align: left;
  box-shadow: 0 8px 30px rgb(0 0 0 / 35%);
  backdrop-filter: blur(8px);
}

.ai-notification::after {
  position: absolute;
  bottom: -10px;
  left: 50%;
  width: 18px;
  height: 18px;
  border-right: 2px solid rgb(52 211 153 / 80%);
  border-bottom: 2px solid rgb(52 211 153 / 80%);
  background: rgb(17 24 39 / 92%);
  content: '';
  transform: translateX(-50%) rotate(45deg);
}

.ai-notification.is-attention {
  border-color: rgb(251 191 36 / 90%);
}

.ai-notification.is-error {
  border-color: rgb(248 113 113 / 90%);
}

.ai-notification__icon {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border-radius: 999px;
  background: rgb(52 211 153 / 24%);
  font-weight: 800;
}

.is-attention .ai-notification__icon {
  background: rgb(251 191 36 / 25%);
}

.is-error .ai-notification__icon {
  background: rgb(248 113 113 / 25%);
}

.ai-notification small {
  overflow: hidden;
  color: rgb(209 213 219);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-notification__message {
  display: -webkit-box;
  overflow: hidden;
  color: rgb(229 231 235);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.ai-pop-enter-active,
.ai-pop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.ai-pop-enter-from,
.ai-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px) scale(0.96);
}
</style>
