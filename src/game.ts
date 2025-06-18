import { Point, ThingLike, Color, Game, IPainter, TextOpts, Rect, Key, hex } from "@vaguevoid/sdk"
import { level, LevelConfig, EntityConfig } from "./level"
import Stats from "stats.js"

interface Inputs { // TODO: get sdk to export this
  isKeyHeld: (key: Key) => boolean
}

//=============================================================================
// CONSTANTS
//=============================================================================

const FPS      = 60,
      STEP     = 1/FPS,
      METER    = 32,
      GRAVITY  = 9.8 * 5, // default (exagerated) gravity
      MAXDX    = 15,      // default max horizontal speed (15 tiles per second)
      MAXDY    = 60,      // default max vertical speed   (60 tiles per second)
      ACCEL    = 1/2,     // default take 1/2 second to reach maxdx (horizontal acceleration)
      FRICTION = 1/6,     // default take 1/6 second to stop from maxdx (horizontal friction)
      IMPULSE  = 1500;    // default player jump impulse

const COLOR = {
  WHITE: hex('#FFFFFF'),
  BLACK: hex('#000000'),
  YELLOW: hex('#ECD078'),
  BRICK: hex('#D95B43'),
  PINK: hex('#C02942'),
  PURPLE: hex('#542437'),
  GREY: hex('#333333'),
  GOLD: hex('#FFD700'),
  SLATE: hex('#53777A'),
};

const FONT: Record<string, Partial<TextOpts>> = {
  HELP: {
    fontFamily: "Arial",
    fontSize: 32,
    color: COLOR.WHITE,
  }
}

enum TileType {
  Yellow = 1,
  Brick = 2,
  Pink = 3,
  Purple = 4,
  Grey = 5,
}

const TileColor: Record<TileType, Color> = {
  [TileType.Yellow]: COLOR.YELLOW,
  [TileType.Brick]: COLOR.BRICK,
  [TileType.Pink]: COLOR.PINK,
  [TileType.Purple]: COLOR.PURPLE,
  [TileType.Grey]: COLOR.GREY,
}

enum Direction {
  Left = "left",
  Right = "right",
  None = "none",
}

enum EntityType {
  Player = "player",
  Monster = "monster",
  Treasure = "treasure",
}

//=============================================================================
// STATE
//=============================================================================

interface Size {
  width: number,
  height: number,
}

interface WithColor {
  color?: Color,
}

type Paintable = Point & Size & WithColor

interface Tile extends Paintable {
  type: TileType
}

interface Entity extends Paintable, ThingLike {
  type: EntityType
  x: number
  y: number
  width: number
  height: number
  dx: number
  dy: number
  ddx: number
  ddy: number
  gravity: number
  maxdx: number
  maxdy: number
  impulse: number
  accel: number
  friction: number
  dir: Direction
  falling: boolean
}

interface Treasure extends Entity {
  collected: boolean
}

interface Monster extends Entity {
  dead: boolean
}

interface Player extends Entity {
  jump: boolean
  jumping: boolean
  collected: number
  killed: number
  origin: { x: number, y: number }
}

interface State {
  dt: number
  grid: Size,
  tile: Size,
  tiles: (Tile | undefined)[][]
  monsters: Monster[]
  treasure: Treasure[]
  player: Player
  gobs: ThingLike[]
  background: Paintable
  cloud: boolean
}

function empty(): State {
  return {
    cloud: true
  } as State
}

function load(state: State, screen: Rect) {
  const scale = {
    x: screen.width / (level.grid.width * level.tile.width),
    y: screen.height / (level.grid.height * level.tile.height),
  }

  const tile = {
    width: level.tile.width * scale.x,
    height: level.tile.height * scale.y,
  }

  console.log("START", "SCREEN", screen, "SCALE", scale, "TILE", tile)

  state.dt = 0
  state.grid = level.grid
  state.tiles = loadTiles(level, tile)
  state.tile = tile
  state.monsters = loadMonsters(level, scale)
  state.treasure = loadTreasures(level, scale)
  state.player = loadPlayer(level, scale)
  state.gobs = [state.player]
  state.gobs = state.gobs.concat(state.monsters)
  state.gobs = state.gobs.concat(state.treasure)
  state.background = {
    x: screen.x + screen.width/2,
    y: screen.y + screen.height/2,
    width: screen.width,
    height: screen.height,
    color: COLOR.BLACK,
  }
}

