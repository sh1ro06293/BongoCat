export interface Live2DExpressionReference {
  Name: string
  File: string
}

export interface Live2DMotionReference {
  File: string
  [key: string]: unknown
}

export interface Live2DFileReferences {
  Expressions?: Live2DExpressionReference[]
  Motions?: Record<string, Live2DMotionReference[]>
  [key: string]: unknown
}

export interface Live2DModelJSON {
  FileReferences?: Live2DFileReferences
  [key: string]: unknown
}

interface VTubeStudioTriggers {
  Trigger1?: string
  Trigger2?: string
  Trigger3?: string
}

interface VTubeStudioHotkey {
  Name?: string
  Action?: string
  File?: string
  IsActive?: boolean
  IsGlobal?: boolean
  DeactivateAfterKeyUp?: boolean
  Triggers?: VTubeStudioTriggers
}

export interface VTubeStudioConfig {
  Hotkeys?: VTubeStudioHotkey[]
}

interface VTubeStudioBehaviorBase {
  file: string
  name: string
  shortcut: string
}

export type VTubeStudioBehavior
  = | VTubeStudioBehaviorBase & {
    kind: 'expression'
    expressionName: string
  }
  | VTubeStudioBehaviorBase & {
    kind: 'motion'
    group: string
    index: number
  }

export interface VTubeStudioInputExpression {
  device: 'keyboard' | 'mouse'
  expressionName: string
  file: string
  key: string
  name: string
}

export interface VTubeStudioIntegration {
  behaviors: VTubeStudioBehavior[]
  inputExpressions: VTubeStudioInputExpression[]
  modelJSON: Live2DModelJSON
}

const modifierMap: Record<string, string> = {
  ALT: 'Alt',
  COMMAND: 'Command',
  CONTROL: 'Control',
  CTRL: 'Control',
  META: 'Command',
  SHIFT: 'Shift',
  WIN: 'Command',
}

const standardKeyMap: Record<string, string> = {
  BACKSPACE: 'Backspace',
  DOWN: 'ArrowDown',
  ENTER: 'Enter',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  SPACE: 'Space',
  TAB: 'Tab',
  UP: 'ArrowUp',
}

const deviceKeyMap: Record<string, string> = {
  ADD: 'KpPlus',
  ALT: 'Alt',
  BACKSPACE: 'Backspace',
  CAPSLOCK: 'CapsLock',
  DECIMAL: 'KpDecimal',
  DIVIDE: 'KpDivide',
  DOWN: 'DownArrow',
  ENTER: 'Return',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  LEFT: 'LeftArrow',
  LEFTCONTROL: 'ControlLeft',
  LEFTSHIFT: 'ShiftLeft',
  LEFTWINDOWS: 'MetaLeft',
  MULTIPLY: 'KpMultiply',
  NUMLOCK: 'NumLock',
  RETURN: 'Return',
  RIGHT: 'RightArrow',
  RIGHTCONTROL: 'ControlRight',
  RIGHTSHIFT: 'ShiftRight',
  RIGHTWINDOWS: 'MetaRight',
  SPACE: 'Space',
  SUBTRACT: 'KpMinus',
  TAB: 'Tab',
  UP: 'UpArrow',
}

function convertTrigger(trigger: string) {
  const normalized = trigger.trim().toUpperCase()

  if (modifierMap[normalized]) return modifierMap[normalized]
  if (/^N\d$/.test(normalized)) return normalized.slice(1)
  if (/^[A-Z]$/.test(normalized)) return normalized
  if (/^F(?:[1-9]|1[0-2])$/.test(normalized)) return normalized

  return standardKeyMap[normalized]
}

export function parseVTubeStudioShortcut(triggers?: VTubeStudioTriggers) {
  if (!triggers) return

  const converted = [triggers.Trigger1, triggers.Trigger2, triggers.Trigger3]
    .filter((trigger): trigger is string => Boolean(trigger))
    .map(convertTrigger)
    .filter((trigger): trigger is string => Boolean(trigger))

  const keys = [...new Set(converted)]
  const modifiers = ['Control', 'Shift', 'Alt', 'Command']
    .filter(modifier => keys.includes(modifier))
  const standardKeys = keys.filter(key => !modifiers.includes(key))

  if (standardKeys.length !== 1) return
  if (modifiers.length === 0 && !standardKeys[0].startsWith('F')) return

  return [...modifiers, standardKeys[0]].join('+')
}

