class CreateCells < ActiveRecord::Migration[7.1]
  def change
    create_table :cells do |t|
      t.integer :row
      t.integer :column
      t.string :category
      t.string :prompt
      t.text :strokes
      t.boolean :completed, default: false

      t.timestamps
    end

    add_index :cells, [ :row, :column ], unique: true
  end
end
