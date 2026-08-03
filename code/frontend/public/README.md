# public/ — static assets served as-is

Drop LIviu BRAdu's two poses here, exact filenames:

- `teller-reading.png` — the searching/reading pose
- `teller-eureka.png` — the pointing-with-"!" pose

`LibraTeller` (in `src/components.jsx`) looks for these at `/teller-reading.png` and
`/teller-eureka.png`. If either is missing, it falls back to the hand-drawn pixel-grid
sprite automatically — nothing breaks either way.
