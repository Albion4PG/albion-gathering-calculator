# Albion Gathering Fame Calculator

A calculator for Albion Online gathering fame/hour, built from the game's
own client data rather than community rules of thumb.

**Live:** https://albion4pg.github.io/albion-gathering-calculator/

## What it does

Pick a zone, tune a few assumptions about how you actually play (how long
you spend finding the next node, how often you're fighting a resource mob
vs. harvesting a static one, etc.), and add it to the chart. The chart
plots fame/hour against a minimum-value filter threshold — each point
answers "what's my fame/hour if I only bother taking nodes worth at least
this much?" — so you can see where being pickier actually pays off versus
where it just slows you down.

- Add the same zone more than once (e.g. with different assumptions) to
  compare side by side — repeat entries get a different marker shape so
  they stay distinguishable.
- The "Buffs" panel (Pork Pie, Premium, Learning Points) applies globally
  to every entry on the chart at once, current and future.
- Nothing about the underlying game data (fame values, charges, tick
  rates, node weights, enchant odds) is user-editable — only the
  assumption parameters and buffs are. See [`docs/spec.md`](docs/spec.md)
  for the full model and exactly what's in vs. out of scope for v1.

## Where the numbers come from

Every game-data constant is extracted programmatically from raw client
XML files checked into [`gamedata/`](gamedata/) — not hand-transcribed —
via [`scripts/build_gamedata.py`](scripts/build_gamedata.py). See
[`gamedata/README.md`](gamedata/README.md) for provenance details,
including how Roads (Avalonian tunnel) node weights are averaged from
real per-cluster data in `world.xml`.

## Running it locally

This is a static site with no build step — the four files under `src/`
are plain ES modules loaded directly by `index.html`. You do need to
serve it over HTTP (not open the file directly), since browsers block
`<script type="module">` from `file://`:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

To regenerate `src/gamedata.generated.mjs` after updating a file in
`gamedata/` (e.g. a new game patch):

```bash
python3 scripts/build_gamedata.py
```

## Testing

```bash
node --test test/*.test.mjs
```

`test/z7q3.test.mjs` checks the model against an independently hand-worked
reference case. `test/all-zones.test.mjs` smoke-tests every zone/quality/
road-type combination currently defined for structural sanity (no NaNs,
non-negative rates, internally-consistent fame/time figures, etc.) — it
doesn't replace a hand-derived check, but it does catch a broken or
misconfigured zone entry.

## Reporting issues / feedback

Open a GitHub issue on this repo, or comment directly on the relevant
line of code. If you spot a fame/hour number that looks off, it's most
useful to include: the zone, quality/road-type, the four assumption
values, any buffs enabled, and which threshold row looks wrong.
