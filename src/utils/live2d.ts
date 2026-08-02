import type { MotionInfo } from 'easy-live2d'

import { convertFileSrc } from '@tauri-apps/api/core'
import { readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { Config, CubismSetting, Live2DSprite, Priority } from 'easy-live2d'
import { groupBy } from 'es-toolkit/compat'
import JSON5 from 'json5'
import { Application, Ticker } from 'pixi.js'

import type { ModelSize } from '@/composables/useModel'
import type { VTubeStudioBehavior, VTubeStudioInputExpression } from '@/utils/vtube'

import { i18n } from '@/locales'

import { join } from './path'
import { integrateVTubeStudioModel } from './vtube'

interface VTubeStudioExpressionParameter {
  Blend?: 'Add' | 'Multiply' | 'Overwrite'
  Id: string
  Value: number
}

interface VTubeStudioExpressionFile {
  Parameters?: VTubeStudioExpressionParameter[]
}

interface VTubeStudioExpressionState {
  parameters: VTubeStudioExpressionParameter[]
  pressedInputs: Set<string>
  toggled: boolean
}

Config.MouseFollow = false

class Live2d {
  private app: Application | null = null
  private vtubeExpressions = new Map<string, VTubeStudioExpressionState>()
  private vtubeInputExpressions = new Map<string, string>()
  private vtubePressedKeyboardInputs: string[] = []
  public model: Live2DSprite | null = null

  constructor() { }

  private initApp() {
    if (this.app) return

    const view = document.getElementById('live2dCanvas') as HTMLCanvasElement

    this.app = new Application()

    return this.app.init({
      view,
      resizeTo: window,
      backgroundAlpha: 0,
      autoDensity: true,
      resolution: devicePixelRatio,
    })
  }

  public async load(path: string) {
    await this.initApp()

    this.destroy()

    const files = await readDir(path)

    const modelFile = files.find(file => file.name.endsWith('.model3.json'))

    if (!modelFile) {
      throw new Error(i18n.global.t('utils.live2d.hints.notFound'))
    }

    const modelPath = join(path, modelFile.name)

    let modelJSON = JSON5.parse(await readTextFile(modelPath))
    let vtubeBehaviors: VTubeStudioBehavior[] = []
    let vtubeInputExpressions: VTubeStudioInputExpression[] = []
    const expectedVtubeFile = modelFile.name.replace(/\.model3\.json$/i, '.vtube.json')
    const vtubeFile = files.find(file => file.name.toLocaleLowerCase() === expectedVtubeFile.toLocaleLowerCase())
      ?? files.find(file => file.name.endsWith('.vtube.json'))

    if (vtubeFile) {
      try {
        const vtubeConfig = JSON5.parse(await readTextFile(join(path, vtubeFile.name)))
        const integration = integrateVTubeStudioModel(modelJSON, vtubeConfig, files.map(file => file.name))

        modelJSON = integration.modelJSON
        vtubeBehaviors = integration.behaviors
        vtubeInputExpressions = integration.inputExpressions
      } catch (error) {
        console.warn(`Could not import VTube Studio hotkeys from ${vtubeFile.name}:`, error)
      }
    }

    const modelSetting = new CubismSetting({
      modelJSON,
    })

    modelSetting.redirectPath(({ file }) => {
      return convertFileSrc(join(path, file))
    })

    this.model = new Live2DSprite({
      modelSetting,
      ticker: Ticker.shared,
    })

    this.app?.stage.addChild(this.model)

    await this.model.ready

    const expressionDefinitions = [
      ...vtubeBehaviors.filter(behavior => behavior.kind === 'expression'),
      ...vtubeInputExpressions,
    ]

    for (const behavior of expressionDefinitions) {
      if (this.vtubeExpressions.has(behavior.expressionName)) continue

      try {
        const expression = JSON5.parse(
          await readTextFile(join(path, behavior.file)),
        ) as VTubeStudioExpressionFile
        const parameters = expression.Parameters ?? []
        const supportsToggle = parameters.length > 0 && parameters.every((parameter) => {
          return parameter.Id
            && Number.isFinite(parameter.Value)
            && (parameter.Blend === 'Add' || parameter.Blend === 'Multiply' || !parameter.Blend)
        })

        if (!supportsToggle) continue

        this.vtubeExpressions.set(behavior.expressionName, {
          parameters,
          pressedInputs: new Set(),
          toggled: false,
        })
      } catch (error) {
        console.warn(`Could not load VTube Studio expression ${behavior.file}:`, error)
      }
    }

    for (const input of vtubeInputExpressions) {
      if (!this.vtubeExpressions.has(input.expressionName)) continue

      this.vtubeInputExpressions.set(
        this.getVtubeInputId(input.device, input.key),
        input.expressionName,
      )
    }

    const { width, height } = this.model

    const motions = groupBy(this.model.getMotions().map((motion) => {
      const behavior = vtubeBehaviors.find((behavior) => {
        return behavior.kind === 'motion'
          && behavior.group === motion.group
          && behavior.index === motion.no
      })

      return {
        ...motion,
        displayName: behavior?.name,
      }
    }), 'group')
    const expressions = this.model.getExpressions()

    return {
      width,
      height,
      motions,
      expressions,
      vtubeBehaviors,
    }
  }

  public destroy() {
    this.vtubeExpressions.clear()
    this.vtubeInputExpressions.clear()
    this.vtubePressedKeyboardInputs.length = 0

    if (!this.model) return

    this.model?.destroy()

    this.model = null
  }

  public resizeModel(modelSize: ModelSize) {
    if (!this.model) return

    const { width, height } = modelSize

    const scaleX = innerWidth / width
    const scaleY = innerHeight / height
    const scale = Math.min(scaleX, scaleY)

    this.model.scale.set(scale)
    this.model.x = innerWidth / 2
    this.model.y = innerHeight / 2
    this.model.anchor.set(0.5)
  }

  public startMotion(motion: MotionInfo) {
    return this.model?.startMotion({
      ...motion,
      priority: Priority.Normal,
    })
  }

  public setExpression(index: number) {
    const expressionName = this.model?.getExpressions()[index]?.name
    const expression = expressionName ? this.vtubeExpressions.get(expressionName) : undefined

    if (expression) {
      expression.toggled = !expression.toggled
      this.applyVtubeExpressions()
      return
    }

    return this.model?.setExpression({ index })
  }

  public hasVTubeStudioInput(device: 'keyboard' | 'mouse', key: string) {
    return this.vtubeInputExpressions.has(this.getVtubeInputId(device, key))
  }

  public setVTubeStudioInput(device: 'keyboard' | 'mouse', key: string, pressed: boolean) {
    const inputId = this.getVtubeInputId(device, key)
    const expressionName = this.vtubeInputExpressions.get(inputId)
    const expression = expressionName ? this.vtubeExpressions.get(expressionName) : undefined

    if (!expression) return

    if (device === 'keyboard') {
      const previousIndex = this.vtubePressedKeyboardInputs.indexOf(inputId)

      if (previousIndex >= 0) this.vtubePressedKeyboardInputs.splice(previousIndex, 1)
      if (pressed) this.vtubePressedKeyboardInputs.push(inputId)

      for (const state of this.vtubeExpressions.values()) {
        for (const pressedInput of state.pressedInputs) {
          if (pressedInput.startsWith('keyboard:')) state.pressedInputs.delete(pressedInput)
        }
      }

      const currentInputId = this.vtubePressedKeyboardInputs.at(-1)
      const currentExpressionName = currentInputId
        ? this.vtubeInputExpressions.get(currentInputId)
        : undefined
      const currentExpression = currentExpressionName
        ? this.vtubeExpressions.get(currentExpressionName)
        : undefined

      if (currentInputId && currentExpression) {
        currentExpression.pressedInputs.add(currentInputId)
      }
    } else if (pressed) {
      expression.pressedInputs.add(inputId)
    } else {
      expression.pressedInputs.delete(inputId)
    }

    this.applyVtubeExpressions()
  }

  private getVtubeInputId(device: 'keyboard' | 'mouse', key: string) {
    return `${device}:${key}`
  }

  private applyVtubeExpressions() {
    const values = new Map<string, {
      additive: number
      hasAdditive: boolean
      multiplicative: number
    }>()

    for (const expression of this.vtubeExpressions.values()) {
      const active = expression.toggled || expression.pressedInputs.size > 0

      for (const parameter of expression.parameters) {
        const current = values.get(parameter.Id) ?? {
          additive: 0,
          hasAdditive: false,
          multiplicative: 1,
        }

        if (active) {
          if (parameter.Blend === 'Multiply') {
            current.multiplicative *= parameter.Value
          } else {
            current.additive += parameter.Value
            current.hasAdditive = true
          }
        } else if (parameter.Blend !== 'Multiply') {
          current.hasAdditive = true
        }

        values.set(parameter.Id, current)
      }
    }

    for (const [id, value] of values) {
      const nextValue = value.hasAdditive
        ? value.additive * value.multiplicative
        : value.multiplicative

      this.model?.setParameterValueById(id, nextValue)
    }
  }

  public getParameterValueRange(id: string) {
    return this.model?.getParameterValueRangeById(id)
  }

  public setParameterValue(id: string, value: number | boolean) {
    return this.model?.setParameterValueById(id, Number(value))
  }

  public setMotionSoundEnabled(enabled: boolean) {
    Config.MotionSound = enabled
  }

  public setMaxFPS(fps: number) {
    Ticker.shared.maxFPS = fps
  }
}

const live2d = new Live2d()

export default live2d
