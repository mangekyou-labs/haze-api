# Codex custom provider reasoning controls

Research date: 2026-09-28. Sources below are live official OpenAI documentation and schema; they do not pin behavior to Codex CLI 0.157.1.

## Findings

- A selected Codex profile has higher precedence than `~/.codex/config.toml` but lower precedence than command line flags, `--config`, and trusted project configuration. Thus a profile value for `model_reasoning_effort` can replace a user default, subject to those higher layers. [Codex config basics](https://learn.chatgpt.com/docs/config-file/config-basic)
- The current Codex schema accepts `model_reasoning_effort` as a nonempty string in both base configuration and a profile. Therefore `model_reasoning_effort = "none"` is *syntactically valid in the current schema*. The config reference says available effort levels depend on the selected model and client. The live documentation does not establish whether Codex CLI **0.157.1** accepts that value or what request it emits. [Codex config schema](https://learn.chatgpt.com/docs/config-schema.json), [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- `none` is an **effort value**, not a documented switch for omitting the `reasoning` object. OpenAI's reasoning guide describes `reasoning.effort` values as model dependent; it explicitly says some models reject `none` with HTTP 400. Therefore setting effort to `none` is not proof that an API request omits reasoning controls. [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning)
- `model_reasoning_summary = "none"` disables summaries, while `model_supports_reasoning_summaries = false` is documented as forcing Codex not to send reasoning metadata. These are separate settings from `model_reasoning_effort`. [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- GPT-4o Mini's official model page lists Responses support but does not advertise reasoning effort. Its catalog entry should therefore avoid offering reasoning levels; the project's `supported_reasoning_levels: []` is consistent with that model page. This is an inference from the model page and local catalog shape, **not** a documented guarantee that Codex 0.157.1 omits reasoning controls. [GPT-4o Mini model page](https://developers.openai.com/api/docs/models/gpt-4o-mini)

## Practical implication

The local Codex CLI 0.157.1 replay resolved the wire behavior beyond what the documentation establishes. Against a synthetic loopback Responses endpoint, `medium` sent `reasoning.effort = "medium"` and the project's bridge returned `unsupported_reasoning_controls`. An explicit managed-profile `"none"` sent `reasoning.effort = "none"`, which the bridge accepts, even when the user config default remained `medium`. The `reasoning` object was still present. This observation applies to the installed CLI and this bridge; it did not use a funded provider call. See [the B22 trial evidence](../evidence/base-sepolia-internal-trial.md).

## B22 request routing and shape (2026-09-28)

The local Codex profile exposes `openai/gpt-4o-mini` as an alias; the gateway
service class dispatches `deepseek/deepseek-v4-flash` through OpenRouter. The
Responses bridge accepts 20 top-level field names. The recorded offline Codex
replay carried 9 tool declarations and an instructions field of 17,119 UTF-8
bytes. The bridge maps that surface to Chat Completions and omits the
local-only `apply_patch` declaration; the gateway fixes 5 required top-level
fields in its normalized provider request, with optional fields admitted only
by the service class. The bridge's relevant fixed rejection categories are
`unsupported_request_field`, `unsupported_tool`, and
`unsupported_reasoning_controls`. No request body or prompt text was retained.

OpenRouter's current [DeepSeek V4 Flash page](https://openrouter.ai/deepseek/deepseek-v4-flash)
states that the model accepts `tools` and `tool_choice` for function calling.
This confirms the dispatched model supports the function-tool fields in the
bounded request; it does not establish successful billing or settlement.
