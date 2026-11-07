# semophoto fork: Tizen fixes on top of upstream Nuvio

This fork is upstream [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart)
plus a short series of small commits for Samsung Tizen TVs. Each fix is its
own commit so a new upstream release can be picked up by replaying them.

## The fixes

| Commit subject                                                                       | What it does                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tizen: sharper Home poster copies and keep them on disk                              | Home posters are shrunk to 3x card size (about 660x1000) and cached on the TV for 3 days. Builds on upstream's `tvPosterRescaler.js`; fork code is in `js/ui/images/tizenPosterTuning.js`. |
| Keep Tizen app resident on Back, exit on hold                                        | Back on Home hides the app; holding Back for 1 s closes it.                                                                                                                                |
| Stop Continue Watching cards falling back to "Untitled"                              | Prefer an addon meta that has a name.                                                                                                                                                      |
| Speed up Home catalog loading on Tizen                                               | Cached addon settings, batched renders, rows added as you scroll.                                                                                                                          |
| Cut per-press repaint on Tizen, ... AVPlay 4K mode                                   | Less redraw per key press; AVPlay 4K mode on UHD panels.                                                                                                                                   |
| Skip parsing unchanged Home rows on in-place renders                                 | Unchanged rows are kept instead of re-parsed.                                                                                                                                              |
| Tidy Home cards                                                                      | Smaller Continue Watching poster text, title placeholder while a poster loads, trailer crop. CSS lives in `css/fork-tizen.css`.                                                            |
| Drop YouTube prev/next from trailer embeds / Stop the hosted proxy adding a playlist | Trailers play once without YouTube's playlist buttons.                                                                                                                                     |
| Let YouTube trailers request quality for their real pixel size                       | Full-screen trailers request 4K.                                                                                                                                                           |
| Prefer addon video-file trailers over YouTube                                        | Direct video trailers play in Nuvio's player, YouTube is the fallback.                                                                                                                     |
| Keep the sign-in screen alive when Back hides the app                                | Back on the first-run sign-in screen no longer blanks it and stops its QR polling.                                                                                                         |
| Release rescaled Continue Watching backdrops                                         | Rescaled CW backdrops are handed back when their cards are removed, so they no longer pile up in memory.                                                                                   |
| Prune the Tizen poster disk cache while the app stays resident                       | The 1500-entry cap is enforced every 150 writes, not only at launch.                                                                                                                       |

Fork-only files (`FORK.md`, `scripts/fork/`, `css/fork-tizen.css`,
`js/ui/images/tizenPosterTuning.js`) are kept out of upstream's numbered files
so upstream changes rarely conflict with them.

## Updating to a new upstream release

```sh
scripts/fork/update-from-upstream.sh          # or: ... v1.4.0
npm run build && npm run lint
git push --force-with-lease
```

The script rebases the fix series onto upstream and writes `fork-patches/*.patch`
(apply those to a fresh upstream copy with `git am fork-patches/*.patch` on a
machine without GitHub access). If a fix conflicts, the rebase stops on that
one commit; resolve it, `git rebase --continue`, and rerun the patch export
(`git format-patch upstream/main..HEAD -o fork-patches`). If upstream has
since fixed the same thing, drop the commit with `git rebase --skip`.
