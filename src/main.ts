import { Rect } from "@vaguevoid/sdk"
import { mount } from "@vaguevoid/sdk/browser"
import game from "./game"

const canvas = document.getElementById("game") as HTMLCanvasElement
const width = canvas.width
const height = canvas.height

mount(game, canvas, {
  resolution: new Rect({
    width,
    height,
  })
})
