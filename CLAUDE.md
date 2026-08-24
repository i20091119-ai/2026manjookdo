# 경남수학문화관 운영 만족도 대시보드

GitHub Pages 정적 대시보드. 4개 구글 폼 응답 시트를 읽어
① 월말 집계 보고서와 ② 설문별 월간 만족도 통계를 보여준다.

## 아키텍처

Apps Script를 쓰지 않는다. **정적 사이트 + 빌드 타임 데이터 수집**이다.

```
구글 시트 4개
   ↓  GitHub Actions (하루 3회 + 수동 + push)
site/data.json              ← 생성물. 커밋하지 않는다(.gitignore)
   ↓  GitHub Pages
site/index.html             ← 브라우저가 fetch해서 통계 계산
```

```
site/index.html       대시보드 전체. UI + 통계 계산. 단일 파일.
scripts/fetch-sheets.mjs  구글 시트 → data.json. 외부 패키지 없음(node 내장만).
.github/workflows/publish.yml  테스트 → 시트 읽기 → Pages 배포
test/                 node로 돌리는 순수 로직 테스트
legacy/apps-script/   예전 Apps Script 판. 참고용, 더 이상 안 씀.
```

서버가 없다. Pages가 공개라 클라이언트 비밀번호는 무의미하므로,
대신 **`data.json` 자체를 암호화**한다 (AES-256-GCM, 키는 PBKDF2-SHA256 60만 회).
빌드 쪽 `encryptPayload()` 와 화면 쪽 `decryptPayload()` 가 짝이다 —
한쪽만 고치면 `test/crypto.test.js` 가 잡는다.
`fetch-sheets.mjs`가 `parseTs` / `scoreToNum` / `toScores` / `cell`을 갖고 있고,
`site/index.html`은 이미 점수로 변환된 데이터를 받아 집계만 한다.

로고는 `site/logo.png`에 파일로 둔다. 없으면 `applyImages()`가 조용히 숨긴다.

## 배포

`git push` 하면 끝. `site/**` 또는 `scripts/**`가 바뀌면 Actions가 자동으로
테스트 → 시트 읽기 → Pages 배포까지 한다.
데이터만 새로 받고 싶으면 Actions 탭에서 수동 실행한다.

사전 준비(한 번만): 시크릿 두 개(`GOOGLE_SERVICE_ACCOUNT_JSON`, `DASHBOARD_PASSWORD`)를 넣고,
시트 4개를 서비스 계정에 뷰어로 공유하고, Settings → Pages → Source를 GitHub Actions로 둔다.

## 데이터 소스

시트 ID·탭 이름·컬럼 매핑이 전부 `scripts/fetch-sheets.mjs`의
`SOURCES` 객체 한 곳에 모여 있다.

| 키 | 설문 | 시트 탭 | 범위 |
|---|---|---|---|
| `free` | 자유관람 | `설문지 응답` | A:P |
| `educ` | 교구대여 | `설문지 응답` | A:I |
| `prog` | 학교·가족 프로그램 | `설문지 응답` | A:O |
| `camp` | 여름방학 캠프 | `설문지 응답 시트1` | A:I |

캠프만 탭 이름이 다르다. 탭 이름을 못 찾으면 첫 번째 탭으로 넘어간다
(`readValues()`의 400/404 폴백).

## 컬럼 매핑 (0-based)

**자유관람** — B=참여자(1), E~L=문항8개(4~11), O=주1(14), P=주2(15)
- 문항 = 프1~프4(4~7) + 시1~시4(8~11)

**교구대여** — B=교구종류(1), C=학교급(2), D=설문자(3), E~H=문항4개(4~7), I=주관식(8)
- 문항이 학생/교원 공용 컬럼. 응답자에 따라 문항 텍스트가 다르므로
  `EDUC_ITEMS_STUDENT` / `EDUC_ITEMS_TEACHER` 두 벌을 두고 드롭다운에서 전환한다.
- 학생+교원 합산 뷰는 `EDUC_ITEMS_COMBINED`(중립 라벨)를 쓴다.
  한쪽 문구를 붙이면 다른 쪽 응답이 엉뚱한 문항에 달린 표가 된다.

**학교·가족** — B=프로그램종류(1), C=설문자(2), D~H=프1~5(3~7), I~L=시1~4(8~11), M~O=주1~3(12~14)

**캠프** — B=캠프종류(1), C~G=문항5개(2~6), H=주1(7), I=주2(8)
- 응답자 구분 컬럼 없음. 캠프 종류명에 학교급이 포함되어 있다(`schoolLevelOfCamp()`).
- 문항5가 강사 만족도라 학교·가족 프로그램과 구조가 같다.

