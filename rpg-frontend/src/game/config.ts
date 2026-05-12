export interface SpriteSheetConfig {
  path: string
  frameWidth: number
  frameHeight: number
  frameRate: number
}

export interface CharacterConfig {
  key: string
  type: 'spritesheet' | 'fallback'
  spritesheets?: {
    idle: SpriteSheetConfig
    walk: SpriteSheetConfig
  }
  fallbackKey?: string
  scale: number
  /**
   * 可选：小人高度相对于 tile 高度的倍数。
   * 如果设置，会自动根据地图 tileHeight 计算显示 scale，保持跨地图比例一致。
   * 例如 2.5 表示小人高度 = 2.5 个 tile 高度。
   * 不设置时回退到固定 scale。
   */
  tileRelativeScale?: number
  shadow: {
    offsetY: number
    width: number
    height: number
  }
  nameLabelOffsetY: number
  footprint: {
    width: number
    height: number
    offsetY: number
  }
}

export interface TilesetConfig {
  name: string
  imagePath: string
  imageKey: string
}

export interface SceneConfig {
  key: string
  description?: string
  mapPath: string
  tilesetName: string
  tilesetImagePath: string
  tilesetImageKey: string
  additionalTilesets?: TilesetConfig[]
  layers: string[]
  collisionLayer: string
  /** 每个场景可单独设置角色的 tileRelativeScale，优先级高于角色全局配置 */
  characterScales?: Record<string, number>
}

export interface GameConfig {
  currentScene: string
  maxAgents: number
  scenes: Record<string, SceneConfig>
  characters: Record<string, CharacterConfig>
  ui: {
    bubble: {
      width: number
      height: number
      arrowHeight: number
      paddingY: number
      offsetY: number
      textMaxLen: number
      charsPerLine: number
    }
    footprint: {
      width: number
      height: number
      offsetY: number
    }
    spawnMargin: {
      x: number
      y: number
    }
    moveSpeed: number
    selectionRing: {
      width: number
      height: number
      offsetY: number
    }
  }
}