function loadTiles(level: LevelConfig, size: Size): Tile[][] {
  const tiles: Tile[][] = []
  const nx = level.grid.width
  const ny = level.grid.height
  for (let x = 0 ; x < nx ; x++) {
    tiles[x] = []
    for (let y = 0 ; y < ny ; y++) {
      const type = level.tiles[x + y * nx] as TileType
      if (type) {
        tiles[x][y] = {
          type,
          x: x * size.width + (size.width/2),
          y: y * size.height + (size.height/2),
          width: size.width,
          height: size.height,
          color: TileColor[type]
        }
      }
    }
  }
  return tiles
}

function loadEntity(e: EntityConfig, scale: Point): Entity { 
  const maxdx    = METER * scale.x * (e.properties.maxdx ?? MAXDX)
  const maxdy    = METER * scale.y * (e.properties.maxdy ?? MAXDY)
  const gravity  = METER * scale.y * (e.properties.gravity ?? GRAVITY)
  const impulse  = METER * scale.y * (e.properties.impulse ?? IMPULSE)
  const accel    = maxdx / (e.properties.accel ?? ACCEL)
  const friction = maxdx / (e.properties.friction ?? FRICTION)
  return {
    id: id(e),
    type: e.type as EntityType,
    dir: (e.properties.dir as Direction) ?? Direction.None,
    falling: false,
    x: e.x * scale.x + (e.width * scale.x/2),
    y: e.y * scale.y + (e.height * scale.y/2),
    width: e.width * scale.x,
    height: e.height * scale.y,
    dx: 0, ddx: 0, maxdx,
    dy: 0, ddy: 0, maxdy,
    gravity,
    impulse,
    accel,
    friction,
  }
}

function loadPlayer(level: LevelConfig, scale: Point): Player {
  const config = level.entities.find((e) => e.type === EntityType.Player)
  if (!config)
    throw new Error("player not found in level config")
  const entity = loadEntity(config, scale)
  return {
    ...entity,
    color: COLOR.WHITE,
    jump: false,
    jumping: false,
    collected: 0,
    killed: 0,
    origin: { x: entity.x, y: entity.y },
  }
}

function loadMonsters(level: LevelConfig, scale: Point) {
  return level.entities
    .filter((e) => e.type === EntityType.Monster)
    .map((m) => ({
      ...loadEntity(m, scale),
      color: COLOR.SLATE,
      dead: false,
    }))
}

function loadTreasures(level: LevelConfig, scale: Point) {
  return level.entities
    .filter((e) => e.type === EntityType.Treasure)
    .map((t) => ({
      ...loadEntity(t, scale),
      color: COLOR.PURPLE,
      collected: false,
    }))
}

let monsterId = 0
let treasureId = 0

function id(e: EntityConfig) {
  switch (e.type) {
    case EntityType.Player: return "player"
    case EntityType.Monster: return `monster-${monsterId++}`
    case EntityType.Treasure: return `treasure-${treasureId++}`
    default:
      throw new Error(`unexpected entity type ${e.type}`)
  }
}

//=============================================================================
// DOM ELEMENTS
//=============================================================================

const updateStats = new Stats()
const paintStats = new Stats()
const fpsStats = new Stats()

updateStats.showPanel(1)
paintStats.showPanel(1)
fpsStats.showPanel(0)

updateStats.dom.style.cssText = 'position:fixed;bottom:0;left:0;transform:scale(2) translate(50%, -50%);cursor:pointer;opacity:0.9;z-index:10000';
paintStats.dom.style.cssText = 'position:fixed;bottom:0;right:0;transform:scale(2) translate(-50%, -50%);cursor:pointer;opacity:0.9;z-index:10000';
fpsStats.dom.style.cssText = 'position:fixed;bottom:0;margin: 0 auto;transform:scale(2) translate(0, -50%);cursor:pointer;opacity:0.9;z-index:10000';

document.body.appendChild(updateStats.dom)
document.body.appendChild(paintStats.dom)
document.body.appendChild(fpsStats.dom)

//=============================================================================
// UPDATE
//=============================================================================

