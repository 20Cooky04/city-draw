# City Draw

A collaborative drawing web app. Users are given a scrollable grid; each cell gets a random prompt (a building or a nature scene) and 5 minutes to draw it in black pen only. Adjacent nature cells get animals walking between them; adjacent building cells get people walking between them, avoiding drawn pen strokes.

## Tech Stack
Ruby: 3.4.10 (managed via mise)
Rails: 8.1 (edge/latest at time of setup)
Database: SQLite (default, no separate install/service required)
JS runtime: none required — using importmap-rails (Rails 7+ default)
Frontend: Stimulus
CI: GitHub Actions (default Rails-generated workflow — RuboCop lint, Brakeman security scan, and system tests)
