# Quality Pulse AI

Quality dashboard for call-center QA reporting. This first version runs entirely in the browser: upload the existing **Summary** and **Detailed** Excel reports, then review performance, outliers, repeated mistakes, Pareto priorities, and coaching actions. In the Detailed report, only rows where the item **Score is 0** are counted as failed mistakes.

## Run it

Open `index.html` in Microsoft Edge or Chrome. No installation is required.

1. Upload the Summary file (optional but recommended for scores).
2. Upload the Detailed file (required for error analysis).
3. Select **Analyze reports**.

The app also includes a **Load demo data** button so its features can be reviewed immediately.

## Recognized columns

The importer accepts common variants of these headers, ignoring capitalization and spaces:

- Agent: `Agent Name`, `Agent`, `Full Name`, `User Name`
- Score: `Score`, `QA Score`, `Total Score`, `Overall Score`
- Date: `Evaluation Date`, `Date`, `Monitoring Date`
- Attribute: `Attribute Name`, `Attribute`
- Severity: `Severity`
- Error reason: `Error Reason`, `Reason`
- Error comment: `Error Reason Comment`, `Comment`

If a file uses different column labels, edit the `COLUMN_ALIASES` object in `app.js`.

## Privacy

Uploaded reports are processed locally in the browser. This version does not transmit or save report contents.

## Publish to GitHub Pages

Create or use a repository, upload these files to its root, then enable **Settings → Pages → Deploy from a branch** and select `main` / `root`.
