<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { computed, onBeforeUnmount, ref } from 'vue'

import { useTauriListen } from '@/composables/useTauriListen'
import { INVOKE_KEY, LISTEN_KEY } from '@/constants'

interface AiNotification {
  provider: string
  status: 'complete' | 'attention' | 'error'
  title: string
  message: string
  project?: string
}

const props = defineProps<{ mirrored?: boolean }>()
const current = ref<AiNotification>()
let timer: ReturnType<typeof setTimeout> | undefined

const providerLabel = computed(() => current.value?.provider === 'codex' ? 'Codex' : 'Claude Code')
const icon = computed(() => {
  if (current.value?.status === 'error') return '!'
  if (current.value?.status === 'attention') return '?'
  return '✓'
})

function show(notification: AiNotification) {
  current.value = notification
  clearTimeout(timer)
  timer = setTimeout(() => current.value = undefined, 8000)
}

useTauriListen<AiNotification>(LISTEN_KEY.AI_NOTIFICATION, ({ payload }) => show(payload))

invoke<AiNotification[]>(INVOKE_KEY.TAKE_PENDING_AI_NOTIFICATIONS)
  .then(notifications => notifications.forEach(show))

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <Transition name="ai-pop">
    <button
      v-if="current"
      class="ai-notification"
      :class="[`is-${current.status}`, { 'is-mirrored': props.mirrored }]"
      type="button"
      @click="current = undefined"
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
  top: 4%;
  left: 50%;
  display: flex;
  width: min(88%, 360px);
  max-height: 42%;
  transform: translateX(-50%);
  gap: 10px;
  overflow: hidden;
  border: 2px solid rgb(52 211 153 / 80%);
  border-radius: 18px;
  background: rgb(17 24 39 / 92%);
  padding: 12px 14px;
  color: white;
  text-align: left;
  box-shadow: 0 8px 30px rgb(0 0 0 / 35%);
  backdrop-filter: blur(8px);
}

.ai-notification.is-mirrored {
  transform: translateX(-50%) scaleX(-1);
}

.ai-notification.is-attention {
  border-color: rgb(251 191 36 / 90%);
}

.ai-notification.is-error {
  border-color: rgb(248 113 113 / 90%);
}

.ai-notification__icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
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
