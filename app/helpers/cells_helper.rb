# app/helpers/cells_helper.rb
#
# Renders a stroke (array of {x, y} points) as an SVG path `d` attribute,
# using the same "quadratic curve through midpoints" smoothing as the
# live canvas drawer's redrawAll(), so grid thumbnails visually match
# what was actually drawn.
module CellsHelper
  def stroke_to_svg_path(stroke)
    return "" if stroke.size < 2

    first = stroke[0]
    d = +"M #{first['x']},#{first['y']} "

    if stroke.size == 2
      last = stroke[1]
      d << "L #{last['x']},#{last['y']}"
    else
      (1...(stroke.size - 1)).each do |i|
        point = stroke[i]
        nxt = stroke[i + 1]
        xc = (point["x"] + nxt["x"]) / 2.0
        yc = (point["y"] + nxt["y"]) / 2.0
        d << "Q #{point['x']},#{point['y']} #{xc},#{yc} "
      end
    end

    d
  end
end
