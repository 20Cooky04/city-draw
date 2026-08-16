import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="sprite-walker" on the .city-grid container
// (see app/views/cells/index.html.erb).
//
// On connect, scans the currently-rendered viewport for pairs of adjacent
// (orthogonal, not diagonal), completed, same-category cells and spawns one
// placeholder sprite per pair. Each sprite then wanders indefinitely: on
// arriving at a cell it looks at all four orthogonal neighbors, and if any
// is a completed cell of the same category, picks one at random (any
// direction, including walking straight back the way it came -- pairs can
// be revisited freely) and walks there, routing around drawn strokes via a
// coarse occupancy grid + A* search. A sprite only stops if it hits a dead
// end (no valid neighbor) or the controller disconnects (e.g. on grid
// navigation).
//
// ART: sprites render bird.svg (nature) / car.svg (building), passed in as
// URLs via the natureImageUrl/buildingImageUrl values -- see
// buildSpriteElement(). Both source images face up/north as drawn, so
// rotation is computed from each leg's direction of travel and applied
// every frame (see headingAngle()/placeSprite()), keeping the sprite
// oriented correctly through turns at waypoints and between legs.
export default class extends Controller {
  static targets = ["cell"]
  static values = {
    // Local coordinate space strokes are stored in. Matches
    // GridConfig::DRAW_CANVAS_SIZE — passed in from the view so this file
    // never hardcodes it.
    drawCanvasSize: { type: Number, default: 300 },
    // How finely to rasterize strokes into an obstacle grid, in grid
    // cells per cell-side. Higher = more precise avoidance, more compute.
    gridResolution: { type: Number, default: 24 },
    // Padding (in local 0..drawCanvasSize units) around each stroke
    // segment that counts as blocked, so sprites don't graze the ink.
    strokePadding: { type: Number, default: 1 },
    // Moving speed in on-screen pixels per second.
    speed: { type: Number, default: 40 },
    // Asset URLs for the two sprite images, passed in from the view via
    // asset_path so this file never hardcodes a path. Keyed by cell
    // category, same as everything else here.
    natureImageUrl: { type: String, default: "" },
    buildingImageUrl: { type: String, default: "" },
    // Both source SVGs are drawn facing "up" (north) already, so 0 needs
    // no correction. If you swap in art that faces a different way,
    // adjust the matching offset here instead of touching rotation math.
    natureBaseAngle: { type: Number, default: 0 },
    buildingBaseAngle: { type: Number, default: 0 },
  }

  connect() {
    this.activeSprites = []
    this.byPosition = this.buildPositionIndex()
    this.spawnInitialSprites()
  }

  disconnect() {
    this.activeSprites.forEach(({ state, el }) => {
      state.cancelled = true
      el.remove()
    })
    this.activeSprites = []
  }

  buildPositionIndex() {
    const byPosition = new Map()
    this.cellTargets.forEach((el) => {
      byPosition.set(`${el.dataset.row},${el.dataset.column}`, el)
    })
    return byPosition
  }

  // --- Initial spawn: one sprite per adjacent same-category pair -----------

  spawnInitialSprites() {
    const seenPairs = new Set()

    this.cellTargets.forEach((cellEl) => {
      if (cellEl.dataset.completed !== "true") return

      const row = parseInt(cellEl.dataset.row, 10)
      const column = parseInt(cellEl.dataset.column, 10)
      const category = cellEl.dataset.category

      // Only look right and down here so each starting pair is only used
      // once at spawn time -- this just controls how many sprites appear
      // initially. Once walking, sprites are free to go any direction and
      // revisit the same pair as often as they like.
      const candidates = [`${row},${column + 1}`, `${row + 1},${column}`]

      candidates.forEach((key) => {
        const neighborEl = this.byPosition.get(key)
        if (!neighborEl) return
        if (neighborEl.dataset.completed !== "true") return
        if (neighborEl.dataset.category !== category) return

        const pairKey = `${cellEl.dataset.row},${cellEl.dataset.column}->${key}`
        if (seenPairs.has(pairKey)) return
        seenPairs.add(pairKey)

        const homeCell = Math.random() < 0.5 ? cellEl : neighborEl
        this.spawnSprite(homeCell, category)
      })
    })
  }

