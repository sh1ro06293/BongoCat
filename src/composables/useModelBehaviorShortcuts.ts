import {
  isRegistered,
  register,
  unregister,
} from '@tauri-apps/plugin-global-shortcut'
import { onUnmounted, watch } from 'vue'

import { useCatStore } from '@/stores/cat'
import { useModelStore } from '@/stores/model'
import live2d from '@/utils/live2d'
import { getExpressionShortcutId, getMotionShortcutId } from '@/utils/modelBehavior'

interface BehaviorRegistration {
  run: () => void
  shortcut: string
}

export function useModelBehaviorShortcuts() {
  const catStore = useCatStore()
  const modelStore = useModelStore()
  const registered = new Set<string>()
  let syncQueue = Promise.resolve()
  let stopped = false

  function collectRegistrations() {
    const registrations = new Map<string, BehaviorRegistration>()
    const modelId = modelStore.currentModel?.id

    if (!modelId || !catStore.model.behavior) return registrations

    for (const [group, motions] of modelStore.currentMotions) {
      for (const [index, motion] of motions.entries()) {
        const shortcut = modelStore.shortcuts[getMotionShortcutId(modelId, group, index)]?.trim()

        if (!shortcut || registrations.has(shortcut)) continue

        registrations.set(shortcut, {
          run: () => void live2d.startMotion(motion),
          shortcut,
        })
      }
    }

    for (const [index] of modelStore.currentExpressions.entries()) {
      const shortcut = modelStore.shortcuts[getExpressionShortcutId(modelId, index)]?.trim()

      if (!shortcut || registrations.has(shortcut)) continue

      registrations.set(shortcut, {
        run: () => live2d.setExpression(index),
        shortcut,
      })
    }

    return registrations
  }

  async function unregisterOwned() {
    for (const shortcut of registered) {
      try {
        if (await isRegistered(shortcut)) await unregister(shortcut)
      } catch (error) {
        console.warn(`Could not unregister model shortcut ${shortcut}:`, error)
      }
    }

    registered.clear()
  }

  async function sync() {
    await unregisterOwned()

    if (stopped) return

    for (const { run, shortcut } of collectRegistrations().values()) {
      try {
        if (await isRegistered(shortcut)) {
          console.warn(`Model shortcut ${shortcut} is already registered.`)
          continue
        }

        await register(shortcut, (event) => {
          if (event.state === 'Pressed') run()
        })
        registered.add(shortcut)
      } catch (error) {
        console.warn(`Could not register model shortcut ${shortcut}:`, error)
      }
    }
  }

  watch([
    () => catStore.model.behavior,
    () => modelStore.currentModel?.id,
    () => modelStore.currentMotions,
    () => modelStore.currentExpressions,
    () => modelStore.shortcuts,
  ], () => {
    syncQueue = syncQueue.then(sync)
  }, { deep: true, immediate: true })

  onUnmounted(() => {
    stopped = true
    syncQueue = syncQueue.then(unregisterOwned)
  })
}