**모든 설문에서 문항N = `scores[N-1]`, 문항1~4 = 프로그램 운영, 문항5 = 강사.**
월말 집계는 이 규칙에만 기대고 있다.

## 탭 구조 (12개)

`TABS` 배열 하나에서 탭 버튼 HTML까지 자동 생성된다 — 탭 추가·삭제는 여기만 고친다.
`filter` 값이 각 시트 B열 값과 정확히 일치해야 한다.

```
0        월말 집계 (보고서)
1        자유관람 (필터 없음)
2~3      교구대여 — 수학교구 / SW교구
4~7      학교·가족 — 학교수학체험프로그램 / 학교SW체험프로그램 /
                    가족수학체험프로그램 / 가족SW체험프로그램
8~11     캠프 — 초등학생 체험수학캠프 / 초등학생 SW캠프 /
                중학생 체험수학캠프 / 고등학생 인공지능수학캠프
```

`render()`는 탭 번호 범위가 아니라 `TABS[i].kind`로 빌더를 고른다
(`buildReport` / `buildFree` / `buildEduc` / `buildProg` / `buildCamp`).
탭을 중간에 끼워 넣어도 분기가 안 깨진다.

## 월말 집계 (탭 0)

표 4개를 그리고 각각 TSV 복사 버튼을 붙인다.

| 표 | 내용 | 분류 |
|---|---|---|
| 1 | 운영 현황 (총괄 집계 양식) | 7분류 유/초/중/고/교원/보호자/일반 |
| 2 | 참여자 현황 (거제 양식) | 6분류 — 유아·일반을 '그 외'로 통합 |
| 3 | 만족도 통계 | 문항1~5 × 5단계 + 합계 + 만족이상 |
| 4 | 만족도 결과 | 만족도(%) = 만족이상 합 / (응답자수 × 문항수) × 100 |

행 정의는 `REPORT_PROGRAMS` 하나에 모여 있다.
`src:null`인 행(페스티벌·기타·직무연수)은 원천이 없어 회색 양식으로만 나온다.

캠프는 **여러 캠프 종류를 한 행으로 합산**한다 — `filter`에 배열을 준다.
```
1-(03) 학생체험수학캠프 = 초등학생 체험수학캠프 + 중학생 체험수학캠프 + 고등학생 인공지능수학캠프
1-(04) 학생SW체험캠프   = 초등학생 SW캠프
```

## 작업 시 주의사항

**문항 개수를 바꿀 때는 두 파일을 함께 고친다.**
`scripts/fetch-sheets.mjs`의 `toScores(row, 시작열, 개수)`와
`site/index.html`의 `XXX_ITEMS` 배열 길이가 어긋나면 통계가 밀린다.
`SOURCES`의 `range`(예: `A:P`)도 함께 늘려야 한다 — 안 그러면 값이 안 온다.
주관식 컬럼 번호도 함께 밀리므로 같이 확인한다.
문항1~4/문항5 규칙이 깨지면 월말 집계도 같이 틀어진다.

**응답자 분류 매핑은 긴 키를 먼저 검사한다.**
`FREE_PART_ENTRIES`는 배열(객체 아님)이다 —
`'초등학생 학부모'`가 `'초등학생'`보다 앞에 있어야 한다.
객체로 바꾸면 키 순서 보장이 깨져 학부모가 학생으로 집계되는 버그가 재발한다.
월말 집계 쪽 `classifyPerson()`도 같은 이유로 학부모/보호자를 맨 먼저 본다.

**응답자 분류는 '학생'으로 뭉개지 말고 학년(유아/초/중/고)까지 구분한다.**
`mapProgRespondent()`가 한때 초·중·고를 전부 `'학생'` 하나로 합쳐서 학년 구분 없이
나오는 버그가 있었다. `classifyPerson()`(월말 집계)과 같은 분류·같은 폴백 규칙
("학년 표기 없는 구버전 응답은 초등학생으로 본다")을 쓴다 — 두 함수가 어긋나면
상세 탭과 월말 집계 숫자가 서로 안 맞게 된다.