  spawnSprite(homeCell, category) {
    const resolution = this.gridResolutionValue
    const localSize = this.drawCanvasSizeValue

    const grid = this.buildSingleCellOccupancyGrid(homeCell, localSize, resolution)
    const wholeCellRegion = { minCol: 0, maxCol: resolution - 1, minRow: 0, maxRow: resolution - 1 }
    const startLocal =
      this.randomFreeGridCell(grid, wholeCellRegion) ||
      { col: Math.floor(resolution / 2), row: Math.floor(resolution / 2) }

    const spriteEl = this.buildSpriteElement(category, homeCell)
    this.element.appendChild(spriteEl)

    const startPoint = this.cellLocalPointToScreen(
      this.gridCellToLocalPoint(startLocal, localSize, resolution),
      homeCell,
      localSize
    )
    // No movement yet, so just face the art's natural resting direction.
    const state = { cancelled: false, angle: this.baseAngleFor(category) }
    this.placeSprite(spriteEl, startPoint.x, startPoint.y, state.angle)

    this.activeSprites.push({ state, el: spriteEl })

    this.walkNextLeg(state, spriteEl, homeCell, startLocal, category)
  }

  // --- Continuous wandering: one leg at a time ------------------------------

  // currentLocal is the sprite's position expressed in the *current cell's
  // own* local grid (0..resolution-1 on each axis, no pair offset), so it
  // stays meaningful no matter which neighbor gets picked next.
  walkNextLeg(state, spriteEl, currentCell, currentLocal, category) {
    if (state.cancelled) return

    const neighborInfo = this.pickRandomNeighbor(currentCell, category)
    if (!neighborInfo) {
      // Dead end -- no valid same-category neighbor to walk to. Better to
      // remove the sprite than have it stand there forever; a fresh one
      // may spawn here next time the viewport reloads.
      spriteEl.remove()
      return
    }

    const { neighborEl, axis, direction } = neighborInfo
    const resolution = this.gridResolutionValue
    const localSize = this.drawCanvasSizeValue

    // buildOccupancyGrid always expects cellA to be the left/top cell and
    // cellB the right/bottom cell, regardless of which way the sprite is
    // actually walking.
    const currentIsA = direction === "right" || direction === "down"
    const cellA = currentIsA ? currentCell : neighborEl
    const cellB = currentIsA ? neighborEl : currentCell
    const currentRole = currentIsA ? "A" : "B"
    const neighborRole = currentIsA ? "B" : "A"

    const grid = this.buildOccupancyGrid(cellA, cellB, axis, localSize, resolution)

    let startCombined = this.localToCombined(currentLocal, currentRole, axis, resolution)
    if (this.isBlocked(grid, startCombined)) {
      startCombined = this.randomFreeGridCell(grid, this.regionFor(currentRole, axis, resolution))
    }

    const targetCombined = this.randomFreeGridCell(grid, this.regionFor(neighborRole, axis, resolution))

    if (!startCombined || !targetCombined) {
      // Neighbor cell (or sprite's own cell) is fully inked over -- nowhere
      // free to stand. Skip this move; try again from wherever we are.
      spriteEl.remove()
      return
    }

    let path = this.findPath(grid, startCombined, targetCombined)
    // Fallback: if no route exists through the occupancy grid (e.g. a
    // stroke fully partitions the two cells), just walk straight through.
    // Not real avoidance, but keeps the sprite from getting stuck forever.
    if (!path) path = [startCombined, targetCombined]

    const localWaypoints = path.map((gc) => this.gridCellToLocalPoint(gc, localSize, resolution))
    const screenWaypoints = localWaypoints.map((pt) =>
      this.localPointToScreen(pt, axis, cellA, cellB, localSize)
    )

    const nextLocal = this.combinedToLocal(targetCombined, neighborRole, axis, resolution)

    this.animateLeg(state, spriteEl, screenWaypoints, category, () => {
      this.walkNextLeg(state, spriteEl, neighborEl, nextLocal, category)
    })
  }

  // Looks at all four orthogonal neighbors of cellEl and returns a random
  // one that's a completed, same-category cell currently in the viewport.
  // Returns null if there's nowhere valid to go (a dead end).
  pickRandomNeighbor(cellEl, category) {
    const row = parseInt(cellEl.dataset.row, 10)
    const column = parseInt(cellEl.dataset.column, 10)

    const candidates = [
      { key: `${row},${column + 1}`, axis: "horizontal", direction: "right" },
      { key: `${row},${column - 1}`, axis: "horizontal", direction: "left" },
      { key: `${row + 1},${column}`, axis: "vertical", direction: "down" },
      { key: `${row - 1},${column}`, axis: "vertical", direction: "up" },
    ]

    const valid = candidates.filter(({ key }) => {
      const el = this.byPosition.get(key)
      return el && el.dataset.completed === "true" && el.dataset.category === category
    })

    if (valid.length === 0) return null

    const chosen = valid[Math.floor(Math.random() * valid.length)]
    return {
      neighborEl: this.byPosition.get(chosen.key),
      axis: chosen.axis,
      direction: chosen.direction,
    }
  }

