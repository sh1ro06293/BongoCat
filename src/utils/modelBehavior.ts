export function getMotionShortcutId(modelId: string, groupName: string, index: number) {
  return `${modelId}:motion:${groupName}:${index}`
}

export function getExpressionShortcutId(modelId: string, index: number) {
  return `${modelId}:expression:${index}`
}
