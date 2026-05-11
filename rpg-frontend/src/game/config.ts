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
