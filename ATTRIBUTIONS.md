# Attributions

This config combines original personal configuration with copied, adapted, and inspired work from the pi community.

## Copied or closely adapted files

These files are copied verbatim or closely adapted from upstream repositories. They retain their upstream license terms.

| Local file                                      | Upstream source                                                                                         | Relationship                | Upstream license |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------- |
| `extensions/answer.ts`                          | [`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff) `extensions/answer.ts`              | Copied verbatim             | Apache-2.0       |
| `extensions/files.ts`                           | [`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff) `extensions/files.ts`               | Locally modified adaptation | Apache-2.0       |
| `extensions/continue.ts`                        | [`MansoorMajeed/Clawd`](https://github.com/MansoorMajeed/Clawd) `extensions/continue.ts`                | Locally modified adaptation | Apache-2.0       |
| `extensions/compact-advisor.ts`                 | [`MansoorMajeed/Clawd`](https://github.com/MansoorMajeed/Clawd) `extensions/compact-advisor.ts`         | Copied verbatim             | Apache-2.0       |
| `extensions/todos/index.ts`                     | [`HazAT/pi-config`](https://github.com/HazAT/pi-config) `extensions/todos/index.ts`                     | Locally modified adaptation | MIT              |
| `skills/session-reader/scripts/read_session.py` | [`HazAT/pi-config`](https://github.com/HazAT/pi-config) `skills/session-reader/scripts/read_session.py` | Copied verbatim             | MIT              |
| `skills/self-improve/SKILL.md`                  | [`HazAT/pi-config`](https://github.com/HazAT/pi-config) `skills/self-improve/SKILL.md`                  | Closely adapted             | MIT              |
| `skills/session-reader/SKILL.md`                | [`HazAT/pi-config`](https://github.com/HazAT/pi-config) `skills/session-reader/SKILL.md`                | Closely adapted             | MIT              |
| `packages/pisesh/`                              | [`Blue-B/pisesh`](https://github.com/Blue-B/pisesh)                                                       | Locally modified adaptation | MIT              |

## Local runtime surfaces

These paths are active local runtime surfaces. The exact upstream source is not recorded here unless listed in the copied/adapted table above.

| Local path                        | Provenance note                                                       |
| --------------------------------- | --------------------------------------------------------------------- |
| `extensions/claude-ui/`           | Original local extension for Claude-style UI rendering/tool wrappers. |
| `extensions/subagent/config.json` | Local runtime config for the enabled `packages/pi-subagents` package. |

## Design and workflow influences

These sources influenced the structure, workflow, or prompting patterns but were not copied verbatim unless listed above.

| Source                                                                            | Influence                                                                                                                          |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [`HazAT/pi-config`](https://github.com/HazAT/pi-config)                           | Agent role architecture, AGENTS.md/skills separation, skill description style, self-improvement workflow, session-reader workflow. |
| [`danchamorro/pi-agent-toolkit`](https://github.com/danchamorro/pi-agent-toolkit) | Human review triggers, completion verification, agent-legible code ideas.                                                          |
| [`MansoorMajeed/Clawd`](https://github.com/MansoorMajeed/Clawd)                   | Supervised autonomy, `.scratch/` workspace pattern, continuation/compaction workflow.                                              |
| [`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff)               | `/answer`, `/files`, todo tooling patterns, self-extension philosophy.                                                             |
| [`obra/superpowers`](https://github.com/obra/superpowers)                         | Systematic debugging skill pattern.                                                                                                |
| Mario Zechner and Armin Ronacher interviews/articles                              | Pi design philosophy, small prompt surface, extension-first workflow, “agents extend instead of refactor” observation.             |

## Notes

- Upstream repositories checked did not include separate root `NOTICE` files at the time this attribution file was written.
- If this repository gets a root license, copied/adapted files listed above should still be treated according to their upstream licenses.