**설문 보기 항목은 연도별로 바뀐다.**
자유관람은 구버전(`유아 학부모`, `초등학생 학부모`...)과
신버전(`학부모 등 보호자`)이 한 시트에 섞여 있다.
`scoreToNum()`도 구버전(`매우 그렇다`)·신버전(`매우 만족`)·
복합형(`매우 만족(매우 그렇다)`)·선형배율(`5`) 네 가지를 모두 처리한다.
새 표현이 나오면 조건을 추가하되 기존 조건은 지우지 않는다.
`'매우 불만족'`을 `'불만족'`보다, `'불만족'`을 `'만족'`보다 먼저 검사해야 한다.

**`site/index.html`에서 `innerHTML`로 `<script>`를 넣지 않는다.**
브라우저가 실행하지 않는다. 드롭다운 핸들러는
`window._xxx`에 데이터를 올려두고 전역 함수(`onItemFilter` 등)로 처리한다.

**시트에서 온 문자열은 반드시 `escHtml()`을 거쳐 넣는다.**
주관식 본문뿐 아니라 응답자·프로그램명 같은 메타 값도 마찬가지다.

**`site/index.html`은 외부 스크립트를 부르지 않는다.**
CDN 없이 단일 파일로 유지한다. `pipeline.test.js`가 이걸 검사한다.

## 공개 범위

Pages 사이트 자체는 URL을 아는 누구나 열 수 있다. 그래서 `data.json` 을 암호화한다.
비밀번호는 `DASHBOARD_PASSWORD` 시크릿에만 있고 코드에는 없다 —
`crypto.test.js` 가 `site/index.html` 에 비밀번호가 섞여 들어갔는지 검사한다.

**4자리는 1만 가지라 작정하면 대입으로 뚫린다.** 우연한 열람은 확실히 막지만
그 이상을 원하면 비밀번호를 길게 써야 한다. 이 트레이드오프는 사용자가 알고 고른 것이다.

`DASHBOARD_PASSWORD` 가 없으면 빌드가 실패한다 —
설정 누락으로 통계가 평문 공개되는 사고를 막기 위해 일부러 그렇게 뒀다.

주관식 원문을 빼려면 `scripts/fetch-sheets.mjs`의 `INCLUDE_COMMENTS`를 `false`로.
통계·월말 집계는 그대로 나오고 '주관식 응답' 절만 빈다.

원본 스프레드시트 자체는 공개되지 않는다 — 서비스 계정만 읽고,
사이트에는 `data.json`에 담은 것만 나간다.
`SOURCES`에 없는 컬럼은 아예 JSON에 실리지 않는다.

## 테스트

Apps Script 없이 node로만 돈다. Actions가 배포 전에 자동으로 돌리고,
깨지면 배포가 멈춘다.

```bash
node test/score.test.js     # scoreToNum() — 4세대 표현 인식
node test/report.test.js    # 월말 집계 4개 표 — 2026.8 실제 수치 기준
node test/pipeline.test.js  # 시트 원본 → data.json → 화면 (컬럼 매핑)
node test/crypto.test.js    # 빌드 암호화 → 화면 복호화 왕복
```

`pipeline.test.js`가 제일 중요하다. `fetch-sheets.mjs`의 `SOURCES` map 함수를
그대로 끌어와 가짜 시트 한 줄을 흘려보내므로, 컬럼 번호가 밀리면 여기서 잡힌다.
`report.test.js`는 `site/index.html`에서 `<script>`를 떼어내 DOM 스텁 위에서 실행한다.

## 디버깅

**데이터가 안 맞을 때** — Actions 탭에서 마지막 실행 로그를 본다.
`fetch-sheets.mjs`가 시트별 행 수와 연도를 찍는다.

로컬에서 실제 데이터로 확인:
```bash
GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" DASHBOARD_PASSWORD=3141 \
  node scripts/fetch-sheets.mjs
cd site && python3 -m http.server 8000   # file:// 로 열면 Web Crypto가 안 돈다
```

**브라우저에서** — 콘솔에 `DATA`가 그대로 떠 있다.
```javascript
DATA.camp.rows.slice(0,3)
```
`scores`가 전부 `null`이면 `scoreToNum()`이 표현을 인식하지 못한 것이고,
값이 엉뚱한 위치에 있으면 `SOURCES`의 컬럼 인덱스가 틀린 것이다.

탭에 "해당 월의 응답이 없습니다"만 뜨면 화면이 그 달의 실제 B열 값들을 같이 보여준다.
`TABS`의 `filter` 문자열과 대조하면 된다.

헤더 우측의 '갱신 …' 시각이 데이터를 마지막으로 읽어 온 때다.
**화면은 실시간이 아니다** — 시트에 새 응답이 들어와도 워크플로가 돌기 전엔 안 보인다.
