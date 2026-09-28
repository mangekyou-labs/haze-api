# Issue tracker: GitHub

Issues and specifications for this repository live in GitHub at
`mangekyou-labs/haze-api`. Use the `gh` CLI and pass
`--repo mangekyou-labs/haze-api` explicitly: the checkout has a second remote,
`origin`, pointing at `mangekyou-labs/haze`.

## Conventions

- Read issues with `gh issue view <number> --repo mangekyou-labs/haze-api --comments`.
- Create issues with `gh issue create --repo mangekyou-labs/haze-api`.
- Comment with `gh issue comment <number> --repo mangekyou-labs/haze-api`.
- Apply or remove labels with `gh issue edit <number> --repo mangekyou-labs/haze-api --add-label <label>` or `--remove-label <label>`.
- Close with `gh issue close <number> --repo mangekyou-labs/haze-api`.

## Pull requests as a request surface

**No.** Pull requests are not treated as feature requests for triage.

## Wayfinding operations

The map is a GitHub issue labelled `wayfinder:map`; child tickets use
`wayfinder:<type>` labels and GitHub's native sub-issue relationship. Assign a
ticket to the driving developer when claiming it. Resolve a ticket by posting
the answer, closing it, and adding a concise context pointer to the local map.
