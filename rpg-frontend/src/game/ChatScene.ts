import { Scene } from 'phaser'
import type { RobotStatus, AgentState, AgentInfo } from '../types'
import type { GameConfig } from './config'

// ========== 代码生成纹理配置（回退用） ==========

const MANAGER_FALLBACK_CONFIG = {
  texture: 'manager_capitalist',
  hatColor: 0x1a1a1a,
  suitColor: 0x2c2c2c,
  tieColor: 0x8b0000,
  shirtColor: 0xffffff
}

const DIRS = ['down', 'left', 'right', 'up'] as const
const AVATAR_TYPE_ALIASES: Record<string, string> = {
  manager: 'boy',
  worker1: 'girl'
}

export class ChatScene extends Scene {
  private npcs: Map<string, Phaser.GameObjects.Container> = new Map()
  private speechBubbles: Map<string, Phaser.GameObjects.Container> = new Map()
  private agentStates: Map<string, AgentState> = new Map()
  private agentDirections: Map<string, string> = new Map()
  private bounceTimers: Map<string, Phaser.Time.TimerEvent> = new Map()
  private speechTimers: Map<string, Phaser.Time.TimerEvent> = new Map()
  private agents: AgentInfo[] = []

  private config: GameConfig
  private sceneScale = 1
  private mapWidth = 0
  private mapHeight = 0
  private mapTileHeight = 24
  private mapLayers: Phaser.Tilemaps.TilemapLayer[] = []
  private collisionRects: Array<{ x: number; y: number; width: number; height: number }> = []

  // 移动相关状态
  private selectedAgent: string | null = null
  private agentMapPositions: Map<string, { x: number; y: number }> = new Map()
  private selectionRing: Phaser.GameObjects.Ellipse | null = null
  private moveTweens: Map<string, Phaser.Tweens.Tween> = new Map()

  constructor(config: GameConfig) {
    super({ key: 'ChatScene' })
    this.config = config
  }

  // ========== 公共 API ==========

  setAgents(agents: AgentInfo[]) {
    this.agents = agents.slice(0, this.config.maxAgents)
    if (this.children.length > 0) {
      this.recreateNPCs()
    }
  }

  shutdown() {
    this.bounceTimers.forEach(timer => timer.remove())
    this.bounceTimers.clear()
    this.speechTimers.forEach(timer => timer.remove())
    this.speechTimers.clear()
    this.agentStates.clear()
    this.agentDirections.clear()
  }

  setRobotStatus(status: RobotStatus, agentName?: string) {
    if (!agentName) {
      const hadActiveStatus = Array.from(this.agentStates.values()).some(s => s !== 'idle')
      this.npcs.forEach((_, name) => {
        this.transitionState(name, status)
      })
      if (hadActiveStatus || status !== 'idle') {
        // transitionState 已处理动画，无需额外调用
      }
      return
    }
    this.transitionState(agentName, status)
  }

  // ========== 生命周期 ==========

  preload() {
    const sceneCfg = this.config.scenes[this.config.currentScene]

    // Tiled 地图
    this.load.tilemapTiledJSON(sceneCfg.key, sceneCfg.mapPath)
    this.load.image(sceneCfg.tilesetImageKey, sceneCfg.tilesetImagePath)
    if (sceneCfg.additionalTilesets) {
      for (const ts of sceneCfg.additionalTilesets) {
        this.load.image(ts.imageKey, ts.imagePath)
      }
    }

    // 帧动画精灵图
    Object.values(this.config.characters).forEach(char => {
      if (char.type === 'spritesheet' && char.spritesheets) {
        this.load.spritesheet(`${char.key}_idle`, char.spritesheets.idle.path, {
          frameWidth: char.spritesheets.idle.frameWidth,
          frameHeight: char.spritesheets.idle.frameHeight
        })
        this.load.spritesheet(`${char.key}_walk`, char.spritesheets.walk.path, {
          frameWidth: char.spritesheets.walk.frameWidth,
          frameHeight: char.spritesheets.walk.frameHeight
        })
      }
    })

    // 代码生成纹理回退（角色 + 气泡）
    this.createPixelTexturesFallback()
  }

