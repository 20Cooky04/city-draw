class CellsController < ApplicationController
  def update
    @cell = Cell.find(params[:id])
    if @cell.update(cell_params)
      render json: { status: "ok" }
    else
      render json: { errors: @cell.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def index
    @offset_row = GridConfig.clamp_row_offset(params[:offset_row])
    @offset_column = GridConfig.clamp_column_offset(params[:offset_column])

    cells = Cell.where(
      row: @offset_row...(@offset_row + GridConfig::VIEWPORT_ROWS),
      column: @offset_column...(@offset_column + GridConfig::VIEWPORT_COLUMNS)
    )
    @cells_by_position = cells.index_by { |c| [ c.row, c.column ] }
  end

   def show
     @cell = Cell.find(params[:id])
   end

  private

  def cell_params
    params.require(:cell).permit(:strokes, :completed)
  end
end
