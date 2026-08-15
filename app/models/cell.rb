class Cell < ApplicationRecord
  CATEGORIES = %w[building nature].freeze

  BUILDING_PROMPTS = ["Skyscraper", "Cottage", "Windmill", "Lighthouse", "Bridge", "Bell Tower"]
  NATURE_PROMPTS   = ["Oak Tree", "Pond", "Mountain", "Flower Field", "Rocky Cliff", "Bush"]

  validates :row, :column, presence: true
  validates :category, inclusion: { in: CATEGORIES }
  validates :row, uniqueness: { scope: :column }

  def self.random_prompt_for_new_cell
    category = CATEGORIES.sample
    prompt = category == "building" ? BUILDING_PROMPTS.sample : NATURE_PROMPTS.sample
    { category: category, prompt: prompt }
  end

  def building?
    category == "building"
  end

  def nature?
    category == "nature"
  end
end
