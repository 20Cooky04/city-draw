import { Controller } from "@hotwired/stimulus"

// Connects to data-controller="canvas-drawer"
//
// Usage (see _canvas.html.erb for the full markup):
//
//   <div data-controller="canvas-drawer"
//        data-canvas-drawer-cell-id-value="<%= cell.id %>"
//        data-canvas-drawer-update-url-value="<%= cell_path(cell) %>"
//        data-canvas-drawer-duration-value="300">
//     <canvas data-canvas-drawer-target="canvas"></canvas>
//     <span data-canvas-drawer-target="timer"></span>
//     <button data-action="canvas-drawer#undo">Undo</button>
//     <button data-action="canvas-drawer#finish">Done</button>
//   </div>
//
export default class extends Controller {
  static targets = ["canvas", "timer", "undoButton", "finishButton", "discardButton"]
  static values = {
    cellId: Number,
    updateUrl: String,
    returnUrl: { type: String, default: "/grid" },
    duration: { type: Number, default: 300 }, // seconds
    lineWidth: { type: Number, default: 3 },
    // Minimum distance (in canvas px) between kept points before smoothing.
    // Higher = smoother/looser curve, lower = closer to the exact trace.
    smoothing: { type: Number, default: 8 },
  }

  connect() {
    this.strokes = []          // array of strokes; each stroke is array of {x, y}
    this.currentStroke = null
    this.submitted = false

    this.setupCanvas()
    this.startTimer()

    // Bound handlers so we can add/remove them cleanly
    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)

    const canvas = this.canvasTarget
    canvas.addEventListener("pointerdown", this.onPointerDown)
    canvas.addEventListener("pointermove", this.onPointerMove)
    canvas.addEventListener("pointerup", this.onPointerUp)
    canvas.addEventListener("pointercancel", this.onPointerUp)
    canvas.addEventListener("pointerleave", this.onPointerUp)

