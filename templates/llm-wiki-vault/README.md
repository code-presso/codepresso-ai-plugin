# LLM Wiki

내 개인 지식 베이스 — LLM이 유지·관리하고 시간이 지날수록 쌓이는 마크다운 위키.
Andrej Karpathy의 [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
패턴 기반. **Obsidian vault**(그래프로 탐색)이자 **git repo**(버전 관리)입니다.

## 사용법 (codepresso 플러그인)

- **Ingest** — `/codepresso:llm-wiki ingest <url>` → 소스를 캡처하고 연결된 페이지로 엮음
- **Query** — `/codepresso:llm-wiki query <질문>` → 인용 포함 답변, 가치 있으면 페이지로 저장
- **Lint** — `/codepresso:llm-wiki lint` → 모순/오래된 내용/고아 페이지 점검

LLM이 따르는 규칙은 [`CLAUDE.md`](./CLAUDE.md)(스키마)에 있습니다. 탐색은
[`index.md`](./index.md)에서 시작, 기록은 [`log.md`](./log.md) 참고.

## 멀티 머신 (선택)
이 vault에 private git remote를 연결하면 여러 컴퓨터에서 동기화됩니다:
```bash
git remote add origin <your-private-repo-url>
git push -u origin main
```
