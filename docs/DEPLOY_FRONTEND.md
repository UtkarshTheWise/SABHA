# Putting the dashboard online

The dashboard is a static site: a folder of files that any host can serve. Nothing
runs on the host. It talks straight from each visitor's browser to the network's
public RPC address, which is why the gateway has to know which web page is allowed
to read its answers (step 4).

This guide uses Vercel because it builds from Git and makes a preview of every
pull request without any workflow of ours. Netlify works the same way (see the end).
I have not been able to check either provider's current free-tier terms or exact
dashboard wording, so confirm those yourself before relying on them.

## Before you start

1. The repository is on GitHub.
2. The networks you want shown have been deployed, and their files are committed:
   `frontend/src/chain/networks/besu.json` and/or `sepolia.json`. Those files hold
   only public facts (addresses, chain id, the public RPC address, the explorer).
   The build reads them; there is no other place the addresses come from. If there
   are none, the page says "No network is configured" instead of crashing.
3. `npm run publish:frontend` regenerates them from `deployments/` if you ever need
   to, without touching a chain.

## 1. Create the project

1. Sign in to Vercel with your GitHub account and choose **Add New → Project**.
2. Import the repository.
3. Set **Root Directory** to `frontend`. Everything else comes from
   `frontend/vercel.json`: `npm ci`, `npm run build`, output `dist`.
4. Leave environment variables empty for now. The optional ones are in
   `frontend/.env.example`.
5. Deploy.

## 2. Check what it served

```bash
curl -sI https://YOUR-PROJECT.vercel.app | grep -iE "content-security|x-frame|nosniff|referrer"
curl -s https://YOUR-PROJECT.vercel.app | grep -o 'connect-src[^;]*'
```

You should see the hardening headers from `vercel.json`, and a `connect-src` that
lists exactly your networks' RPC addresses and nothing else.

## 3. What the Content-Security-Policy does

The page will hold wallet keys in the browser (the in-browser wallet), so the main
defence against a script injected into the page is a strict policy: only the page's
own scripts run, and it may only send data to the RPC addresses it was built with.
The build writes the policy from the network files, so **adding a network means a
new build**, which a push to GitHub does.

If the page ever has to reach another site (a document gateway for proposal
attachments, say), name its origin in the build setting `VITE_CSP_EXTRA_CONNECT`
(space-separated). Without it the browser blocks the request, and the console says
which directive refused it.

## 4. Tell the gateway about the page

Browsers refuse to let a page read an answer from another site unless that site
says it may. Our gateway says so only for origins you list. On the server, in
`besu/.env`:

```
FRONTEND_ORIGINS=https://YOUR-PROJECT.vercel.app https://YOUR-PROJECT-*.vercel.app
```

and `docker compose up -d rpc-gate`. The second entry covers preview deployments,
which get names like `YOUR-PROJECT-git-branch-team.vercel.app`; the `*` stands for
one part of a name and nothing more. The gateway refuses `https://*.vercel.app`
outright, because it would admit every site hosted there.

Symptom if you forget: the page shows "Cannot reach …", while `curl` to the same
address works. That is the browser refusing, not the network failing.

## 5. Try it, on a phone

1. Open the address. A visitor with no wallet sees every ballot and no prompt.
2. **Connect a wallet** asks the wallet for accounts and, if it is on another chain,
   to switch, adding the network first if it has never heard of it.
3. **Add this network to my wallet** does the second part on its own.
4. Vote. On the free-gas network the transaction goes out at gas price zero, so a
   wallet holding nothing can send it.

Step 4 is the one thing I could not test for you: I drove the page in a desktop
browser with a stand-in wallet that signs on the Node side, and it works, but I
have not seen a real wallet app accept a gas-price-zero transaction on this chain.
Wallet apps differ in how they treat a network with no currency; try it on the phones
your members actually have, before announcing it.

## Previews

Every pull request gets its own address from Vercel automatically. For a preview to
show data, `FRONTEND_ORIGINS` must match it (step 4). Check in the project's settings
who can see previews, since a preview of a branch is a public address unless
protected.

## Custom domain

Optional: add one in the project's **Domains** settings, then add the new origin to
`FRONTEND_ORIGINS` and run `docker compose up -d rpc-gate` again.

## Netlify instead

Base directory `frontend`, build command `npm run build`, publish directory
`frontend/dist`. Netlify does not read `vercel.json`: add the same headers in a
`_headers` file (`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`). The
page's own policy is in the HTML and needs nothing from the host.
