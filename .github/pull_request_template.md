## What
<!-- One sentence describing the change. -->

## Why
<!-- 1–3 bullets on motivation. -->

## Related issues
<!-- "Closes #N" auto-closes the issue on merge; "Refs #N" links without closing. -->
- Closes #

## How (only if non-obvious)
<!-- Brief notes on the approach. -->

## Checklist
- [ ] `npm run typecheck` passes locally
- [ ] `npm run lint` passes locally
- [ ] `npm run build` passes locally
- [ ] `CHANGELOG.md` updated (correct subsection, newest first, short hash filled in)
- [ ] Touched directory's `CLAUDE.md` "Recent changes" updated (if that directory has one)
- [ ] No new migration edits an existing migration file
- [ ] If point values changed: updated in BOTH `lib/scoring/rules.ts` AND a new `supabase/migrations/000X_*.sql`

## Test steps
<!-- How to verify this works locally. -->
1.
2.