  create() {
    // 创建 Tiled 地图
    this.createTilemap()

    // 创建角色帧动画
    this.createAnimations()

    // 创建 NPC
    if (this.agents.length > 0) {
      this.createNPCs()
      this.createSpeechBubbles()
      this.npcs.forEach((_, name) => {
        this.transitionState(name, 'idle')
      })
    }

    // 全局鼠标点击：点击空白处移动选中的 agent
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.selectedAgent) {
        this.onMapClick(pointer.x, pointer.y)
      }
    })

    this.scale.on('resize', this.handleResize, this)
  }

  // ========== Tiled 地图渲染 ==========

  private createTilemap() {
    // 清理旧图层
    this.mapLayers.forEach(l => l.destroy())
    this.mapLayers = []

    const sceneCfg = this.config.scenes[this.config.currentScene]
    const map = this.make.tilemap({ key: sceneCfg.key })

    // 先设置地图尺寸（不依赖 tileset 加载成功）
    this.mapWidth = map.widthInPixels || 720
    this.mapHeight = map.heightInPixels || 480
    this.mapTileHeight = map.tileHeight || 24

    // 注册所有 tileset（主 tileset + 额外 tilesets）
    const tilesets: Phaser.Tilemaps.Tileset[] = []
    const mainTs = map.addTilesetImage(sceneCfg.tilesetName, sceneCfg.tilesetImageKey)
    if (mainTs) tilesets.push(mainTs)
    if (sceneCfg.additionalTilesets) {
      for (const tsCfg of sceneCfg.additionalTilesets) {
        const ts = map.addTilesetImage(tsCfg.name, tsCfg.imageKey)
        if (ts) tilesets.push(ts)
      }
    }

    if (tilesets.length > 0) {
      this.sceneScale = Math.min(
        this.cameras.main.width / this.mapWidth,
        this.cameras.main.height / this.mapHeight
      )

      const layers = sceneCfg.layers.map(name => map.createLayer(name, tilesets))

      const scaledW = this.mapWidth * this.sceneScale
      const scaledH = this.mapHeight * this.sceneScale
      const offsetX = (this.cameras.main.width - scaledW) / 2
      const offsetY = (this.cameras.main.height - scaledH) / 2

      layers.forEach((layer, index) => {
        if (!layer) return
        layer.setPosition(offsetX, offsetY)
        layer.setScale(this.sceneScale)
        layer.setDepth(-10 + index * 5)
        this.mapLayers.push(layer)
      })
    } else {
      console.error('[tilemap] Failed to add tileset, map layers will not render')
    }

    // 碰撞层独立于 tileset，始终尝试加载
    const collisionLayer = map.getObjectLayer(sceneCfg.collisionLayer)
    if (collisionLayer) {
      this.collisionRects = collisionLayer.objects.map(obj => ({
        x: obj.x ?? 0,
        y: obj.y ?? 0,
        width: obj.width ?? 0,
        height: obj.height ?? 0,
      }))
      console.log(`[collision] Loaded ${this.collisionRects.length} rects`)
    } else {
      console.warn('[collision] No collisions layer found!')
      this.collisionRects = []
    }
  }

  // ========== 帧动画 ==========

  private createAnimations() {
    Object.values(this.config.characters).forEach(char => {
      if (char.type !== 'spritesheet' || !char.spritesheets) return

      // idle / thinking / speaking 动画
      const idleKey = `${char.key}_idle`
      let isSingleDirection = false
      if (this.textures.exists(idleKey)) {
        const texture = this.textures.get(idleKey)
        const source = texture.getSourceImage() as HTMLImageElement
        const cols = Math.floor(source.width / char.spritesheets.idle.frameWidth)
        const rows = Math.floor(source.height / char.spritesheets.idle.frameHeight)
        const maxRows = Math.min(4, rows)
        isSingleDirection = rows <= 1

        for (let row = 0; row < maxRows; row++) {
          const dir = DIRS[row]
          const start = row * cols
          const frames = this.anims.generateFrameNumbers(idleKey, { start, end: start + cols - 1 })
          if (!frames || frames.length === 0) continue
          const rate = char.spritesheets.idle.frameRate
          this.anims.create({ key: `${char.key}_idle_${dir}`, frames, frameRate: rate, repeat: -1 })
          this.anims.create({ key: `${char.key}_thinking_${dir}`, frames, frameRate: rate, repeat: -1 })
          this.anims.create({ key: `${char.key}_speaking_${dir}`, frames, frameRate: rate + 2, repeat: -1 })
        }

        // 单方向角色额外注册无方向后缀的 key（用第一行帧），多方向角色不影响
        if (isSingleDirection) {
          const baseFrames = this.anims.generateFrameNumbers(idleKey, { start: 0, end: cols - 1 })
          if (baseFrames && baseFrames.length > 0) {
            const rate = char.spritesheets.idle.frameRate
            this.anims.create({ key: `${char.key}_idle`, frames: baseFrames, frameRate: rate, repeat: -1 })
            this.anims.create({ key: `${char.key}_thinking`, frames: baseFrames, frameRate: rate, repeat: -1 })
            this.anims.create({ key: `${char.key}_speaking`, frames: baseFrames, frameRate: rate + 2, repeat: -1 })
          }
        }
      }

      // walk 动画
      const walkKey = `${char.key}_walk`
      if (this.textures.exists(walkKey)) {
        const texture = this.textures.get(walkKey)
        const source = texture.getSourceImage() as HTMLImageElement
        const cols = Math.floor(source.width / char.spritesheets.walk.frameWidth)
        const rows = Math.floor(source.height / char.spritesheets.walk.frameHeight)
        const maxRows = Math.min(4, rows)

        for (let row = 0; row < maxRows; row++) {
          const dir = DIRS[row]
          const start = row * cols
          const frames = this.anims.generateFrameNumbers(walkKey, { start, end: start + cols - 1 })
          if (!frames || frames.length === 0) continue
          this.anims.create({ key: `${char.key}_walk_${dir}`, frames, frameRate: char.spritesheets.walk.frameRate, repeat: -1 })
        }

        // 单方向角色额外注册无方向后缀的 walk key
        if (rows <= 1) {
          const baseFrames = this.anims.generateFrameNumbers(walkKey, { start: 0, end: cols - 1 })
          if (baseFrames && baseFrames.length > 0) {
            this.anims.create({ key: `${char.key}_walk`, frames: baseFrames, frameRate: char.spritesheets.walk.frameRate, repeat: -1 })
          }
        }
      }
    })
  }

  private getAnimKey(textureKey: string, state: string, direction?: string): string | null {
    const baseKey = textureKey.replace('_idle', '').replace('_walk', '')
    const suffix = direction ? `_${direction}` : ''
    const dirKey = `${baseKey}_${state}${suffix}`
    if (this.anims.exists(dirKey)) return dirKey
    // 兼容只有单方向的帧动画：如果带方向的 key 不存在，尝试不带方向的基础 key
    const baseAnimKey = `${baseKey}_${state}`
    if (this.anims.exists(baseAnimKey)) return baseAnimKey
    return null
  }

  private playAgentAnim(agentName: string, state: string, direction?: string) {
    const npc = this.npcs.get(agentName)
    if (!npc) return
    const body = npc.getAt(0) as Phaser.GameObjects.Sprite
    const animKey = this.getAnimKey(body.texture.key, state, direction)
    if (animKey && body.anims.currentAnim?.key !== animKey) {
      body.play(animKey)
    }
  }

  private hasFrameAnim(textureKey: string): boolean {
    const baseKey = textureKey.replace('_idle', '').replace('_walk', '')
    return this.anims.exists(`${baseKey}_idle_down`) || this.anims.exists(`${baseKey}_idle`)
  }

  /** 计算小人脚底相对于容器中心的 Y 偏移（sprite anchor 为 0.5,0.5） */
  private getFootOffsetY(body: Phaser.GameObjects.Sprite): number {
    return Math.round(body.displayHeight / 2)
  }

  // ========== 碰撞检测 ==========

  private isFootprintColliding(mapX: number, mapY: number): boolean {
    if (this.collisionRects.length === 0) {
      // 无碰撞数据时默认放行，但打日志提示
      return false
    }
    const fp = this.config.ui.footprint
    const footX = mapX - fp.width / 2
    const footY = mapY + fp.offsetY
    const footW = fp.width
    const footH = fp.height
    const colliding = this.collisionRects.some(r =>
      footX < r.x + r.width && footX + footW > r.x &&
      footY < r.y + r.height && footY + footH > r.y
    )
    if (colliding) {
      console.log(`[collision] (${mapX.toFixed(0)},${mapY.toFixed(0)}) collides with footprint [${footX.toFixed(0)},${footY.toFixed(0)} ${footW}x${footH}]`)
    }
    return colliding
  }

  private findSafePos(mapX: number, mapY: number): { x: number; y: number } {
    if (!this.isFootprintColliding(mapX, mapY)) return { x: mapX, y: mapY }

    // 螺旋搜索：先左右，再上下，步长 10 像素
    for (let radius = 10; radius < 400; radius += 10) {
      if (!this.isFootprintColliding(mapX + radius, mapY)) return { x: mapX + radius, y: mapY }
      if (!this.isFootprintColliding(mapX - radius, mapY)) return { x: mapX - radius, y: mapY }
      if (!this.isFootprintColliding(mapX, mapY - radius)) return { x: mapX, y: mapY - radius }
      if (!this.isFootprintColliding(mapX, mapY + radius)) return { x: mapX, y: mapY + radius }
      if (!this.isFootprintColliding(mapX + radius, mapY - radius)) return { x: mapX + radius, y: mapY - radius }
      if (!this.isFootprintColliding(mapX - radius, mapY - radius)) return { x: mapX - radius, y: mapY - radius }
      if (!this.isFootprintColliding(mapX + radius, mapY + radius)) return { x: mapX + radius, y: mapY + radius }
      if (!this.isFootprintColliding(mapX - radius, mapY + radius)) return { x: mapX - radius, y: mapY + radius }
    }
    return { x: mapX, y: mapY }
  }

  private findSafeRandomPos(): { x: number; y: number } {
    const margin = this.config.ui.spawnMargin
    const minX = margin.x
    const maxX = this.mapWidth - margin.x
    const minY = margin.y
    const maxY = this.mapHeight - margin.y

    // 先随机尝试 30 次
    for (let i = 0; i < 30; i++) {
      const mapX = minX + Math.random() * (maxX - minX)
      const mapY = minY + Math.random() * (maxY - minY)
      if (!this.isFootprintColliding(mapX, mapY)) {
        return { x: mapX, y: mapY }
      }
    }

    // fallback：从中心螺旋搜索
    return this.findSafePos(this.mapWidth / 2, this.mapHeight / 2)
  }

  // ========== NPC ==========

  private createNPCs() {
    const count = this.agents.length
    if (count === 0) return

    const scaledW = this.mapWidth * this.sceneScale
    const scaledH = this.mapHeight * this.sceneScale
    const offsetX = (this.cameras.main.width - scaledW) / 2
    const offsetY = (this.cameras.main.height - scaledH) / 2

    this.agents.forEach((agent, index) => {
      let mapX: number, mapY: number
      const saved = this.agentMapPositions.get(agent.name)
      // 如果保存的位置在碰撞区域内，重新随机生成
      if (saved && !this.isFootprintColliding(saved.x, saved.y)) {
        mapX = saved.x
        mapY = saved.y
      } else {
        const safe = this.findSafeRandomPos()
        mapX = safe.x
        mapY = safe.y
      }

      const screenX = offsetX + mapX * this.sceneScale
      const screenY = offsetY + mapY * this.sceneScale

      const charKey = this.resolveAvatarType(agent.avatar_type)
      const texture = this.resolveAgentTexture(agent)

      this.createSingleNPC(agent.name, screenX, screenY, texture, index, mapX, mapY, charKey)
    })
  }

  private resolveAvatarType(avatarType: string): string {
    return AVATAR_TYPE_ALIASES[avatarType] ?? avatarType
  }

  private resolveAgentTexture(agent: AgentInfo): string {
    const charConfig = this.config.characters[this.resolveAvatarType(agent.avatar_type)]
    if (!charConfig) {
      return this.getAgentTextureByName(agent.name)
    }

    if (charConfig.type === 'spritesheet') {
      const idleKey = `${charConfig.key}_idle`
      if (this.textures.exists(idleKey)) return idleKey
    }

    if (charConfig.fallbackKey && this.textures.exists(charConfig.fallbackKey)) {
      return charConfig.fallbackKey
    }

    return this.getAgentTextureByName(agent.name)
  }

  private createSingleNPC(name: string, screenX: number, screenY: number, textureKey: string, index: number, mapX: number, mapY: number, charKey: string) {
    const npc = this.add.container(screenX, screenY)

    const charConfig = this.config.characters[charKey]
    const baseScale = charConfig?.scale ?? 1.35

    // 优先从当前场景配置读取 tileRelativeScale，次之回退到角色全局配置
    const sceneCfg = this.config.scenes[this.config.currentScene]
    let displayScale = baseScale
    const sceneCharScale = sceneCfg?.characterScales?.[charKey]
    if (sceneCharScale !== undefined && charConfig?.type === 'spritesheet' && charConfig.spritesheets) {
      displayScale = (this.mapTileHeight * sceneCharScale) / charConfig.spritesheets.idle.frameHeight
    } else if (charConfig?.tileRelativeScale !== undefined && charConfig.type === 'spritesheet' && charConfig.spritesheets) {
      displayScale = (this.mapTileHeight * charConfig.tileRelativeScale) / charConfig.spritesheets.idle.frameHeight
    }

    const body = this.add.sprite(0, 0, textureKey)
      .setOrigin(0.5, 0.5)
      .setScale(displayScale)
      .setInteractive({ cursor: 'pointer' })

    // 检测是否为单方向帧动画（只有一行帧），存入 sprite data 供后续翻转判断
    let isSingleDirection = false
    if (charConfig?.type === 'spritesheet' && charConfig.spritesheets) {
      const tex = this.textures.get(textureKey)
      if (tex) {
        const source = tex.getSourceImage() as HTMLImageElement
        const rows = Math.floor(source.height / charConfig.spritesheets.idle.frameHeight)
        isSingleDirection = rows <= 1
      }
    }
    body.setData('isSingleDirection', isSingleDirection)
    body.setData('displayScale', displayScale)

    // 点击 NPC 选中/取消选中，阻止事件冒泡到地图
    body.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation()
      this.onNPCClick(name)
    })

    // 如果有帧动画，立即播放 idle（朝下）
    if (this.hasFrameAnim(textureKey)) {
      const animKey = this.getAnimKey(textureKey, 'idle', 'down')
      if (animKey) body.play(animKey)
    }

    // 动态计算名字标签偏移（根据小人实际显示高度）
    const nameOffsetY = charConfig?.nameLabelOffsetY ?? -70
    const nameBg = this.add.rectangle(0, nameOffsetY, 80, 22, 0x000000, 0.6)
    const nameLabel = this.add.text(0, nameOffsetY, name, {
      fontFamily: '"Noto Sans SC", sans-serif',
      fontSize: '12px',
      color: '#ffffff',
    }).setOrigin(0.5)

    npc.add([body, nameBg, nameLabel])
    npc.setDepth(100)
    this.npcs.set(name, npc)

    // 记录地图坐标
    this.agentMapPositions.set(name, { x: mapX, y: mapY })

    // 初始化状态机状态
    this.agentStates.set(name, 'idle')
    this.agentDirections.set(name, 'down')

    // 无帧动画时才用 tween 做 idle 浮动
    if (!this.hasFrameAnim(textureKey)) {
      this.startIdleAnimation(name, index * 200)
    }
  }

  private recreateNPCs() {
    this.npcs.forEach(npc => npc.destroy())
    this.speechBubbles.forEach(bubble => bubble.destroy())
    this.npcs.clear()
    this.speechBubbles.clear()
    this.tweens.killAll()
    this.bounceTimers.forEach(timer => timer.remove())
    this.bounceTimers.clear()
    this.speechTimers.forEach(timer => timer.remove())
    this.speechTimers.clear()
    this.moveTweens.forEach(tween => tween.stop())
    this.moveTweens.clear()
    this.agentStates.clear()
    this.agentDirections.clear()
    this.agentMapPositions.clear()
    this.selectedAgent = null
    this.selectionRing?.destroy()
    this.selectionRing = null

    this.createTilemap()

    if (this.agents.length > 0) {
      this.createNPCs()
      this.createSpeechBubbles()
      this.npcs.forEach((_, name) => {
        this.transitionState(name, 'idle')
      })
    }
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    const width = gameSize.width
    const height = gameSize.height
    this.cameras.main.setBounds(0, 0, width, height)
    this.recreateNPCs()
  }

  // ========== 状态机 ==========

  private transitionState(agentName: string, newState: AgentState, direction?: string) {
    const npc = this.npcs.get(agentName)
    if (!npc) return

    // 1. 始终清理旧效果（移动中再次点击需要 stop 旧 tween）
    this.clearAgentEffects(agentName)

    // 2. 更新状态与方向（即使状态相同也要更新方向）
    this.agentStates.set(agentName, newState)
    if (direction) {
      this.agentDirections.set(agentName, direction)
    }

    // 3. 应用新状态的视觉表现（始终执行，确保动画正确播放）
    this.applyStateVisuals(agentName, newState)
  }

  private clearAgentEffects(agentName: string) {
    const npc = this.npcs.get(agentName)
    if (npc) this.tweens.killTweensOf(npc)

    const bounceTimer = this.bounceTimers.get(agentName)
    if (bounceTimer) {
      bounceTimer.remove()
      this.bounceTimers.delete(agentName)
    }

    const moveTween = this.moveTweens.get(agentName)
    if (moveTween) {
      moveTween.stop()
      this.moveTweens.delete(agentName)
    }
  }

  private applyStateVisuals(agentName: string, state: AgentState) {
    const npc = this.npcs.get(agentName)
    if (!npc) return

    const body = npc.getAt(0) as Phaser.GameObjects.Sprite
    const hasAnim = this.hasFrameAnim(body.texture.key)
    const dir = this.agentDirections.get(agentName) ?? 'down'

    switch (state) {
      case 'idle':
        if (hasAnim) {
          this.playAgentAnim(agentName, 'idle', dir)
        } else {
          this.startIdleAnimation(agentName)
        }
        break
      case 'walking':
        if (hasAnim) {
          this.playAgentAnim(agentName, 'walk', dir)
        }
        break
      case 'thinking':
        if (hasAnim) {
          this.playAgentAnim(agentName, 'thinking', dir)
        } else {
          this.tweens.add({
            targets: npc,
            angle: { from: -5, to: 5 },
            duration: 300,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
          })
        }
        break
      case 'speaking':
        if (hasAnim) {
          this.playAgentAnim(agentName, 'speaking', dir)
        } else {
          this.bounceTimers.set(agentName, this.time.addEvent({
            delay: 200,
            callback: () => {
              this.tweens.add({
                targets: npc,
                scaleY: 0.9,
                duration: 100,
                yoyo: true
              })
            },
            repeat: -1
          }))
        }
        break
    }

    // 单方向帧动画兼容：只有被标记为单方向的角色才通过水平翻转实现 left / right 朝向
    // 多方向角色（girl / manager）完全不受影响
    const isSingleDirection = body.getData('isSingleDirection') as boolean
    if (isSingleDirection) {
      const displayScale = body.getData('displayScale') as number
      if (dir === 'left') {
        body.setScale(-displayScale, displayScale)
      } else if (dir === 'right') {
        body.setScale(displayScale, displayScale)
      }
      // up/down 保持当前 scaleX（角色上下移动不翻转，维持上次水平朝向）
    }
  }

  // ========== 移动与选中 ==========

  private screenToMap(screenX: number, screenY: number): { x: number; y: number } {
    const scaledW = this.mapWidth * this.sceneScale
    const scaledH = this.mapHeight * this.sceneScale
    const offsetX = (this.cameras.main.width - scaledW) / 2
    const offsetY = (this.cameras.main.height - scaledH) / 2
    return {
      x: (screenX - offsetX) / this.sceneScale,
      y: (screenY - offsetY) / this.sceneScale,
    }
  }

  private mapToScreen(mapX: number, mapY: number): { x: number; y: number } {
    const scaledW = this.mapWidth * this.sceneScale
    const scaledH = this.mapHeight * this.sceneScale
    const offsetX = (this.cameras.main.width - scaledW) / 2
    const offsetY = (this.cameras.main.height - scaledH) / 2
    return {
      x: offsetX + mapX * this.sceneScale,
      y: offsetY + mapY * this.sceneScale,
    }
  }

  private onNPCClick(name: string) {
    if (this.selectedAgent === name) {
      this.selectedAgent = null
      this.selectionRing?.destroy()
      this.selectionRing = null
    } else {
      this.selectionRing?.destroy()
      this.selectionRing = null
      this.selectedAgent = name
      this.updateSelectionRing()
    }
  }

  private updateSelectionRing() {
    if (!this.selectedAgent) return
    const npc = this.npcs.get(this.selectedAgent)
    if (!npc) return

    const body = npc.getAt(0) as Phaser.GameObjects.Sprite
    const footOffset = this.getFootOffsetY(body)
    const ringCfg = this.config.ui.selectionRing
    this.selectionRing = this.add.ellipse(npc.x, npc.y + footOffset-20, ringCfg.width, ringCfg.height, 0xffd700, 0.6)
      .setOrigin(0.5)
      .setStrokeStyle(2, 0xffa500)
      .setDepth(95)
  }

  private onMapClick(screenX: number, screenY: number) {
    if (!this.selectedAgent) return

    const targetMap = this.screenToMap(screenX, screenY)

    // 边界限制
    if (targetMap.x < 0 || targetMap.x > this.mapWidth || targetMap.y < 0 || targetMap.y > this.mapHeight) {
      return
    }

    // 检查碰撞
    if (this.isFootprintColliding(targetMap.x, targetMap.y)) {
      return
    }

    this.moveAgentTo(this.selectedAgent, targetMap.x, targetMap.y)
  }

  private moveAgentTo(name: string, targetMapX: number, targetMapY: number) {
    const npc = this.npcs.get(name)
    if (!npc) return

    const currentPos = this.agentMapPositions.get(name)
    if (!currentPos) return

    const dx = targetMapX - currentPos.x
    const dy = targetMapY - currentPos.y
    const distance = Math.sqrt(dx * dx + dy * dy)
    if (distance < 5) return

    // 判断主方向
    let direction = 'down'
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left'
    } else {
      direction = dy > 0 ? 'down' : 'up'
    }

    // 通过状态机进入 walking 状态（自动清理旧效果、播放 walk 动画）
    this.transitionState(name, 'walking', direction)

    const targetScreen = this.mapToScreen(targetMapX, targetMapY)
    const speed = distance * this.config.ui.moveSpeed

    // 用 proxy 对象作为 tween target，避免 killTweensOf(npc) 杀掉移动 tween
    const proxy = { x: npc.x, y: npc.y }

    const tween = this.tweens.add({
      targets: proxy,
      x: targetScreen.x,
      y: targetScreen.y,
      duration: Math.min(speed, 2000),
      ease: 'Linear',
      onUpdate: () => {
        npc.x = proxy.x
        npc.y = proxy.y
        // 同步气泡
        const bubble = this.speechBubbles.get(name)
        if (bubble) {
          bubble.x = npc.x
          bubble.y = npc.y + this.config.ui.bubble.offsetY
        }
        // 同步光圈
        if (this.selectionRing && this.selectedAgent === name) {
          const body = npc.getAt(0) as Phaser.GameObjects.Sprite
          const footOffset = this.getFootOffsetY(body)
          this.selectionRing.x = npc.x
          this.selectionRing.y = npc.y + footOffset -20
        }
      },
      onComplete: () => {
        this.agentMapPositions.set(name, { x: targetMapX, y: targetMapY })
        this.moveTweens.delete(name)

        // 移动完成：调用 applyStateVisuals 一锯子重置 idle 状态（含动画 + 方向翻转）
        this.agentStates.set(name, 'idle')
        this.applyStateVisuals(name, 'idle')
      },
    })

    this.moveTweens.set(name, tween)
  }

  private startIdleAnimation(agentName: string, delay: number = 0) {
    const npc = this.npcs.get(agentName)
    if (!npc) return
    this.time.delayedCall(delay, () => {
      this.tweens.add({
        targets: npc,
        y: npc.y - 3,
        duration: 1500 + Math.random() * 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      })
    })
  }

  // ========== 气泡 ==========

  private createSpeechBubbles() {
    const bubbleCfg = this.config.ui.bubble
    this.npcs.forEach((npc, name) => {
      const bubble = this.add.container(npc.x, npc.y + bubbleCfg.offsetY)
      bubble.setVisible(false)
      bubble.setScale(0)

      const bg = this.add.image(0, 0, 'speechBubble').setOrigin(0.5)
      const text = this.add.text(0, 0, '...', {
        fontFamily: '"Noto Sans SC", sans-serif',
        fontSize: '11px',
        color: '#2d3436',
        align: 'left',
        lineSpacing: 0,
      }).setOrigin(0.5)

      bubble.add([bg, text])
      bubble.setData('text', text)
      bubble.setDepth(200)
      this.speechBubbles.set(name, bubble)
    })
  }

  private showSpeechBubble(text: string, agentName?: string) {
    const targetBubbles = agentName
      ? [this.speechBubbles.get(agentName)].filter(Boolean)
      : Array.from(this.speechBubbles.values())

    targetBubbles.forEach(bubble => {
      if (!bubble) return
      const textObj = bubble.getData('text') as Phaser.GameObjects.Text
      textObj.setText(text)

      this.tweens.killTweensOf(bubble)

      if (bubble.visible) {
        bubble.setScale(1)
        return
      }

      bubble.setVisible(true)
      bubble.setScale(0)
      this.tweens.add({
        targets: bubble,
        scale: { from: 0, to: 1 },
        duration: 200,
        ease: 'Back.easeOut'
      })
    })
  }

  private hideSpeechBubble(agentName?: string) {
    const targetBubbles = agentName
      ? [this.speechBubbles.get(agentName)].filter(Boolean)
      : Array.from(this.speechBubbles.values())

    targetBubbles.forEach(bubble => {
      if (!bubble || !bubble.visible) return
      this.tweens.killTweensOf(bubble)
      this.tweens.add({
        targets: bubble,
        scale: 0,
        duration: 150,
        ease: 'Back.easeIn',
        onComplete: () => {
          bubble.setVisible(false)
        }
      })
    })
  }

  // ========== 对话功能 ==========

  showPlayerDialog(_text: string) {
    this.npcs.forEach((npc) => {
      this.tweens.add({
        targets: npc,
        x: npc.x + 5,
        duration: 200,
        yoyo: true
      })
    })
  }

  private wrapTextByChars(text: string, maxChars: number): string {
    const lines: string[] = []
    for (let i = 0; i < text.length; i += maxChars) {
      lines.push(text.slice(i, i + maxChars))
    }
    return lines.join('\n')
  }

  showNPCDialog(text: string, agentName?: string, onComplete?: () => void) {
    const bubbleCfg = this.config.ui.bubble
    const compact = text.replace(/\r?\n/g, '')
    const truncated = compact.length > bubbleCfg.textMaxLen ? compact.slice(0, bubbleCfg.textMaxLen) + '...' : compact
    const displayText = this.wrapTextByChars(truncated, bubbleCfg.charsPerLine)

    const oldTimer = agentName ? this.speechTimers.get(agentName) : null
    if (oldTimer) {
      oldTimer.remove()
      this.speechTimers.delete(agentName!)
    }

    this.showSpeechBubble(displayText, agentName)

    const timer = this.time.delayedCall(30000, () => {
      this.hideSpeechBubble(agentName)
      if (agentName) this.speechTimers.delete(agentName)
      onComplete?.()
    })

    if (agentName) {
      this.speechTimers.set(agentName, timer)
    }
  }

  highlightAgent(agentName: string) {
    this.npcs.forEach((npc, name) => {
      const body = npc.getAt(0) as Phaser.GameObjects.Sprite
      if (name === agentName) {
        body.setAlpha(1)
        this.tweens.add({
          targets: npc,
          scaleX: 1.1,
          scaleY: 1.1,
          duration: 200,
          yoyo: true
        })
      } else {
        body.setAlpha(0.6)
      }
    })
  }

  resetAgentHighlight() {
    this.npcs.forEach((npc) => {
      const body = npc.getAt(0) as Phaser.GameObjects.Sprite
      body.setAlpha(1)
    })
  }

  // ========== 纹理回退（代码生成） ==========

  private createPixelTexturesFallback() {
    this.createAidenTexture()
    this.createWrenchTexture()
    this.createManagerTexture()

    const bubbleCfg = this.config.ui.bubble
    const BW = bubbleCfg.width
    const BH = bubbleCfg.height
    const arrowH = bubbleCfg.arrowHeight
    const padY = bubbleCfg.paddingY
    const totalH = BH + arrowH + padY
    const tipX = BW / 2
    const tipY = padY + BH

    const bubbleGraphics = this.make.graphics({ x: 0, y: 0 })
    bubbleGraphics.fillStyle(0xffffff)
    bubbleGraphics.fillRoundedRect(0, padY, BW, BH, 12)
    bubbleGraphics.lineStyle(2, 0x2d3436)
    bubbleGraphics.strokeRoundedRect(0, padY, BW, BH, 12)
    bubbleGraphics.fillStyle(0xffffff)
    bubbleGraphics.beginPath()
    bubbleGraphics.moveTo(tipX - 10, tipY)
    bubbleGraphics.lineTo(tipX, tipY + arrowH)
    bubbleGraphics.lineTo(tipX + 10, tipY)
    bubbleGraphics.closePath()
    bubbleGraphics.fillPath()
    bubbleGraphics.lineStyle(2, 0x2d3436)
    bubbleGraphics.beginPath()
    bubbleGraphics.moveTo(tipX - 10, tipY)
    bubbleGraphics.lineTo(tipX, tipY + arrowH)
    bubbleGraphics.lineTo(tipX + 10, tipY)
    bubbleGraphics.strokePath()
    bubbleGraphics.generateTexture('speechBubble', BW, totalH)
  }

  private getAgentTextureByName(name: string): string {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      const char = name.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return Math.abs(hash) % 2 === 0 ? 'aiden' : 'wrench'
  }

  // ========== 角色纹理生成（回退用） ==========

  private createAidenTexture() {
    const graphics = this.make.graphics({ x: 0, y: 0 })
    graphics.fillStyle(0x5d4037)
    graphics.fillRect(8, 2, 32, 10)
    graphics.fillRect(6, 6, 4, 6)
    graphics.fillRect(38, 6, 4, 6)
    graphics.fillStyle(0x4a3228)
    graphics.fillRect(10, 10, 28, 4)
    graphics.fillStyle(0x3e2723, 0.3)
    graphics.fillRect(10, 12, 28, 2)
    graphics.fillStyle(0xe8c4a8)
    graphics.fillRect(10, 14, 28, 18)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(14, 19, 5, 4)
    graphics.fillRect(29, 19, 5, 4)
    graphics.fillStyle(0xffffff)
    graphics.fillRect(15, 20, 2, 2)
    graphics.fillRect(30, 20, 2, 2)
    graphics.fillStyle(0x3e2723)
    graphics.fillRect(13, 16, 7, 2)
    graphics.fillRect(28, 16, 7, 2)
    graphics.fillStyle(0x5a4a3a)
    graphics.fillRect(20, 30, 8, 2)
    graphics.fillStyle(0x6d4c41)
    graphics.fillRect(16, 32, 16, 8)
    graphics.fillRect(14, 34, 4, 4)
    graphics.fillRect(30, 34, 4, 4)
    graphics.fillStyle(0x5d4037)
    graphics.fillRect(8, 40, 32, 20)
    graphics.fillStyle(0x4a3228)
    graphics.fillRect(8, 38, 6, 10)
    graphics.fillRect(34, 38, 6, 10)
    graphics.fillStyle(0x3e2723)
    graphics.fillRect(23, 46, 2, 2)
    graphics.fillRect(23, 52, 2, 2)
    graphics.fillStyle(0x5d4037)
    graphics.fillRect(2, 44, 8, 14)
    graphics.fillRect(38, 44, 8, 14)
    graphics.fillStyle(0xe8c4a8)
    graphics.fillRect(2, 54, 6, 6)
    graphics.fillRect(40, 54, 6, 6)
    graphics.generateTexture('aiden', 48, 60)
  }

  private createWrenchTexture() {
    const graphics = this.make.graphics({ x: 0, y: 0 })
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(6, 0, 36, 12)
    graphics.fillRect(4, 4, 4, 8)
    graphics.fillRect(40, 4, 4, 8)
    graphics.fillRect(8, -2, 4, 4)
    graphics.fillRect(20, -3, 4, 5)
    graphics.fillRect(32, -2, 4, 4)
    graphics.fillStyle(0xf5d0b0)
    graphics.fillRect(10, 12, 28, 18)
    graphics.fillStyle(0x424242)
    graphics.fillRect(12, 16, 24, 12)
    graphics.fillStyle(0xffeb3b)
    graphics.fillRect(14, 18, 4, 2)
    graphics.fillRect(18, 20, 4, 2)
    graphics.fillRect(22, 22, 4, 2)
    graphics.fillRect(26, 20, 4, 2)
    graphics.fillRect(30, 18, 4, 2)
    graphics.fillStyle(0x000000)
    graphics.fillRect(16, 18, 4, 4)
    graphics.fillRect(28, 18, 4, 4)
    graphics.fillStyle(0xffeb3b)
    graphics.fillRect(17, 19, 2, 2)
    graphics.fillRect(29, 19, 2, 2)
    graphics.fillStyle(0x880e4f)
    graphics.fillRect(20, 30, 8, 2)
    graphics.fillRect(18, 28, 2, 2)
    graphics.fillRect(28, 28, 2, 2)
    graphics.fillRect(16, 30, 2, 2)
    graphics.fillRect(30, 30, 2, 2)
    graphics.fillStyle(0x212121)
    graphics.fillRect(8, 34, 32, 8)
    graphics.fillRect(6, 36, 4, 6)
    graphics.fillRect(38, 36, 4, 6)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(8, 42, 32, 18)
    graphics.fillStyle(0xffeb3b)
    graphics.fillRect(20, 44, 2, 8)
    graphics.fillRect(26, 44, 2, 8)
    graphics.fillStyle(0xffeb3b)
    graphics.fillRect(22, 50, 4, 4)
    graphics.fillRect(21, 51, 6, 2)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(2, 46, 8, 14)
    graphics.fillRect(38, 46, 8, 14)
    graphics.fillStyle(0xf5d0b0)
    graphics.fillRect(2, 56, 6, 6)
    graphics.fillRect(40, 56, 6, 6)
    graphics.generateTexture('wrench', 48, 60)
  }

  private createManagerTexture() {
    const { hatColor, suitColor, tieColor, shirtColor } = MANAGER_FALLBACK_CONFIG
    const graphics = this.make.graphics({ x: 0, y: 0 })
    graphics.fillStyle(hatColor)
    graphics.fillRect(4, 8, 40, 6)
    graphics.fillRect(10, -4, 28, 14)
    graphics.fillStyle(0x333333)
    graphics.fillRect(10, 8, 28, 3)
    graphics.fillStyle(0xf5d0b0)
    graphics.fillRect(10, 14, 28, 18)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(14, 20, 5, 4)
    graphics.fillRect(29, 20, 5, 4)
    graphics.fillStyle(0xffffff)
    graphics.fillRect(15, 21, 2, 2)
    graphics.fillStyle(0xffffff)
    graphics.fillRect(30, 21, 2, 2)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(13, 17, 7, 2)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(28, 17, 7, 2)
    graphics.fillStyle(0x4a4a4a)
    graphics.fillRect(20, 32, 8, 2)
    graphics.fillStyle(suitColor)
    graphics.fillRect(8, 36, 14, 24)
    graphics.fillRect(26, 36, 14, 24)
    graphics.fillStyle(shirtColor)
    graphics.fillRect(22, 36, 4, 24)
    graphics.fillRect(20, 36, 8, 6)
    graphics.fillStyle(tieColor)
    graphics.fillRect(22, 40, 4, 12)
    graphics.fillRect(21, 38, 6, 4)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(8, 36, 4, 20)
    graphics.fillStyle(0x1a1a1a)
    graphics.fillRect(36, 36, 4, 20)
    graphics.fillStyle(0xf5d0b0)
    graphics.fillStyle(0xf5d0b0)
    graphics.fillRect(20, 34, 8, 4)
    graphics.fillStyle(suitColor)
    graphics.fillRect(2, 40, 8, 14)
    graphics.fillRect(38, 40, 8, 14)
    graphics.fillStyle(0xf5d0b0)
    graphics.fillRect(2, 52, 6, 6)
    graphics.fillRect(40, 52, 6, 6)
    graphics.fillStyle(0xffffff)
    graphics.fillRect(32, 42, 4, 3)
    graphics.generateTexture(MANAGER_FALLBACK_CONFIG.texture, 48, 60)
  }
}
