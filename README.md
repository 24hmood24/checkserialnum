# Base44 App


This app was created automatically by Base44.
It's a Vite+React app that communicates with the Base44 API.

## Running the app

```bash
npm install
npm run dev
```

## Building the app

```bash
npm run build
```

## Deploying to GitHub Pages

This repository includes a GitHub Actions workflow that builds the app and publishes the built files into the `docs/` folder on pushes to `main`.

Steps:

1. Commit and push your code to the `main` branch.
2. The action will run automatically, build the site, and copy `dist/` into `docs/` and commit that change to `main`.
3. In your repository settings → Pages, set the site source to the `main` branch and `/docs` folder.

Optional local test:

```bash
npm install
npm run build
npm run start
```

If you prefer the `gh-pages` branch workflow instead, tell me and I will switch the workflow back to publish to `gh-pages`.

Custom domain

If you want your site to be served from a custom domain, a `CNAME` file will be created automatically in the `docs/` folder by the GitHub Actions workflow. Currently this repository will add:

```
checkserialnum.com
```

If you want to change or remove the domain, edit `.github/workflows/deploy.yml`.

For support contact: app@base44.com

DNS / GitHub Pages A record guidance

If you're using the apex domain `checkserialnum.com`, add the following A records to your domain registrar (GitHub Pages IPs):

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

If you want `www.checkserialnum.com` to point to the site, add a CNAME record for `www` pointing to your GitHub Pages default domain (e.g., `username.github.io`).

Notes:
- The repository already contains a `CNAME` file at the repository root; the Actions workflow will also write `docs/CNAME` so Pages recognizes the custom domain.
- After DNS changes, propagation can take up to 48 hours.


For more information and support, please contact Base44 support at app@base44.com.