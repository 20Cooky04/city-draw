# db/seeds.rb
#
# Populates every position in the city grid (GridConfig::TOTAL_ROWS x
# GridConfig::TOTAL_COLUMNS) with a Cell, each assigned a random category
# and prompt. Safe to re-run: uses find_or_create_by! on [row, column], so
# it won't touch cells that already exist (including any you've already
# drawn on) and will only fill in the gaps.
#
# Run with: bin/rails db:seed

BUILDING_PROMPTS = [
  "a lighthouse",
  "a windmill",
  "a skyscraper",
  "a castle turret",
  "a small cottage",
  "a church with a steeple",
  "a water tower",
  "a bridge",
  "a train station",
  "a greenhouse",
  "a barn",
  "a clock tower",
  "a pagoda",
  "a lighthouse keeper's hut",
  "a market stall",
  "a treehouse",
  "a factory with smokestacks",
  "a domed observatory",
  "a suspension bridge tower",
  "a row of terraced houses"
].freeze

NATURE_PROMPTS = [
  "a cluster of pine trees",
  "a pond with lily pads",
  "a rolling hill",
  "a rocky outcrop",
  "a flower meadow",
  "a winding river bend",
  "a small waterfall",
  "a patch of tall grass",
  "a single oak tree",
  "a cluster of boulders",
  "a sand dune",
  "a hedge maze corner",
  "a vegetable garden bed",
  "a cluster of mushrooms",
  "a reed bed",
  "a rocky coastline",
  "a wildflower patch",
  "a grove of birch trees",
  "a mossy log",
  "a small orchard"
].freeze

created_count = 0
skipped_count = 0

(0...GridConfig::TOTAL_ROWS).each do |row|
  (0...GridConfig::TOTAL_COLUMNS).each do |column|
    cell = Cell.find_or_create_by!(row: row, column: column) do |c|
      category = %w[building nature].sample
      c.category = category
      c.prompt = category == "building" ? BUILDING_PROMPTS.sample : NATURE_PROMPTS.sample
      c.strokes = "[]"
      c.completed = false
    end

    cell.previously_new_record? ? (created_count += 1) : (skipped_count += 1)
  end
end

puts "Seeded #{created_count} new cells, skipped #{skipped_count} existing cells " \
     "(#{GridConfig::TOTAL_ROWS * GridConfig::TOTAL_COLUMNS} total grid positions)."