function update(state: State, inputs: Inputs, dt: number) {
  fpsStats.begin()
  updateStats.begin()
  dt = STEP // TEMPORARY OVERRIDE VARIABLE dt WITH FIXED VALUE
  state.dt = state.dt + dt
  while (state.dt > STEP) {
    state.dt = state.dt - STEP
    state.player.jump = inputs.isKeyHeld(Key.Space)
    state.player.dir = inputs.isKeyHeld(Key.ArrowLeft) ? Direction.Left : inputs.isKeyHeld(Key.ArrowRight) ? Direction.Right : Direction.None
    updateMonsters(state, STEP)
    updatePlayer(state, STEP)
  }
  updateStats.end()
  fpsStats.end()
}

function updateMonsters(state: State, dt: number) {
  const player = state.player
  for(const monster of state.monsters) {
    if (!monster.dead) {
      updateEntity(state, monster, dt)
      if (overlap(player, monster)) {
        if ((player.dy > 0) && (monster.y - player.y > monster.height/2)) {
          player.killed++
          monster.dead = true
        } else {
          player.x = player.origin.x
          player.y = player.origin.y
          player.dx = player.dy = 0
        }
      }
    }
  }
}

function updatePlayer(state: State, dt: number) {
  const player = state.player
  updateEntity(state, player, dt)
  for(const treasure of state.treasure) {
    if (!treasure.collected && overlap(player, treasure)) {
      player.collected++
      treasure.collected = true
    }
  }
}

function updateEntity(state: State, entity: Entity, dt: number) {
  const wasLeft = entity.dx < 0
  const wasRight = entity.dx > 0
  const falling = entity.falling
  const friction = entity.friction * (falling ? 0.5 : 1)
  const accel = entity.accel * (falling ? 0.5 : 1)

  entity.ddx = 0
  entity.ddy = entity.gravity

  if (entity.dir === Direction.Left) {
    entity.ddx = entity.ddx - accel
  } else if (wasLeft) {
    entity.ddx = entity.ddx + friction
  }

  if (entity.dir === Direction.Right) {
    entity.ddx = entity.ddx + accel
  } else if (wasRight) {
    entity.ddx = entity.ddx - friction
  }

  if (isPlayer(entity) && entity.jump && !entity.jumping && !falling) {
    entity.ddy = entity.ddy - entity.impulse; // an instant big force impulse
    entity.jumping = true;
  }

  entity.x = entity.x + (dt * entity.dx)
  entity.y = entity.y + (dt * entity.dy)
  entity.dx = bound(entity.dx + (dt * entity.ddx), -entity.maxdx, entity.maxdx)
  entity.dy = bound(entity.dy + (dt * entity.ddy), -entity.maxdy, entity.maxdy)

  if ((wasLeft && (entity.dx > 0)) ||
      (wasRight && (entity.dx < 0))) {
    entity.dx = 0 // clamp at zero to prevent friction from making us jiggle side to side
  }

  let tx        = x2t(state, entity.x),
      ty        = y2t(state, entity.y),
      nx        = entity.x%state.tile.width,
      ny        = entity.y%state.tile.height,
      cell      = state.tiles[tx][ty],
      cellright = state.tiles[tx + 1][ty],
      celldown  = state.tiles[tx][ty + 1],
      celldiag  = state.tiles[tx + 1][ty + 1];

  if (entity.dy > 0) {
    if ((celldown && !cell) ||
        (celldiag && !cellright && nx)) {
      entity.y = t2y(state, ty);
      entity.dy = 0;
      entity.falling = false;
      if (isPlayer(entity))
        entity.jumping = false;
      ny = 0;
    }
  }
  else if (entity.dy < 0) {
    if ((cell      && !celldown) ||
        (cellright && !celldiag && nx)) {
      entity.y = t2y(state, ty + 1);
      entity.dy = 0;
      cell      = celldown;
      cellright = celldiag;
      ny        = 0;
    }
  }

  if (entity.dx > 0) {
    if ((cellright && !cell) ||
        (celldiag  && !celldown && ny)) {
      entity.x = t2x(state, tx);
      entity.dx = 0;
    }
  }
  else if (entity.dx < 0) {
    if ((cell     && !cellright) ||
        (celldown && !celldiag && ny)) {
      entity.x = t2x(state, tx + 1);
      entity.dx = 0;
    }
  }

  if (isMonster(entity)) {
    if (entity.dir === Direction.Left && (cell || !celldown)) {
      entity.dir = Direction.Right
    }      
    else if (entity.dir === Direction.Right && (cellright || !celldiag)) {
      entity.dir = Direction.Left
    }
  }

  entity.falling = ! (celldown || (nx && celldiag));

}

