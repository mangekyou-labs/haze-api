# README and first-investigation prototype review

Throwaway assets for [Choose a concise README and first-investigation walkthrough](https://github.com/mangekyou-labs/haze-api/issues/44).
The canonical map is [Base transaction investigator: useful x402 workflow and concise developer README](https://github.com/mangekyou-labs/haze-api/issues/39).
Status: awaiting owner reaction; no resolution recorded.

Read [the 83-line README candidate](README.prototype.md), then
[the illustrative investigation walkthrough](walkthrough.prototype.md).

## Proposed information structure

Purpose and available/proposed boundary → actual prerequisites → pinned setup →
small useful coding task available today → proposed investigator → essential
compatibility/privacy limits → deeper references.

This ordering gets a reader to something useful using the released transport,
then shows the planned evidence purchase without inventing a runnable investigator.
A future README can replace the coding example with the investigator only after
implementation and acceptance. The walkthrough's final section proposes the
reader-facing verification criteria; these await owner review.

Other viable orderings are investigator-first (stronger intended-product story,
but no useful investigation command exists yet) and separate current/future
READMEs (cleaner status distinction, but more navigation). The candidate recommends
one short current-use README with a clearly labelled future-workflow link.

## Verification performed on 2026-10-07

- Downloaded `zk-credits@0.2.11` from npm, then installed it into a temporary
  prefix with `--ignore-scripts --no-audit --no-fund`; no global installation.
- Registry tarball SHA-1: `ad4affa8c0406b97e316988111c1bdfe9cf75b37`.
- Executed the installed published CLI's `--help`, `setup --help`, and
  `doctor --help`; all exited successfully and advertised the candidate's syntax.
- Inspected published CLI/setup/launcher source: passwordless OS-store import,
  packaged proving archive, release RPC fallback, and an external `codex` executable.
- Extracted the README's embedded sample verbatim and ran `node --test`:
  duplicate-log test failed, distinct-log test passed, expected process exit 1.
- Verification host: Node.js v24.10.0; npm 11.6.1. Node 20+ is the package's
  declared requirement, not a cross-platform runtime matrix verified here.
- Checked whitespace with `git diff --check` after staging the assets.

The install command was exercised with a temporary prefix rather than globally.
Credential import, funded setup, RPC synchronization, Codex launch, actual model
calls, and live evidence delivery were not executed. Their command shapes are
verified, not an end-to-end onboarding result. The walkthrough is entirely
illustrative and demonstrates neither provider delivery nor runtime accounting.

## Stale instructions reconciled

The committed root README at base commit `e452538` describes an invite-only
pilot, version 0.2.7, encrypted/password-based import, private artifact repository
access, and participant activation/compensation procedures. The current shared
workspace already contains a different uncommitted root README and demo work.
This branch captures only new prototype assets and does not incorporate that work.

The candidate uses the published 0.2.11 package, an already activated credential,
native OS storage, and packaged proving assets. It omits recruitment, experiments,
compensation, and activation procedures. It avoids claiming that current sandbox
onboarding is deployed, and avoids the unpublished `--task-evidence` feature.
Existing deep links are retained for reference, not proof that every historical
onboarding instruction behind those links has been refreshed.

## Decision still needed

Does the current-use-first README plus linked illustrative investigation explain
the product and the value of x402 with minimal reading? The owner's reaction must
choose or revise the information structure, walkthrough, and verification criteria
before this decision can close. No implementation, real README replacement,
deployment, purchase, or funding was performed.
