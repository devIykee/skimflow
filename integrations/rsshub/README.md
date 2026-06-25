# Skimflow RSSHub route

A custom [RSSHub](https://docs.rsshub.app/) route that exposes Skimflow creator
feeds to the RSSHub ecosystem. It calls Skimflow's public posts API and maps the
response into RSSHub's standard item format. Paid content is never exposed — the
API already returns only a teaser for paid posts.

> These files live **outside** the Skimflow app on purpose: they import from
> RSSHub internals (`@/types`, `@/utils/ofetch`, `@/utils/parse-date`) and only
> compile inside an RSSHub checkout. They are not part of the Next.js build.

## Route

```
/skimflow/creator/:creatorId        (optional ?limit= passthrough)
```

- `:creatorId` — the creator's Skimflow UUID
- `?limit` — forwarded to the Skimflow API (default 20, max 100)

Mapping:

| RSSHub item | Source |
|-------------|--------|
| `title`     | `post.title` |
| `link`      | `post.url` (canonical Skimflow reader URL) |
| `description` | free → `post.content`; paid → `post.teaser` |
| `pubDate`   | `parseDate(post.publishDate)` |
| `author`    | `creator.name` |
| `guid`      | `post.id` |

## Install into RSSHub

1. Clone RSSHub: `git clone https://github.com/DIYgod/RSSHub`
2. Copy the `skimflow/` folder here into `RSSHub/lib/routes/`:
   ```
   cp -r integrations/rsshub/skimflow <RSSHub>/lib/routes/skimflow
   ```
3. `cd RSSHub && pnpm install && pnpm dev`
4. Test: `http://localhost:1200/skimflow/creator/<creatorId>`

To point at a non-production Skimflow, change `SKIMFLOW_BASE` in `creator.ts`.

## Contributing upstream

The folder follows RSSHub's namespace conventions (`namespace.ts` + a route file
exporting a `Route` object with `path`, `name`, `maintainers`, `handler`), so it
can be opened as a PR to the RSSHub repo as-is.