//=============================================================================
// PAINT
//=============================================================================

function paint(state: State, painter: IPainter, screen: Rect, frame: number) {
  paintStats.begin()
  paintTiles(state, painter)
  paintTreasure(state, painter, screen, frame)
  paintMonsters(state, painter, screen)
  paintPlayer(state, painter, screen)
  paintHelp(state, painter, screen)
  paintStats.end()
}

function paintTiles(state: State, painter: IPainter) {
  painter.rect(state.background)
  for (let y = 0 ; y < state.grid.height; y++) {
    for (let x = 0 ; x < state.grid.width; x++) {
      const tile = state.tiles[x][y]
      if (tile) {
        painter.rect(tile)
      }
    }
  }
}

function paintMonsters(state: State, painter: IPainter, _screen: Rect) {
  for (const monster of state.monsters) {
    if (!monster.dead) {
      painter.rect(monster)
    }
  }
}

function paintTreasure(state: State, painter: IPainter, _screen: Rect, frame: number) {
  for (const treasure of state.treasure) {
    if (!treasure.collected) {
      const alpha = 0.25 + tweenTreasure(frame, 60)
      const color = hex("#FFD700", alpha)
      painter.rect({...treasure, color})
    }
  }
}

function paintPlayer(state: State, painter: IPainter, _screen: Rect) {
  const player = state.player
  painter.rect(player)
  for(let n = 0 ; n < player.collected ; n++) {
    painter.rect({
      x: t2x(state, 2 + n),
      y: t2y(state, 2),
      width: state.tile.width/2,
      height: state.tile.height/2,
      color: COLOR.GOLD,
    })
  }
  for(let n = 0 ; n < player.killed ; n++) {
    painter.rect({
      x: t2x(state, 2 + n),
      y: t2y(state, 3),
      width: state.tile.width/2,
      height: state.tile.height/2,
      color: COLOR.SLATE,
    })
  }
}

function paintHelp(_state: State, painter: IPainter, screen: Rect) {
  const help = "ARROW keys to move, SPACE to jump"
  const { width, height } = painter.measureText(help, FONT.HELP)
  painter.text(help, { ...FONT.HELP, x: screen.width - width * 2/3, y: height * 3/2 })
}

//=============================================================================
// UTILITY METHODS
//=============================================================================

function isPlayer(e: Entity): e is Player { return e.type === EntityType.Player }
function isMonster(e: Entity): e is Monster { return e.type === EntityType.Monster }

function t2x(state: State, t: number) { return t*state.tile.width + state.tile.width/2 }
function t2y(state: State, t: number) { return t*state.tile.height + state.tile.height/2 }
function x2t(state: State, x: number) { return Math.floor((x-state.tile.width/2)/state.tile.width) }
function y2t(state: State, y: number) { return Math.floor((y-state.tile.height/2)/state.tile.height) }

function bound(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

function overlap(entity1: Entity, entity2: Entity) {
  const left1 = entity1.x - entity1.width/2
  const left2 = entity2.x - entity2.width/2
  const top1 = entity1.y - entity1.height/2
  const top2 = entity2.y - entity2.height/2
  return !(((left1 + entity1.width - 1) < left2) ||
           ((left2 + entity2.width - 1) < left1) ||
           ((top1 + entity1.height - 1) < top2) ||
           ((top2 + entity2.height - 1) < top1))
}

function tweenTreasure(frame: number, duration = 60) {
  const half = duration/2;
  const pulse = frame % duration;
  return pulse < half ? (pulse/half) : 1 - (pulse - half) / half;
}

//=============================================================================
// EXPORT THE GAME
//=============================================================================

const game = new Game(empty(), {
  start(state, { screen }) {
    load(state, screen)
  },
  update(state, { time, inputs }) {
    update(state, inputs, time.dt/1000)
  },
  paint(painter, { state, screen, frame }) {
    paint(state, painter, screen, frame)
  },
})

// @ts-expect-error - this doesn't exist on the Game API, yet
game.getGameObjects = (): ThingLike[] => {
  return game.context.state.gobs
}

export default game