  // --- Occupancy grid: rasterizing strokes into blocked cells --------------

  // Builds a combined occupancy grid spanning cellA and cellB side by side
  // (horizontal) or stacked (vertical). Grid coordinates are {col, row}
  // where col/row run 0..(resolution*2 - 1) along the combined axis and
  // 0..(resolution - 1) along the other axis.
  buildOccupancyGrid(cellA, cellB, axis, localSize, resolution) {
    const cols = axis === "horizontal" ? resolution * 2 : resolution
    const rows = axis === "vertical" ? resolution * 2 : resolution

    const blocked = Array.from({ length: rows }, () => new Array(cols).fill(false))
    const grid = { cols, rows, blocked }

    const colOffsetA = 0
    const rowOffsetA = 0
    const colOffsetB = axis === "horizontal" ? resolution : 0
    const rowOffsetB = axis === "vertical" ? resolution : 0

    this.rasterizeCellStrokes(cellA, grid, colOffsetA, rowOffsetA, localSize, resolution)
    this.rasterizeCellStrokes(cellB, grid, colOffsetB, rowOffsetB, localSize, resolution)

    return grid
  }

  // Single-cell version of the above, used when a sprite spawns (before it
  // has picked a direction to walk in yet).
  buildSingleCellOccupancyGrid(cellEl, localSize, resolution) {
    const blocked = Array.from({ length: resolution }, () => new Array(resolution).fill(false))
    const grid = { cols: resolution, rows: resolution, blocked }
    this.rasterizeCellStrokes(cellEl, grid, 0, 0, localSize, resolution)
    return grid
  }

  rasterizeCellStrokes(cellEl, grid, colOffset, rowOffset, localSize, resolution) {
    if (cellEl.dataset.completed !== "true") return
    if (!cellEl.dataset.strokes) return

    let strokes
    try {
      strokes = JSON.parse(cellEl.dataset.strokes)
    } catch (e) {
      return // malformed/missing strokes — treat cell as empty rather than crash
    }

    const cellLocalSize = localSize / resolution // size of one grid cell, in local units
    const paddingCells = Math.max(1, Math.ceil(this.strokePaddingValue / cellLocalSize))
    const stepSize = cellLocalSize / 2 // sample interval along each segment

    strokes.forEach((stroke) => {
      for (let i = 0; i < stroke.length - 1; i++) {
        this.markSegmentBlocked(
          grid, stroke[i], stroke[i + 1], colOffset, rowOffset,
          cellLocalSize, paddingCells, stepSize
        )
      }
      // Single-point strokes (shouldn't normally happen, but be safe)
      if (stroke.length === 1) {
        this.markPointBlocked(grid, stroke[0], colOffset, rowOffset, cellLocalSize, paddingCells)
      }
    })
  }

