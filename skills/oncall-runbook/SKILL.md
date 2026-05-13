---
name: oncall-runbook
description: Look up and navigate the on-call runbook (docs/oncall-runbook.md)
---

<Purpose>
Surface the right section of the team on-call runbook for whatever the on-call engineer is dealing with. Defaults to a navigable table of contents; with a keyword, jumps directly to the matching section(s).
</Purpose>

<Use_When>
- Slash command `/codepresso:oncall-runbook` is invoked (with or without argument)
- User asks "runbook", "온콜 매뉴얼", "rollback 절차", "sev1 대응"
- On-call engineer needs incident response guidance fast
</Use_When>

<Do_Not_Use_When>
- User wants the schedule, not the procedure (use `codepresso:oncall`)
- Editing the runbook itself (open `docs/oncall-runbook.md` directly)
</Do_Not_Use_When>

## Usage

```
/codepresso:oncall-runbook              # Table of contents
/codepresso:oncall-runbook sev1         # Sev1 response steps
/codepresso:oncall-runbook rollback     # Rollback procedure
/codepresso:oncall-runbook coderun      # Coderun troubleshooting
/codepresso:oncall-runbook <keyword>    # Jump to the most relevant section(s)
```

## Keyword → Section Map

| Keyword | Section |
|---------|---------|
| `sev`, `severity`, `triage` | §3 — 인시던트 첫 10분 |
| `sev1`, `sev2`, `sev3`, `sev4` | §3.2 Severity 기준 + 부록 A |
| `rollback`, `롤백` | §6 — 롤백 절차 |
| `escalate`, `에스컬레이션` | §8 — 에스컬레이션 |
| `main`, `api`, `5xx` | §4.1 — backend/main |
| `proxy`, `lsp`, `websocket` | §4.2 — backend/proxy |
| `coderun`, `코드실행`, `실행` | §4.3 — backend/coderun |
| `admin` | §4.4 — backend/admin |
| `frontend`, `프론트`, `cloudfront`, `s3` | §4.5–4.6 — frontend |
| `infra`, `terraform` | §4.7 — infra |
| `monitoring`, `모니터링`, `log`, `로그` | §7 — 모니터링 & 로그 |
| `close`, `종료`, `end`, `resolve` | §9 — 인시던트 종료 |
| `postmortem`, `포스트모템` | §11 — 포스트모템 템플릿 |
| `handoff`, `인수인계` | §11.1 — 인수인계 템플릿 |
| `checklist`, `체크리스트` | §1, §3.4, §6.5, §9.1 |
| `engineer`, `엔지니어`, `rotation`, `로테이션` | §0 — 엔지니어 풀 |
| `command`, `명령어`, `cli` | §10 — 자주 쓰는 명령어 |
| `issue`, `이슈`, `matrix` | §5 — 이슈 매트릭스 |

<Steps>
1. Read `docs/oncall-runbook.md` (relative to current project — the monorepo) fully.
   If the file is missing, tell the user where it should live and stop.

2. **No argument**: Display the table of contents with one-line summaries per section.
   Highlight the three emergency sections:
   ```
   🚨 Emergency: §3 (첫 10분) · §6 (롤백) · §8 (에스컬레이션)
   ```

3. **With argument**: Match the argument against the keyword map above (case-insensitive,
   Korean/English both accepted). If multiple sections match, show them all.

4. Display the matched section(s) in full, with a header indicating the section number and title.

5. End every response with a navigation hint:
   ```
   💡 /codepresso:oncall-runbook <keyword> — rollback | sev1 | coderun | handoff | postmortem
   ```
</Steps>

<Tool_Usage>
- `Read` for `docs/oncall-runbook.md`
</Tool_Usage>
