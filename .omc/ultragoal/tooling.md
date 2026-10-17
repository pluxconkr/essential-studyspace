# Tooling inventory — what this session can use

Generated 2026-10-04 for the StudySpace ultragoal (story G001). Plugins are user-scope and all enabled; see `claude plugin list`.

## Plugins

### oh-my-claudecode@omc 5.6.1
Multi-agent orchestration system for Claude Code

- skills: 48 · agents: 19 · commands: 21 · hooks: yes · MCP server: yes
- hook events: UserPromptSubmit, SessionStart, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, PreCompact, Stop, SessionEnd
- skills: `AGENTS.md`, `agent-doc-discipline`, `ai-slop-cleaner`, `architecture-survey`, `ask`, `ask-navigator`, `autopilot`, `autoresearch`, `cancel`, `configure-notifications`, `debug`, `deep-interview`, `deepinit`, `diagram`, `drydock`, `execute`, `external-context`, `graph`, `harbor`, `hud`, `intent`, `launch`, `loft`, `map`, `minimal-code-discipline`, `minimal-prose-discipline`, `omc-doctor`, `omc-setup`, `plan`, `pr`, `project-session-manager`, `ralph`, `ralplan`, `refit`, `release`, `remember`, `research`, `review`, `self-improve`, `skill`, `skillify`, `tdd`, `team`, `trace`, `ultragoal`, `verify`, `visual-verdict`, `wiki`
- agents: `analyst`, `architect`, `code-reviewer`, `code-simplifier`, `critic`, `debugger`, `designer`, `document-specialist`, `executor`, `explore`, `git-master`, `planner`, `qa-tester`, `scientist`, `security-reviewer`, `test-engineer`, `tracer`, `verifier`, `writer`
- commands: `/ask`, `/autoresearch`, `/compact`, `/configure-notifications`, `/debug`, `/deepinit`, `/external-context`, `/hud`, `/omc-doctor`, `/omc-setup`, `/project-session-manager`, `/psm`, `/release`, `/remember`, `/self-improve`, `/skill`, `/skillify`, `/trace`, `/verify`, `/visual-verdict`, `/wiki`

### superpowers@claude-plugins-official 6.4.1
Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques

- skills: 15 · agents: 0 · commands: 0 · hooks: yes · MCP server: no
- hook events: SessionStart
- skills: `brainstorming`, `diagnosing-superpowers`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills`

### code-review@claude-plugins-official d182ca4
Automated code review for pull requests using multiple specialized agents with confidence-based scoring

- skills: 0 · agents: 0 · commands: 1 · hooks: no · MCP server: no
- commands: `/code-review`

### code-simplifier@claude-plugins-official 1.0.0
Agent that simplifies and refines code for clarity, consistency, and maintainability while preserving functionality

- skills: 0 · agents: 1 · commands: 0 · hooks: no · MCP server: no
- agents: `code-simplifier`

### security-guidance@claude-plugins-official 2.0.9
Security review for Claude-generated code. Pattern-based warnings on edits, LLM-powered diff review on Stop, and an agentic commit reviewer that catches injection, XSS, SSRF, hardcoded secrets, and 25+ other vulnerability classes.

- skills: 0 · agents: 0 · commands: 0 · hooks: yes · MCP server: no
- hook events: SessionStart, UserPromptSubmit, PostToolUse, Stop, SubagentStop

### claude-code-setup@claude-plugins-official 1.0.0
Analyze codebases and recommend tailored Claude Code automations such as hooks, skills, MCP servers, and subagents.

- skills: 1 · agents: 0 · commands: 0 · hooks: no · MCP server: no
- skills: `claude-automation-recommender`

### andrej-karpathy-skills@karpathy-skills 1.0.0
Behavioral guidelines to reduce common LLM coding mistakes, derived from Andrej Karpathy's observations on LLM coding pitfalls

- skills: 1 · agents: 0 · commands: 0 · hooks: no · MCP server: no
- skills: `karpathy-guidelines`

## Built into this Claude Code session (not plugins)

- Skills: `run`, `code-review`, `simplify`, `security-review`, `init`, `loop`, `schedule`, `update-config`, `keybindings-help`, `fewer-permission-prompts`, `workflow-authoring`, `claude-api`, `dataviz`, `artifact-design`, `artifact-diagramming`, `artifact-capabilities`, `plugin-authoring`, and the `anthropic-skills:*` document skills (docs, docx, pdf, pptx, xlsx, google-workspace, skill-creator, morning, import-memory).
- Agents: `claude`, `general-purpose`, `Explore`, `Plan`, `claude-code-guide`, `statusline-setup`, plus the plugin agents above.
- MCP (oh-my-claudecode server, ~57 tools): `lsp_*` (diagnostics, references, rename, symbols, hover, code actions), `ast_grep_search/replace`, `python_repl`, `notepad_*`, `project_memory_*`, `shared_memory_*`, `state_*`, `wiki_*`, `trace_*`, `merge_readiness_*`, `session_search`, `deepinit_manifest`, `list/load_omc_skills_*`.
- claude.ai connectors present but not authorised in this non-interactive session: Clockwise, Gmail, Google Calendar, Google Drive, Notion, Quartr. The Claude Docs connector disconnected mid-session.
- Local dev tooling installed during this work: `idb` (Facebook) for driving the headless iOS Simulator; Metro for StudySpace on port 8083 (`npx expo start --go --ios --port 8083`); the sibling's Metro on 8081 belongs to the user.

## What this ultragoal run uses

| Stage | Tool | Why |
|---|---|---|
| G002 gap analysis | `oh-my-claudecode:analyst` / `Explore` agents (read-only) | Independent second pass over the spec vs. the code |
| G003 design audit | `run` + idb driver, `oh-my-claudecode:visual-verdict`, `oh-my-claudecode:designer` | Screenshots of every state; structured verdicts; a designer's eye on type/spacing |
| G004 fixes | `lsp_diagnostics_directory`, `ast_grep_search` | Find every ad-hoc `fontSize`/`fontWeight` literal outside `theme.ts` mechanically |
| G005 features | `superpowers:test-driven-development`, `oh-my-claudecode:tdd` | Tests first for new domain logic |
| G006 optimization | `expo-doctor`, `expo export` size report, React Compiler already on | Measurable before/after |
| G007 gate | `oh-my-claudecode:ai-slop-cleaner`, `oh-my-claudecode:verify`, `/code-review` (`code-review` plugin), `security-guidance` hooks (passive) | Mandatory final gate for ultragoal completion |
| Throughout | `andrej-karpathy-skills` guidelines (also in ~/.claude/CLAUDE.md), `superpowers:verification-before-completion` | Surgical diffs; evidence before claims |

Overlaps to be aware of: oh-my-claudecode and superpowers both ship plan/tdd/review/verify skills; oh-my-claudecode's `security-reviewer`/`code-reviewer` agents overlap the `security-guidance` and `code-review` plugins. The sibling project enables `expo@claude-plugins-official` in its project settings, but that plugin is not installed at user scope.
