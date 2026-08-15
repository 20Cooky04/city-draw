class CellsController < ApplicationController
  def update
    @cell = Cell.find(params[:id])
    if @cell.update(cell_params)
      render json: { status: "ok" }
    else
      render json: { errors: @cell.errors.full_messages }, status: :unprocessable_entity
    end
  end

   def show
     @cell = Cell.find(params[:id])
   end

  private

  def cell_params
    params.require(:cell).permit(:strokes, :completed)
  end
end