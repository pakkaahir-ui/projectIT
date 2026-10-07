# Campus Lost & Found (Netlify edition)

Everyone who opens your Netlify link sees the same board. Reports and photos are saved on Netlify, not in the visitor's browser.

- **Frontend:** plain HTML/CSS/JS in `public/` (no build step)
- **Backend:** one Netlify Function, `netlify/functions/api.mjs`
- **Storage:** Netlify Blobs (posts, contact details, photos). No separate database to set up.

## Deploy (GitHub + Netlify, about 10 minutes)

1. Create a GitHub repository and upload everything in this folder (not `node_modules`).
2. In Netlify: **Add new site -> Import an existing project -> GitHub**, pick the repository. Leave the build command empty; `netlify.toml` already sets the publish folder and functions folder. Click **Deploy**.
3. After the first deploy, open **Site configuration -> Environment variables** and add `ADMIN_KEY` with a long random value (this lets you delete spam). Then **Deploys -> Trigger deploy** so it takes effect.
4. Open your `*.netlify.app` link, post an item with a photo, then open the link on another device. The item should appear there too.

A site made by dragging a folder into Netlify Drop usually will not work, because the function needs its `@netlify/blobs` dependency installed during the deploy. Use the GitHub route above (or the Netlify CLI: `npm i -g netlify-cli`, `netlify deploy --prod`).

## Try it on your computer first

```bash
npm install
npm install -g netlify-cli
netlify dev        # http://localhost:8888, uses a local Blobs sandbox
```

## Moderating

There are no accounts. A reporter's browser keeps a secret token, so only that browser can resolve or delete its own post. As the owner, use your `ADMIN_KEY`:

```bash
curl -X DELETE https://YOUR-SITE.netlify.app/api/items/<id> -H "x-admin-key: YOUR_ADMIN_KEY"
```

You can also browse stored data in the Netlify dashboard (Blobs).

## Limits and things to know

- Photos: JPEG/PNG/WebP, the browser re-encodes them to max 1600px JPEG (this also removes location metadata), server limit 4 MB.
- At most 1000 posts on the board and 10 new reports per hour per network (a soft limit).
- Contact details are visible to anyone who opens an item. Tell people to use a campus email, or add login in front of the site.
- Netlify's free plan has monthly usage limits for functions and storage. Check the current numbers on netlify.com/pricing if you expect heavy traffic.
