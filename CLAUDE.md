# admin-console — project instructions

## Generated documents convention

- Any generated document about a specific feature or defect MUST have a filename starting
  with its id: `F-###-` or `D-###-`. No id, no exceptions — an unattributable document is
  a defect in the generating agent's invocation.
- docs/ layout:
  - docs/spec-reviews/   — spec review reports (all revisions)
  - docs/runbooks/       — migration and operational runbooks
  - docs/reports/        — final reports, documentation reports
  - docs/design/         — design artifacts
  - docs/ (root)         — standing, non-feature-specific documents only
    (architecture notes, integration surfaces)
- Never commit a PDF rendering of a document that exists as markdown. PDFs are generated
  on demand (pandoc/weasyprint), not stored.
- briefs/ and specs/ filenames are join keys to feature-value-scoring.xlsx — never rename
  or move files there.
- Directories are created on demand when the first file needs them; do not pre-create
  empty directories for layout parity.
