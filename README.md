# GTA Alerts

Map-fixed version for GTAAlerts.com.

## What this version fixes

- Uses a more stable light map tile provider.
- Adds an error tile so failed map tiles do not leave big white gaps.
- Adds cache-busting in the HTML so Chrome loads the newest CSS/JS.
- Keeps map scroll-wheel zoom off so the page can scroll normally.
- Stacks the alert panel under the map sooner on smaller laptop screens.
- Keeps alert cards and pins clickable.

## Upload

Upload these files to the root of the `Jtragas/gta-alerts` GitHub repo and replace the old files:

- `index.html`
- `styles.css`
- `app.js`
- `README.md`
- `CNAME`
- `.nojekyll`

After uploading, refresh with Ctrl + F5.
