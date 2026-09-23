# Eight-asset dashboard archive

The last complete eight-asset version is preserved locally as:

- Git branch: `archive/eight-asset-dashboard-2026-09-23`
- Git tag: `archive-eight-assets-v40`
- Portable bundle: `backups/token-lens-eight-assets-2026-09-23.bundle`
- Archived commit: `ccb23056d6e9d2db835205cd70430cee9367e4a5`

## Restore in this checkout

Create a worktree without disturbing the current three-asset product:

```powershell
git worktree add ..\ethfi-eight-assets archive/eight-asset-dashboard-2026-09-23
```

## Restore from the portable bundle

```powershell
git clone backups\token-lens-eight-assets-2026-09-23.bundle ethfi-eight-assets
```

The archived implementation includes ETHFI, PENDLE, AAVE, ENA and XPL dashboards,
their API routes, the eight-asset comparison model, and the historical BP/HYPE/UNI
implementation that preceded the three-asset terminal.
