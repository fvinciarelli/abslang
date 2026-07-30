# Deploy the ABS website

El sitio es Next.js con `output: 'export'` — compila a HTML/CSS/JS plano
que cualquier host estático puede servir. Acá va el paso a paso para GitHub Pages.

---

## 1. Configurar `next.config.mjs`

Agregá `basePath` con el nombre del repo y `typescript.ignoreBuildErrors`:

```js
const nextConfig = {
  basePath: '/abs',           // nombre del repo en GitHub
  pageExtensions: ['tsx', 'ts', 'md', 'mdx'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },  // ← agregar
  output: 'export',
  images: { unoptimized: true }
};
```

Si usás un dominio custom (`midominio.com`) en vez de `usuario.github.io/abs`,
el `basePath` se saca.

---

## 2. Crear el workflow

Archivo: `.github/workflows/deploy-website.yml`

```yaml
name: Deploy website to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'website/**'
      - '.github/workflows/deploy-website.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: website
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Cache dependencies
        uses: actions/cache@v4
        with:
          path: ~/.npm
          key: ${{ runner.os }}-node-${{ hashFiles('website/package-lock.json') }}
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: website/out

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

## 3. Activar GitHub Pages

En el repo: **Settings → Pages → Source: "GitHub Actions"**

Si no aparece esa opción, asegurate de que el repo sea público (o tengas GitHub Pro
para Pages en repo privado).

---

## 4. Pushear

```bash
git add -A && git commit -m "add website deploy workflow" && git push
```

El build tarda ~60s. Después el sitio queda en:

```
https://fvinciarelli.github.io/abs
```

Podés seguir el progreso en la pestaña **Actions** del repo.

---

## Disparo manual

Si necesitás redeployar sin pushear:

1. **Actions → Deploy website to GitHub Pages → Run workflow**

---

## Probar local

```bash
cd website
npm run dev       # http://localhost:3000/abs

# O buildear la versión estática y servirla:
npm run build
npx serve out
```

---

## Dominio custom (opcional, futuro)

1. Agregá un registro CNAME en tu DNS apuntando a `fvinciarelli.github.io`
2. En **Settings → Pages → Custom domain**, poné tu dominio
3. Sacá `basePath: '/abs'` de `next.config.mjs`
4. Pusheá — GitHub genera HTTPS automático con Let's Encrypt

---

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| Página en blanco en `/abs` | `basePath` mal configurado |
| 404 en subpáginas | `output: 'export'` no está puesto — cada ruta necesita su `.html` |
| Build timeout | Primer build frío tarda ~90s. Si falla, subí el timeout del job |
| Diagramas Mermaid rotos | Error de types preexistente — `ignoreBuildErrors: true` lo saltea |
