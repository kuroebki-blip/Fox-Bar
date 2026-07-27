# Backup before FO’X v16.0.0 deployment

- **Created:** 2026-07-27 21:02 Europe/Moscow
- **Branch:** `feature/v16-banquets-upgrade`
- **Pre-release commit:** `72eac8a8c7e1bb99d33bd5bbd26a3f6042a59aba`
- **Git tag:** `backup/pre-v16-production-2026-07-27-2102`
- **Purpose:** local source backup before the v16.0.0 deployment procedure.

## Files

- `index.html`
- `banquets-Code.gs`
- `stock-Code.gs`
- `DATA_SCHEMA.md`
- `Banquets.md`
- `README_FOR_CODEX.md`

## Rollback

1. Do not run setup functions and do not clear any Google Sheet.
2. Restore the corresponding file from this folder to its deployment target.
3. For GitHub Pages, restore `index.html` from this commit/tag and publish the restored revision.
4. For each Apps Script project, paste the matching `.gs` backup, then use **Deploy → Manage deployments → Edit → New version → Deploy**.
5. Verify `action=ping`, `action=list`, existing banquets and the stock reserve after rollback.

The tag points at the pre-backup source commit. This folder is an additional, file-level recovery copy.
