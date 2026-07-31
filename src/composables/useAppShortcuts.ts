import { storeToRefs } from 'pinia'

import { WINDOW_LABEL } from '@/constants'
import { toggleWindowVisible } from '@/plugins/window'
import { useCatStore } from '@/stores/cat'
import { useShortcutStore } from '@/stores/shortcut'

import { useKeyPress } from './useKeyPress'

export function useAppShortcuts() {
  const shortcutStore = useShortcutStore()
  const catStore = useCatStore()
  const { visibleCat, visiblePreference, mirrorMode, penetrable, alwaysOnTop } = storeToRefs(shortcutStore)

  useKeyPress(visibleCat, () => {
    catStore.window.visible = !catStore.window.visible
  })

  useKeyPress(visiblePreference, () => {
    void toggleWindowVisible(WINDOW_LABEL.PREFERENCE)
  })

  useKeyPress(mirrorMode, () => {
    catStore.model.mirror = !catStore.model.mirror
  })

  useKeyPress(penetrable, () => {
    catStore.window.passThrough = !catStore.window.passThrough
  })

  useKeyPress(alwaysOnTop, () => {
    catStore.window.alwaysOnTop = !catStore.window.alwaysOnTop
  })
}