  markSegmentBlocked(grid, p1, p2, colOffset, rowOffset, cellLocalSize, paddingCells, stepSize) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const length = Math.sqrt(dx * dx + dy * dy)
    const steps = Math.max(1, Math.ceil(length / stepSize))

    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const point = { x: p1.x + dx * t, y: p1.y + dy * t }
      this.markPointBlocked(grid, point, colOffset, rowOffset, cellLocalSize, paddingCells)
    }
  }

  markPointBlocked(grid, point, colOffset, rowOffset, cellLocalSize, paddingCells) {
    const centerCol = Math.floor(point.x / cellLocalSize) + colOffset
    const centerRow = Math.floor(point.y / cellLocalSize) + rowOffset

    for (let dRow = -paddingCells; dRow <= paddingCells; dRow++) {
      for (let dCol = -paddingCells; dCol <= paddingCells; dCol++) {
        const col = centerCol + dCol
        const row = centerRow + dRow
        if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) continue
        grid.blocked[row][col] = true
      }
    }
  }

  // --- Region + free-cell helpers ------------------------------------------

  // Returns the {minCol, maxCol, minRow, maxRow} sub-region of the combined
  // grid that belongs to "A" or "B" for the given axis.
  regionFor(which, axis, resolution) {
    if (axis === "horizontal") {
      return which === "A"
        ? { minCol: 0, maxCol: resolution - 1, minRow: 0, maxRow: resolution - 1 }
        : { minCol: resolution, maxCol: resolution * 2 - 1, minRow: 0, maxRow: resolution - 1 }
    } else {
      return which === "A"
        ? { minCol: 0, maxCol: resolution - 1, minRow: 0, maxRow: resolution - 1 }
        : { minCol: 0, maxCol: resolution - 1, minRow: resolution, maxRow: resolution * 2 - 1 }
    }
  }

  randomFreeGridCell(grid, region, attempts = 40) {
    for (let i = 0; i < attempts; i++) {
      const col = region.minCol + Math.floor(Math.random() * (region.maxCol - region.minCol + 1))
      const row = region.minRow + Math.floor(Math.random() * (region.maxRow - region.minRow + 1))
      if (!grid.blocked[row][col]) return { col, row }
    }
    // Fall back to scanning for any free cell in the region.
    for (let row = region.minRow; row <= region.maxRow; row++) {
      for (let col = region.minCol; col <= region.maxCol; col++) {
        if (!grid.blocked[row][col]) return { col, row }
      }
    }
    return null // region is entirely blocked
  }

  // Converts a position from a single cell's own local grid (0..resolution-1,
  // no offset) into the combined pair grid, based on whether that cell is
  // playing the "A" or "B" role for this particular leg.
  localToCombined(local, role, axis, resolution) {
    const colOffset = role === "B" && axis === "horizontal" ? resolution : 0
    const rowOffset = role === "B" && axis === "vertical" ? resolution : 0
    return { col: local.col + colOffset, row: local.row + rowOffset }
  }

  // Inverse of localToCombined.
  combinedToLocal(combined, role, axis, resolution) {
    const colOffset = role === "B" && axis === "horizontal" ? resolution : 0
    const rowOffset = role === "B" && axis === "vertical" ? resolution : 0
    return { col: combined.col - colOffset, row: combined.row - rowOffset }
  }

  isBlocked(grid, gc) {
    if (!gc) return true
    if (gc.row < 0 || gc.row >= grid.rows || gc.col < 0 || gc.col >= grid.cols) return true
    return grid.blocked[gc.row][gc.col]
  }

  // --- A* pathfinding over the occupancy grid -------------------------------

  findPath(grid, start, target) {
    const key = (c) => `${c.col},${c.row}`
    const open = new Map() // key -> node
    const closed = new Set()

    const startNode = { ...start, g: 0, h: this.heuristic(start, target), parent: null }
    startNode.f = startNode.g + startNode.h
    open.set(key(start), startNode)

    const neighborsOf = (node) => {
      const deltas = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ]
      return deltas
        .map(([dCol, dRow]) => ({ col: node.col + dCol, row: node.row + dRow }))
        .filter(
          (c) => c.col >= 0 && c.col < grid.cols && c.row >= 0 && c.row < grid.rows &&
                 !grid.blocked[c.row][c.col]
        )
    }

    let iterations = 0
    const maxIterations = grid.cols * grid.rows * 4 // safety valve

    while (open.size > 0 && iterations < maxIterations) {
      iterations++

      let current = null
      for (const node of open.values()) {
        if (!current || node.f < current.f) current = node
      }

      if (current.col === target.col && current.row === target.row) {
        return this.reconstructPath(current)
      }

      open.delete(key(current))
      closed.add(key(current))

      neighborsOf(current).forEach((neighborPos) => {
        const nKey = key(neighborPos)
        if (closed.has(nKey)) return

        const isDiagonal = neighborPos.col !== current.col && neighborPos.row !== current.row
        const g = current.g + (isDiagonal ? Math.SQRT2 : 1)

        const existing = open.get(nKey)
        if (existing && g >= existing.g) return

        const node = {
          ...neighborPos,
          g,
          h: this.heuristic(neighborPos, target),
          parent: current,
        }
        node.f = node.g + node.h
        open.set(nKey, node)
      })
    }

    return null // no path found
  }

  heuristic(a, b) {
    // Octile distance — matches 8-directional movement cost above.
    const dx = Math.abs(a.col - b.col)
    const dy = Math.abs(a.row - b.row)
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy)
  }

  reconstructPath(node) {
    const path = []
    let current = node
    while (current) {
      path.push({ col: current.col, row: current.row })
      current = current.parent
    }
    return path.reverse()
  }

  // --- Coordinate conversion -------------------------------------------------

  gridCellToLocalPoint(gridCell, localSize, resolution) {
    const cellLocalSize = localSize / resolution
    return {
      x: (gridCell.col + 0.5) * cellLocalSize,
      y: (gridCell.row + 0.5) * cellLocalSize,
    }
  }

  // Converts a point in a single cell's own local coordinate space
  // (0..localSize on each axis) into screen pixels, for use before a
  // sprite has picked a direction to walk in.
  cellLocalPointToScreen(point, cellEl, localSize) {
    return {
      x: cellEl.offsetLeft + (point.x / localSize) * cellEl.offsetWidth,
      y: cellEl.offsetTop + (point.y / localSize) * cellEl.offsetHeight,
    }
  }

  // Converts a point in the combined local coordinate space (0..localSize
  // for the "A" half, localSize..2*localSize for the "B" half, along the
  // pair's axis) into screen pixels, using whichever cell element that
  // point actually falls in. This is what keeps sprites correctly
  // positioned relative to the grid regardless of CELL_SIZE/layout.
  localPointToScreen(point, axis, cellA, cellB, localSize) {
    let cell, xInCell, yInCell

    if (axis === "horizontal") {
      if (point.x < localSize) {
        cell = cellA
        xInCell = point.x
      } else {
        cell = cellB
        xInCell = point.x - localSize
      }
      yInCell = point.y
    } else {
      if (point.y < localSize) {
        cell = cellA
        yInCell = point.y
      } else {
        cell = cellB
        yInCell = point.y - localSize
      }
      xInCell = point.x
    }

    return {
      x: cell.offsetLeft + (xInCell / localSize) * cell.offsetWidth,
      y: cell.offsetTop + (yInCell / localSize) * cell.offsetHeight,
    }
  }

  // --- Sprite element + animation --------------------------------------------

  buildSpriteElement(category, referenceCell) {
    const size = Math.max(8, referenceCell.offsetWidth / 6)
    const imageUrl = category === "nature" ? this.natureImageUrlValue : this.buildingImageUrlValue

    const el = document.createElement("div")
    el.className = `sprite-placeholder sprite-placeholder--${category}`
    el.style.width = `${size}px`
    el.style.height = `${size}px`

    const img = document.createElement("img")
    img.src = imageUrl
    img.alt = ""
    img.draggable = false
    el.appendChild(img)

    return el
  }

  baseAngleFor(category) {
    return category === "nature" ? this.natureBaseAngleValue : this.buildingBaseAngleValue
  }

  // Positions el (top-left anchor at x,y, then centered via transform) and
  // rotates it to angleDeg. Rotation is measured clockwise from the art's
  // drawn-facing direction (both bird.svg and car.svg face up/north as
  // drawn, so 0deg = facing up), matching the convention used in
  // headingAngle() below.
  placeSprite(el, x, y, angleDeg) {
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`
  }

  // Converts a screen-space movement vector into a rotation for art that
  // faces up/north at 0deg. atan2 measures clockwise from "facing right"
  // in screen coordinates (y grows downward), so adding 90deg re-bases it
  // to measure clockwise from "facing up" instead.
  headingAngle(dx, dy, baseAngle) {
    return (Math.atan2(dy, dx) * 180) / Math.PI + 90 + baseAngle
  }

  // Walks el along waypoints, calling onArrive() when it reaches the end
  // instead of removing it -- the caller decides what happens next (i.e.
  // walkNextLeg picks another neighbor and keeps going). Rotates el to
  // face the direction of travel each frame, so turns at waypoints (and
  // between legs) read as the sprite turning rather than sliding sideways.
  // Checks state.cancelled on every frame so disconnect() can halt mid-leg.
  animateLeg(state, el, waypoints, category, onArrive) {
    let segmentIndex = 0
    let segmentStart = performance.now()
    const speed = this.speedValue // px/sec
    const baseAngle = this.baseAngleFor(category)

    const step = (now) => {
      if (state.cancelled) return

      if (segmentIndex >= waypoints.length - 1) {
        onArrive()
        return
      }

      const from = waypoints[segmentIndex]
      const to = waypoints[segmentIndex + 1]
      const dx = to.x - from.x
      const dy = to.y - from.y
      const segmentLength = Math.sqrt(dx * dx + dy * dy)
      const segmentDuration = Math.max(1, (segmentLength / speed) * 1000) // ms

      // Zero-length segments (can happen at path fallbacks) keep facing
      // whichever direction the sprite was already heading.
      if (dx !== 0 || dy !== 0) {
        state.angle = this.headingAngle(dx, dy, baseAngle)
      }

      const elapsed = now - segmentStart
      const t = Math.min(1, elapsed / segmentDuration)

      this.placeSprite(el, from.x + dx * t, from.y + dy * t, state.angle)

      if (t >= 1) {
        segmentIndex++
        segmentStart = now
      }

      requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  }
}
