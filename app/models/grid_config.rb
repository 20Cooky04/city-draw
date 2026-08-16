# app/models/grid_config.rb
#
# Central place to tune the city grid's size and layout. Nothing else in
# the app should hardcode these numbers — reference GridConfig instead so
# resizing the city later is a one-line change.
module GridConfig
  # Full size of the city. Cells are pre-seeded across this entire range.
  TOTAL_ROWS = 10
  TOTAL_COLUMNS = 10

  # How many rows/columns are visible in the grid view at once. Must be
  # <= TOTAL_ROWS / TOTAL_COLUMNS.
  VIEWPORT_ROWS = 4
  VIEWPORT_COLUMNS = 4

  # On-screen pixel size of each tile in the grid view (thumbnail size).
  CELL_SIZE = 300

  # Pixel size of the actual drawing canvas used in the edit window. The
  # grid thumbnail's SVG viewBox uses this so strokes line up correctly
  # regardless of CELL_SIZE.
  DRAW_CANVAS_SIZE = 600

  # Clamp an offset so the viewport never scrolls past the grid's edges.
  def self.clamp_row_offset(value)
    max = [ TOTAL_ROWS - VIEWPORT_ROWS, 0 ].max
    value.to_i.clamp(0, max)
  end

  def self.clamp_column_offset(value)
    max = [ TOTAL_COLUMNS - VIEWPORT_COLUMNS, 0 ].max
    value.to_i.clamp(0, max)
  end
end
