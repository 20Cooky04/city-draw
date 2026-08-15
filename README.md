# City Draw

[in-progress]
A collaborative drawing web app. Users are given a scrollable grid; each cell gets a random prompt (a building or a nature scene) and 5 minutes to draw it in black pen only. Adjacent nature cells get animals walking between them and adjacent building cells get people walking between them, avoiding any drawn pen strokes.

## Tech Stack
- Ruby: 3.4.10
- Rails: 8.1
- Database: SQLite
- JS runtime: none required
- Frontend: Stimulus
- CI: GitHub Actions (default Rails-generated workflow: RuboCop lint, Brakeman security scan, and system tests)
