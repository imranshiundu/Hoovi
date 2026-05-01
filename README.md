# Hoovi

Hoovi is a static movie database frontend that can run on GitHub Pages, Netlify, Vercel, or any static host.

## Why Netlify may show “Site not available”

If Netlify says the site was paused because it reached usage limits, that is an account/site usage issue, not a code issue. The same code can still run on GitHub Pages or another static host.

## GitHub Pages setup

1. Open the repository settings.
2. Go to **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Branch: `main`.
5. Folder: `/root`.
6. Save.

After GitHub finishes deployment, the site should be available at:

`https://imranshiundu.github.io/Hoovi/`

## Backend note

The Spring Boot backend and SQLite database should be deployed separately. This repo is the static frontend shell.
