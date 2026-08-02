import assert from 'node:assert/strict'
import test from 'node:test'

import {
  integrateVTubeStudioModel,
  parseVTubeStudioInput,
  parseVTubeStudioShortcut,
} from '../src/utils/vtube'

test('converts VTube Studio top-row shortcuts', () => {
  assert.equal(parseVTubeStudioShortcut({ Trigger1: 'N1', Trigger2: 'Alt' }), 'Alt+1')
  assert.equal(parseVTubeStudioShortcut({ Trigger1: 'Alt', Trigger2: 'Q' }), 'Alt+Q')
  assert.equal(parseVTubeStudioShortcut({ Trigger1: 'F12' }), 'F12')
  assert.equal(parseVTubeStudioShortcut({ Trigger1: 'A' }), undefined)
})

test('converts VTube Studio press-and-release inputs', () => {
  assert.deepEqual(parseVTubeStudioInput({ Trigger1: 'A' }), {
    device: 'keyboard',
    key: 'KeyA',
  })
  assert.deepEqual(parseVTubeStudioInput({ Trigger1: 'N1' }), {
    device: 'keyboard',
    key: 'Num1',
  })
  assert.deepEqual(parseVTubeStudioInput({ Trigger1: 'Numpad1' }), {
    device: 'keyboard',
    key: 'Kp1',
  })
  assert.deepEqual(parseVTubeStudioInput({ Trigger1: 'LeftMouseButton' }), {
    device: 'mouse',
    key: 'Left',
  })
})

test('adds supported VTube Studio expressions and motions without replacing model data', () => {
  const result = integrateVTubeStudioModel({
    FileReferences: {
      Moc: 'model.moc3',
      Expressions: [{ File: 'existing.exp3.json', Name: 'existing' }],
    },
  }, {
    Hotkeys: [
      {
        Action: 'ToggleExpression',
        File: 'armor.exp3.json',
        IsActive: true,
        IsGlobal: true,
        Name: 'Armor',
        Triggers: { Trigger1: 'Alt', Trigger2: 'N3' },
      },
      {
        Action: 'TriggerAnimation',
        File: 'wave.motion3.json',
        Name: 'Wave',
        Triggers: { Trigger1: 'Alt', Trigger2: 'W' },
      },
      {
        Action: 'ToggleExpression',
        DeactivateAfterKeyUp: true,
        File: 'typing.exp3.json',
        Name: 'Typing',
        Triggers: { Trigger1: 'A' },
      },
    ],
  }, [
    'armor.exp3.json',
    'existing.exp3.json',
    'typing.exp3.json',
    'wave.motion3.json',
  ])

  assert.equal(result.modelJSON.FileReferences?.Moc, 'model.moc3')
  assert.deepEqual(result.modelJSON.FileReferences?.Expressions, [
    { File: 'existing.exp3.json', Name: 'existing' },
    { File: 'armor.exp3.json', Name: 'Armor' },
  ])
  assert.deepEqual(result.modelJSON.FileReferences?.Motions, {
    VTubeStudio: [{ File: 'wave.motion3.json' }],
  })
  assert.deepEqual(result.behaviors, [
    {
      expressionName: 'Armor',
      file: 'armor.exp3.json',
      kind: 'expression',
      name: 'Armor',
      shortcut: 'Alt+3',
    },
    {
      file: 'wave.motion3.json',
      group: 'VTubeStudio',
      index: 0,
      kind: 'motion',
      name: 'Wave',
      shortcut: 'Alt+W',
    },
  ])
  assert.deepEqual(result.inputExpressions, [
    {
      device: 'keyboard',
      expressionName: 'Typing',
      file: 'typing.exp3.json',
      key: 'KeyA',
      name: 'Typing',
    },
  ])
})
