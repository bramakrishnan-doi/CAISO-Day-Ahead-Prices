# MEAD Price Tracker (GitHub Pages starter)

Static analysis site for CAISO day-ahead prices at node `MEADS_2_N101`.

## Files/data setup

- Put the historical, daily-only database at `data/mead_daily.db`.
- Do not commit secrets or credentials. The public site and all tracked data are public.
- The update workflow fetches the default window from Pacific operating dates: today minus six days through tomorrow (eight dates total), unless manual dates are supplied.
- The workflow updates `data/mead_daily.db`, exports only its `days` table to `public/data/days.json`, and commits both files.

## Initial setup

1. Create a public GitHub repository and add this starter tree at its root.
2. Add your `data/mead_daily.db` file.
3. Ensure the default branch is `main` (or update the branch filter in `pages.yml`).
4. In repository Settings > Actions > General, allow GitHub Actions to create and approve commits, or otherwise enable the workflow token's contents write permission.
5. In Settings > Pages, set the publishing source to GitHub Actions.
6. Run **Update CAISO prices** manually once from the Actions tab. This updates and commits the database; a successful update triggers the Pages deployment. You can also run **Deploy MEAD price dashboard** manually. Open the Pages URL from Settings > Pages.

Manual workflow dates: leave both blank to use the rolling window, or supply both `start_date` and `end_date` as `YYYY-MM-DD`. In GitHub Actions, the manual form is access-controlled by repository permissions; the public website itself has no write credential.

## Caveats

- Scheduled triggers can be delayed by GitHub; 12:30 p.m. and 3:00 p.m. Pacific are requested run times, not guaranteed exact start times.
- The daily workflow commits the database, so every changed database version remains in normal Git history. The website JSON is generated during the Pages build and is not committed.
- The static app loads React, ReactDOM, Babel and Plotly from version-pinned CDNs. An offline/self-contained deployment would vendor those dependencies locally.
- This is a starter conversion of an Electron renderer. Review the analysis and user interface in a test Pages deployment before relying on it; no browser-triggered CAISO write is implemented.
