# Releasing

Zotero 10 refuses to install an add-on whose manifest lacks
`applications.zotero.update_url`, so the release URL has to exist before the
first public build.

## 1. Pick the public add-on id

The local id is `sentence-translate@local`. For a public release use a stable,
unique id, for example:

```
sentence-translate@<github-user>.github.io
```

Change it in `src/manifest.json` only; `bootstrap.js` receives the id from
Zotero at startup and passes it to Translate for Zotero.

## 2. Point update_url at the latest release manifest

```json
"update_url": "https://github.com/<owner>/sentence-translate/releases/latest/download/updates.json"
```

Do **not** put `@v0.2.1` or `@main` in `update_url`:

- A versioned URL freezes the manifest at that version, so users on it can never
  discover the next release.
- A jsDelivr branch URL can keep serving a stale manifest for hours after a
  release.

The `latest/download/updates.json` URL always redirects to the manifest attached
 to the newest non-prerelease release. The XPI linked from that manifest keeps a
 versioned `releases/download/vX.Y.Z/...` address.

## 3. Build and tag

```powershell
./build.ps1
git tag v0.1.0
git push origin main --tags
gh release create v0.1.0 build/sentence-translate-0.1.0.xpi `
  --title "Sentence Translate 0.1.0" --notes "First public build."
```

## 4. Publish updates.json

```json
{
  "addons": {
    "sentence-translate@<github-user>.github.io": {
      "updates": [
        {
          "version": "0.2.1",
          "update_link": "https://github.com/<owner>/sentence-translate/releases/download/v0.2.1/sentence-translate-0.2.1.xpi",
          "applications": {
            "zotero": {
              "strict_min_version": "7.0",
              "strict_max_version": "11.*"
            }
          }
        }
      ]
    }
  }
}
```

Commit it as `updates.json` in the repository root **and attach the same file to
the release**:

```powershell
gh release create v0.2.1 build/sentence-translate-0.2.1.xpi updates.json `
  --title "v0.2.1" --notes "..."
```

`releases/latest/download/updates.json` only works when `updates.json` is an
asset of the latest release, not just a file on `main`. Add a new entry for
every release; keep the old ones so users on older Zotero versions can still
update.

## 5. Submit to the Zotero Chinese plugin catalog

The catalog behind the in-app Add-on Market is
[`zotero-chinese/zotero-plugins`](https://github.com/zotero-chinese/zotero-plugins).
Open an issue or a pull request and add an entry to `src/plugins.ts` in
repository-name order:

```ts
{
  repo: "<owner>/sentence-translate",
  tags: ["reader", "translation"],
  releases: [],
  discoverReleases: true,
},
```

`releases: []` with `discoverReleases: true` lets the collector find the latest
stable release. The catalog also reads the XPI manifest for compatibility, so
keep `strict_min_version` / `strict_max_version` accurate.

Optional metadata used by the catalog: `nameZh`, `summaryZh`, `keywords`.

## Checklist

- [ ] Public id is unique and does not collide with another plugin
- [ ] `update_url` resolves to the committed `updates.json`
- [ ] `npm test` passes
- [ ] XPI starts in a clean Zotero profile (see `test/smoke.md`)
- [ ] A real PDF click shows a text-width highlight and a translation
- [ ] LICENSE and README are in the repository
- [ ] Release asset name matches `update_link`
