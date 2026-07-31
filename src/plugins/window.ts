import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

import type { WINDOW_LABEL } from '../constants'

import { LISTEN_KEY } from '../constants'

export type WindowLabel = typeof WINDOW_LABEL[keyof typeof WINDOW_LABEL]

const COMMAND = {
  SHOW_WINDOW: 'plugin:custom-window|show_window',
  SHOW_WINDOW_BY_LABEL: 'plugin:custom-window|show_window_by_label',
  TOGGLE_WINDOW_BY_LABEL: 'plugin:custom-window|toggle_window_by_label',
  HIDE_WINDOW: 'plugin:custom-window|hide_window',
  SET_ALWAYS_ON_TOP: 'plugin:custom-window|set_always_on_top',
  SET_TASKBAR_VISIBILITY: 'plugin:custom-window|set_taskbar_visibility',
}

export function showWindow(label?: WindowLabel) {
  if (label) {
    invoke(COMMAND.SHOW_WINDOW_BY_LABEL, { label })
  } else {
    invoke(COMMAND.SHOW_WINDOW)
  }
}

export function hideWindow(label?: WindowLabel) {
  if (label) {
    emit(LISTEN_KEY.HIDE_WINDOW, label)
  } else {
    invoke(COMMAND.HIDE_WINDOW)
  }
}

export function setAlwaysOnTop(alwaysOnTop: boolean) {
  invoke(COMMAND.SET_ALWAYS_ON_TOP, { alwaysOnTop })
}

export async function toggleWindowVisible(label?: WindowLabel) {
  if (label) {
    return invoke(COMMAND.TOGGLE_WINDOW_BY_LABEL, { label })
  }

  const appWindow = getCurrentWebviewWindow()

  const visible = await appWindow.isVisible()

  if (visible) {
    return hideWindow(label)
  }

  return showWindow(label)
}

export async function setTaskbarVisibility(visible: boolean) {
  invoke(COMMAND.SET_TASKBAR_VISIBILITY, { visible })
}
