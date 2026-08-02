# Deploy the ABS website

The website is a [Next.js](https://nextjs.org) static site (`output: 'export'`) —
it builds to a folder of plain HTML/CSS/JS that any static host can serve.

You already have everything needed in the repo. A push to `main` that touches
`website/**` triggers the deploy automatically.

---

## How it works

```
git push main
    │
    ▼
.github/workflows/deploy-website.yml
    │
    ├─ 1. Checkout repo
    ├─ 2. npm ci          (website/)
    ├─ 3. next build       → website/out/
    ├─ 4. upload artifact
    └─ 5. deploy to GitHub Pages
            │
            ▼
    https://fvinciarelli.github.io/abs
```

The build takes ~60s. The deploy is instant after that.

---

## One-time setup (already done)

These three things were configured once. You don't need to touch them again.

### 1. `next.config.mjs`

```js
const nextConfig = {
  basePath: '/abs',          // repo name — serves from /abs, not /
  output: 'export',           // static HTML, no Node server needed
  images: { unoptimized: true },  // required for static export
  typescript: { ignoreBuildErrors: true },  // skips pre-existing type issues
};
```

If you ever move the site to a custom domain or a user page (`fvinciarelli.github.io`
instead of a project page), remove `basePath`.

### 2. `.github/workflows/deploy-website.yml`

The workflow triggers on push to `main` when `website/**` files change.
It also has `workflow_dispatch` so you can trigger it manually from the
GitHub Actions tab.

### 3. GitHub Pages source

GitHub Pages is set to deploy from **Actions** (not from a branch).
This was enabled automatically when the workflow first ran because it
uses `actions/deploy-pages@v4`. If not, go to:

```
Repo → Settings → Pages → Source: "GitHub Actions"
```

---

## Manual trigger

If you need to redeploy without pushing:

1. Go to `https://github.com/fvinciarelli/abslang/actions`
2. Click **Deploy website to GitHub Pages** in the left sidebar
3. Click **Run workflow** → **Run workflow**

---

## Local preview

```bash
cd website
npm run dev       # http://localhost:3000/abs

# or build and serve the static output:
npm run build
npx serve out     # http://localhost:3000/abs
```

---

## Custom domain (optional, future)

If you want to host at `https://abs-lang.dev` or similar:

1. Add a CNAME record pointing to `fvinciarelli.github.io`
2. Add the domain in `Repo → Settings → Pages → Custom domain`
3. Remove `basePath: '/abs'` from `next.config.mjs`
4. Push — GitHub handles the rest, including automatic HTTPS via Let's Encrypt

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Blank page at `/abs` | The `basePath` is wrong. Check `next.config.mjs`. |
| 404 on subpages | GitHub Pages doesn't support SPA fallback. Static export handles this — every route is a real `.html` file. Verify `output: 'export'` is set. |
| Build timeout | First cold build takes ~90s. Subsequent warm builds are faster. If it keeps timing out, increase the job timeout in the workflow. |
| Mermaid diagrams not rendering | Diagrams render at build time via the `<Mermaid>` MDX component. If they're blank, check the browser console for CSP errors. |