    // Prevent the browser from scrolling/zooming while drawing on touch devices
    canvas.style.touchAction = "none"
  }

  disconnect() {
    clearInterval(this.timerInterval)
    const canvas = this.canvasTarget
    canvas.removeEventListener("pointerdown", this.onPointerDown)
    canvas.removeEventListener("pointermove", this.onPointerMove)
    canvas.removeEventListener("pointerup", this.onPointerUp)
    canvas.removeEventListener("pointercancel", this.onPointerUp)
    canvas.removeEventListener("pointerleave", this.onPointerUp)
  }

  // --- Canvas setup -------------------------------------------------------

  setupCanvas() {
    const canvas = this.canvasTarget
    const ratio = window.devicePixelRatio || 1

    // CSS size stays whatever the layout gives it; backing store scales for sharpness
    const cssWidth = canvas.clientWidth
    const cssHeight = canvas.clientHeight

    canvas.width = cssWidth * ratio
    canvas.height = cssHeight * ratio

    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    const ctx = canvas.getContext("2d")
    ctx.scale(ratio, ratio)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#000000"
    ctx.lineWidth = this.lineWidthValue

    this.ctx = ctx
  }

  // Coordinates stored are in CSS pixels (not device pixels), so they stay
  // consistent regardless of screen density and are cheap to store/replay.
  pointFromEvent(event) {
    const rect = this.canvasTarget.getBoundingClientRect()
    return {
      x: Math.round((event.clientX - rect.left) * 100) / 100,
      y: Math.round((event.clientY - rect.top) * 100) / 100,
    }
  }

  // --- Drawing --------------------------------------------------------------

  onPointerDown(event) {
    if (this.submitted) return
    event.preventDefault()
    this.canvasTarget.setPointerCapture(event.pointerId)

    const point = this.pointFromEvent(event)
    this.currentStroke = [point]

    this.ctx.beginPath()
    this.ctx.moveTo(point.x, point.y)
  }

  onPointerMove(event) {
    if (!this.currentStroke || this.submitted) return
    event.preventDefault()

    const point = this.pointFromEvent(event)
    this.currentStroke.push(point)

    this.ctx.lineTo(point.x, point.y)
    this.ctx.stroke()
  }

  onPointerUp(event) {
    if (!this.currentStroke) return

    // Drop accidental taps that produced no real movement
    if (this.currentStroke.length > 1) {
      const simplified = this.simplifyStroke(this.currentStroke)
      // A stroke needs at least 2 points to draw; fall back to the
      // original if simplifying somehow collapsed it further.
      this.strokes.push(simplified.length > 1 ? simplified : this.currentStroke)
      // Replace the raw live-drawn path with its smoothed version now
      // that the stroke is finished.
      this.redrawAll()
    }
    this.currentStroke = null
    this.updateUndoButton()
  }

  // Drops points that fall within `smoothingValue` px of the last kept
  // point. Fewer, more spread-out points make the quadratic curve in
  // redrawAll() bend more smoothly; more points hug the original trace
  // more closely. Always keeps the first and last point of the stroke.
  simplifyStroke(stroke) {
    if (this.smoothingValue <= 0 || stroke.length <= 2) return stroke
 
    const kept = [stroke[0]]
    for (let i = 1; i < stroke.length - 1; i++) {
      const last = kept[kept.length - 1]
      const point = stroke[i]
      const dx = point.x - last.x
      const dy = point.y - last.y
      if (Math.sqrt(dx * dx + dy * dy) >= this.smoothingValue) {
        kept.push(point)
      }
    }
    kept.push(stroke[stroke.length - 1])
    return kept
  }

  undo() {
    if (this.submitted || this.strokes.length === 0) return
    this.strokes.pop()
    this.redrawAll()
    this.updateUndoButton()
  }

  drawSmoothStroke(ctx, stroke) {
    if (stroke.length < 3) {
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      stroke.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
      return
    }
    ctx.beginPath()
    ctx.moveTo(stroke[0].x, stroke[0].y)
    for (let i = 1; i < stroke.length - 1; i++) {
      const xc = (stroke[i].x + stroke[i + 1].x) / 2
      const yc = (stroke[i].y + stroke[i + 1].y) / 2
      ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, xc, yc)
    }
    ctx.stroke()
  }

  redrawAll() {
    const canvas = this.canvasTarget
    const ratio = window.devicePixelRatio || 1
    this.ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio)

    for (const stroke of this.strokes) {
      this.drawSmoothStroke(this.ctx, stroke)
    }
  }

  updateUndoButton() {
    if (this.hasUndoButtonTarget) {
      this.undoButtonTarget.disabled = this.strokes.length === 0
    }
  }

  // --- Timer ------------------------------------------------------------

  startTimer() {
    this.remainingSeconds = this.durationValue
    this.renderTimer()

    this.timerInterval = setInterval(() => {
      this.remainingSeconds -= 1
      this.renderTimer()

      if (this.remainingSeconds <= 0) {
        clearInterval(this.timerInterval)
        this.finish()
      }
    }, 1000)
  }

  renderTimer() {
    if (!this.hasTimerTarget) return
    const minutes = Math.max(0, Math.floor(this.remainingSeconds / 60))
    const seconds = Math.max(0, this.remainingSeconds % 60)
    this.timerTarget.textContent =
      `${minutes}:${seconds.toString().padStart(2, "0")}`
  }

  // --- Discard ---------------------------------------------------------------

  // Leaves without persisting anything — no fetch, strokes are just discarded.
  discard() {
    if (this.submitted) return

    // Only bother asking if there's actually something to lose.
    if (this.strokes.length > 0) {
      const confirmed = window.confirm("Discard this drawing?")
      if (!confirmed) return
    }

    this.submitted = true
    clearInterval(this.timerInterval)
    window.location.href = this.returnUrlValue
  }

  // --- Submission ---------------------------------------------------------

  async finish() {
    if (this.submitted) return
    this.submitted = true
    clearInterval(this.timerInterval)

    if (this.hasFinishButtonTarget) {
      this.finishButtonTarget.disabled = true
      this.finishButtonTarget.textContent = "Saving…"
    }

    try {
      const response = await fetch(this.updateUrlValue, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": this.csrfToken(),
          "Accept": "application/json",
        },
        body: JSON.stringify({
          cell: {
            strokes: JSON.stringify(this.strokes),
            completed: true,
          },
        }),
      })

      if (!response.ok) throw new Error(`Save failed: ${response.status}`)

      this.dispatch("saved", { detail: { cellId: this.cellIdValue } })
      window.location.href = this.returnUrlValue
    } catch (error) {
      this.submitted = false
      if (this.hasFinishButtonTarget) {
        this.finishButtonTarget.disabled = false
        this.finishButtonTarget.textContent = "Done (retry save)"
      }
      console.error("Failed to save cell strokes", error)
    }
  }

  csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]')
    return meta && meta.content
  }
}
