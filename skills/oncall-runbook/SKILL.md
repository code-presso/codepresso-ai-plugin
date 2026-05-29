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
/codepresso:oncall-runbook exam         # 평가 이벤트 인시던트 플레이북 (§13)
/codepresso:oncall-runbook waf          # 동시접속 → WAF 망 차단 (§13.1)
/codepresso:oncall-runbook 시간연장     # 응시 시간 연장 절차 (§13.3)
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
| `error`, `에러`, `stacktrace`, `스택트레이스`, `traceback`, `예외`, `exception` | §7.4 — 에러·스택트레이스 빠른 조회 |
| `close`, `종료`, `end`, `resolve` | §9 — 인시던트 종료 |
| `postmortem`, `포스트모템` | §11 — 포스트모템 템플릿 |
| `handoff`, `인수인계` | §11.1 — 인수인계 템플릿 |
| `checklist`, `체크리스트` | §1, §3.4, §6.5, §9.1 |
| `engineer`, `엔지니어`, `rotation`, `로테이션` | §0 — 엔지니어 풀 |
| `command`, `명령어`, `cli` | §10 — 자주 쓰는 명령어 |
| `issue`, `이슈`, `matrix` | §5 — 이슈 매트릭스 |
| `exam`, `평가`, `이벤트`, `시험`, `event` | §13 — 평가 이벤트 인시던트 플레이북 (목차) |
| `사전점검`, `prep`, `프로비저닝`, `부하테스트` | §13.0 — 평가 사전 점검 |
| `waf`, `ratelimit`, `rate-limit`, `망차단`, `동시접속`, `트래픽`, `traffic` | §13.1 — WAF rate-limit 망 차단 |
| `실행지연`, `coderun부하`, `폭주`, `스케일아웃`, `throttle` | §13.2 — coderun 과부하 |
| `시간연장`, `연장`, `extend`, `extension` | §13.3 — 응시 시간 연장 |
| `screencapture`, `화면녹화`, `chrome`, `녹화권한` | §13.4 — Chrome 화면녹화 권한 |
| `무한로딩`, `loading`, `네트워크`, `zscaler` | §13.5 — 무한 로딩 판별 |
| `상태값`, `초대됨`, `접속이상`, `status` | §13.6 — 응시자 상태값 판별 |
| `부정행위`, `팝업`, `경고`, `탭전환`, `proctoring` | §13.7 / §13.9 — 부정행위 팝업·감독 검증 |
| `채점`, `제출데이터`, `정합성`, `grading`, `ai채점` | §13.8 — 제출·채점 정합성 검증 |
| `proctive`, `감독`, `녹화로그` | §13.9 — proctoring 로그 검증 |

> 평가 이벤트(동시 집약 시험) 도중 인시던트는 §13 플레이북 우선. 각 §13 카드는 기존 §4(서비스별 점검)·§6(롤백)·§7(모니터링) 절차를 링크하므로 함께 펼쳐 보여줄 것.

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
   💡 /codepresso:oncall-runbook <keyword> — rollback | sev1 | coderun | exam | waf | 시간연장 | handoff
   ```
</Steps>

<Tool_Usage>
- `Read` for `docs/oncall-runbook.md`
</Tool_Usage>
