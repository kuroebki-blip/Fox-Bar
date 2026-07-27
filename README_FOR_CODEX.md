# FO’X v16 Banquets Production Context

This package contains read-only production exports for diagnosis and implementation planning.

Files:

- `apps-script/banquets/production/Code.gs` — baseline production banquet backend supplied by the user; later candidate changes are tracked in Git and do not imply deployment.
- `apps-script/stock/production/Code.gs` — baseline production stock/scanner/reserve backend supplied by the user; later candidate changes are tracked in Git and do not imply deployment.
- `docs/DATA_SCHEMA.md` — schema derived from production backend constants and headers.

Safety rules:

- Do not run `setupBanquetsBackend()`.
- Do not run setup functions against production Google Sheets.
- Do not deploy automatically.
- Do not modify production data.
- Do not commit API keys, Telegram tokens or Script Properties.
- Treat these files as production reference until the user explicitly approves changes.