export function parseVTubeStudioInput(triggers?: VTubeStudioTriggers) {
  if (!triggers) return

  const triggerValues = [triggers.Trigger1, triggers.Trigger2, triggers.Trigger3]
    .filter((trigger): trigger is string => Boolean(trigger?.trim()))

  if (triggerValues.length !== 1) return

  const trigger = triggerValues[0].trim().toUpperCase()

  if (trigger === 'LEFTMOUSEBUTTON' || trigger === 'RIGHTMOUSEBUTTON') {
    return {
      device: 'mouse' as const,
      key: trigger === 'LEFTMOUSEBUTTON' ? 'Left' : 'Right',
    }
  }

  let key = deviceKeyMap[trigger]

  if (/^[A-Z]$/.test(trigger)) key = `Key${trigger}`
  if (/^N\d$/.test(trigger)) key = `Num${trigger.slice(1)}`
  if (/^NUMPAD\d$/.test(trigger)) key = `Kp${trigger.slice(-1)}`
  if (/^F(?:[1-9]|1[0-2])$/.test(trigger)) key = trigger

  if (!key) return

  return {
    device: 'keyboard' as const,
    key,
  }
}

function sameFile(left: string, right: string) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

function fileNameWithoutExtension(file: string) {
  return file.split(/[\\/]/).at(-1)?.replace(/\.(?:exp3|motion3)\.json$/i, '') ?? file
}

function uniqueExpressionName(preferredName: string, expressions: Live2DExpressionReference[]) {
  const existing = new Set(expressions.map(expression => expression.Name))

  if (!existing.has(preferredName)) return preferredName

  let suffix = 2

  while (existing.has(`${preferredName} (${suffix})`)) suffix++

  return `${preferredName} (${suffix})`
}

export function integrateVTubeStudioModel(
  sourceModelJSON: Live2DModelJSON,
  config: VTubeStudioConfig,
  availableFiles: Iterable<string>,
): VTubeStudioIntegration {
  const fileReferences = sourceModelJSON.FileReferences ?? {}
  const expressions = [...(fileReferences.Expressions ?? [])]
  const motions = Object.fromEntries(
    Object.entries(fileReferences.Motions ?? {}).map(([group, items]) => [group, [...items]]),
  )
  const knownFiles = new Set([...availableFiles].map(file => file.toLocaleLowerCase()))
  const behaviors: VTubeStudioBehavior[] = []
  const inputExpressions: VTubeStudioInputExpression[] = []
  const importedFiles = new Set<string>()
  const motionGroup = 'VTubeStudio'

  for (const hotkey of config.Hotkeys ?? []) {
    const { Action: action, File: file } = hotkey
    const input = action === 'ToggleExpression' && hotkey.DeactivateAfterKeyUp
      ? parseVTubeStudioInput(hotkey.Triggers)
      : undefined
    const shortcut = hotkey.DeactivateAfterKeyUp
      ? undefined
      : parseVTubeStudioShortcut(hotkey.Triggers)

    if (!file || (!shortcut && !input)) continue
    if (hotkey.IsActive === false || hotkey.IsGlobal === false) continue
    if (action !== 'ToggleExpression' && action !== 'TriggerAnimation') continue
    if (!knownFiles.has(file.toLocaleLowerCase())) continue

    const importId = input
      ? `input:${input.device}:${input.key}:${file.toLocaleLowerCase()}`
      : `${action}:${file.toLocaleLowerCase()}`

    if (importedFiles.has(importId)) continue

    importedFiles.add(importId)

    const name = hotkey.Name?.trim() || fileNameWithoutExtension(file)

    if (action === 'ToggleExpression') {
      let reference = expressions.find(expression => sameFile(expression.File, file))

      if (input) {
        inputExpressions.push({
          ...input,
          expressionName: reference?.Name ?? uniqueExpressionName(name, expressions),
          file,
          name,
        })
        continue
      }

      if (!reference) {
        reference = {
          File: file,
          Name: uniqueExpressionName(name, expressions),
        }
        expressions.push(reference)
      }

      if (!shortcut) continue

      behaviors.push({
        expressionName: reference.Name,
        file,
        kind: 'expression',
        name,
        shortcut,
      })
      continue
    }

    if (!shortcut) continue

    let matchedGroup: string | undefined
    let matchedIndex = -1

    for (const [group, items] of Object.entries(motions)) {
      const index = items.findIndex(motion => sameFile(motion.File, file))

      if (index < 0) continue

      matchedGroup = group
      matchedIndex = index
      break
    }

    if (!matchedGroup) {
      motions[motionGroup] ??= []
      matchedGroup = motionGroup
      matchedIndex = motions[motionGroup].length
      motions[motionGroup].push({ File: file })
    }

    behaviors.push({
      file,
      group: matchedGroup,
      index: matchedIndex,
      kind: 'motion',
      name,
      shortcut,
    })
  }

  return {
    behaviors,
    inputExpressions,
    modelJSON: {
      ...sourceModelJSON,
      FileReferences: {
        ...fileReferences,
        Expressions: expressions,
        Motions: motions,
      },
    },
  }
}
