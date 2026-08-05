# 경남수학문화관 운영 만족도 대시보드

Google Apps Script 웹앱. 4개 구글 폼 응답 시트를 읽어
① 월말 집계 보고서와 ② 설문별 월간 만족도 통계를 보여준다.

## 아키텍처

```
src/Code.js          서버. 스프레드시트 → JSON 변환만 담당. 통계 계산 안 함.
src/index.html       클라이언트. UI + 통계 계산 전부 담당. 단일 파일.
src/appsscript.json  매니페스트 (시간대·OAuth 스코프·웹앱 접근 권한)
test/                node로 돌리는 순수 로직 테스트 (Apps Script 없이 실행됨)
```

클라이언트는 `checkPassword(pw)`로 토큰을 받고, `getAllData(token)`을 **한 번**만 호출한다.
서버가 4개 시트 + 이미지를 한 응답에 담아 보내고, 하나가 실패해도 나머지는 살려서 보낸다.
필터링·집계는 전부 클라이언트에서 한다.

로고·전경 이미지는 `logo.html` / `scene.html`이 아니라
**드라이브 파일 ID**(`LOGO_FILE_ID` / `SCENE_FILE_ID`)에서 읽어 base64로 인라인한다.
드라이브 URL(`uc?export=view`) 직접 참조는 Apps Script CSP에 막힌다.

## 배포

Apps Script 편집기 기준: 저장 → 배포 → 배포 관리 → 연필(수정) → 버전: 새 버전 → 배포.
"새 배포"를 누르면 URL이 바뀌므로 쓰지 않는다.

clasp 사용 시 `clasp push` 후 위 절차로 버전만 올리면 된다.
`src/Code.js`는 푸시되면 Apps Script에서 `Code.gs`로 보인다.

## 데이터 소스

| 설문 | 상수 | 시트 탭 |
|---|---|---|
| 자유관람 | `FREE_SS_ID` | `설문지 응답` |
| 교구대여 | `EDUC_SS_ID` | `설문지 응답` |
| 학교·가족 프로그램 | `PROG_SS_ID` | `설문지 응답` |
| 여름방학 캠프 | `CAMP_SS_ID` | `설문지 응답 시트1` |

캠프만 시트 탭 이름이 달라 `CAMP_SHEET_NAME`으로 따로 잡혀 있다.

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
`Code.js`의 `toScores(row, 시작열, 개수)`와
`index.html`의 `XXX_ITEMS` 배열 길이가 어긋나면 통계가 밀린다.
주관식 컬럼 번호도 함께 밀리므로 같이 확인한다.
문항1~4/문항5 규칙이 깨지면 월말 집계도 같이 틀어진다.

**응답자 분류 매핑은 긴 키를 먼저 검사한다.**
`FREE_PART_ENTRIES`는 배열(객체 아님)이다 —
`'초등학생 학부모'`가 `'초등학생'`보다 앞에 있어야 한다.
객체로 바꾸면 키 순서 보장이 깨져 학부모가 학생으로 집계되는 버그가 재발한다.
월말 집계 쪽 `classifyPerson()`도 같은 이유로 학부모/보호자를 맨 먼저 본다.

**설문 보기 항목은 연도별로 바뀐다.**
자유관람은 구버전(`유아 학부모`, `초등학생 학부모`...)과
신버전(`학부모 등 보호자`)이 한 시트에 섞여 있다.
`scoreToNum()`도 구버전(`매우 그렇다`)·신버전(`매우 만족`)·
복합형(`매우 만족(매우 그렇다)`)·선형배율(`5`) 네 가지를 모두 처리한다.
새 표현이 나오면 조건을 추가하되 기존 조건은 지우지 않는다.
`'매우 불만족'`을 `'불만족'`보다, `'불만족'`을 `'만족'`보다 먼저 검사해야 한다.

**`index.html`에서 `innerHTML`로 `<script>`를 넣지 않는다.**
브라우저가 실행하지 않는다. 드롭다운 핸들러는
`window._xxx`에 데이터를 올려두고 전역 함수(`onItemFilter` 등)로 처리한다.

**시트에서 온 문자열은 반드시 `escHtml()`을 거쳐 넣는다.**
주관식 본문뿐 아니라 응답자·프로그램명 같은 메타 값도 마찬가지다.

## 인증 (서버 검증)

`appsscript.json`이 `ANYONE_ANONYMOUS`라 URL을 아는 사람은 `google.script.run`으로
서버 함수를 직접 부를 수 있다. 그래서 두 겹으로 막는다.

**1. 데이터를 읽는 함수는 전부 이름 끝에 `_`를 붙였다.**
Apps Script는 `_`로 끝나는 함수를 `google.script.run`에서 호출하지 못하게 한다.
`getFreeData_` / `getEducData_` / `getProgramData_` / `getCampData_` / `collectAll_` / `getSheet_`.
⚠ **`_`를 떼면 그 함수가 외부에 그대로 열린다.**

**2. 바깥에 열린 `getAllData(token)`은 토큰을 검사한다.**

```
checkPassword(pw) → {ok:true, token}   토큰을 CacheService에 6시간 저장
getAllData(token) → requireAuth_(token) 통과해야 데이터 반환, 아니면 'AUTH_REQUIRED'
revokeToken(token)                      로그아웃(잠금 버튼)
```

비밀번호는 `Code.gs`의 `DEFAULT_PW`(기본 `3141`)에 있고, **클라이언트로 내려가지 않는다.**
스크립트 속성 `DASHBOARD_PW`를 설정하면 그 값이 우선한다 —
소스 코드에 비밀번호를 남기고 싶지 않을 때 쓴다.

무차별 대입 대비로 실패 시 `Utilities.sleep(1초)`, 10분 내 10회 이상 실패하면 5초로 늘린다.

외부에 열려 있어도 되는 함수는 이것뿐이다:
`doGet` / `checkPassword` / `revokeToken` / `getAllData` / `diagnose` / `getImages` +
순수 계산 헬퍼(`parseTs`, `scoreToNum`, `toScores`, `cell`, `yearKeys`).
`getImages`는 게이트 로고·전경용이라 인증 전에도 불러야 해서 열어 뒀다(브랜딩 이미지뿐).
`diagnose`는 편집기 실행이 아니면(`isOwner_()`) 토큰을 요구한다.

`test/auth.test.js`가 이 목록을 검사하므로, 새 함수를 공개로 추가하면 테스트가 깨진다.

클라이언트는 토큰만 `sessionStorage`에 들고 있고, 만료되면 `lockOut()`으로 게이트에 돌아간다.
비밀번호 자릿수를 바꾸면 `maxlength`와 점 표시 DOM(`d0`~`d3`)도 함께 고쳐야 한다.

## 테스트

Apps Script 없이 node로 순수 로직만 돌린다. 배포 전에 세 개 다 통과시킨다.

```bash
node test/score.test.js    # scoreToNum() — 4세대 표현 인식
node test/report.test.js   # 월말 집계 4개 표 — 2026.8 실제 수치 기준
node test/auth.test.js     # 비밀번호·토큰 + 외부 노출 함수 목록
```

`report.test.js`는 `index.html`에서 `<script>`를 떼어내 DOM 스텁 위에서 실행한다.
`auth.test.js`는 `CacheService` 등을 가짜로 끼워 넣고 `Code.js`를 통째로 실행한다.

## 디버깅

**서버 쪽** — Apps Script 편집기에서 `diagnose()`를 실행하면
시트별 행 수, B열 고유값, 점수가 전부 null인 행 수가 실행 로그에 찍힌다.
(편집기 실행은 토큰 없이 통과한다)

**클라이언트 쪽** — 로그인한 탭의 브라우저 콘솔:
```javascript
google.script.run
  .withSuccessHandler(r => console.log(r.camp.rows.slice(0,3)))
  .getAllData(sessionStorage.getItem('gnmath_token'))
```
`scores`가 전부 `null`이면 `scoreToNum()`이 표현을 인식하지 못한 것이고,
값이 엉뚱한 위치에 있으면 컬럼 인덱스가 틀린 것이다.

탭에 "해당 월의 응답이 없습니다"만 뜨면 화면이 그 달 시트의 실제 B열 값들을 같이 보여준다.
`TABS`의 `filter` 문자열과 대조하면 된다.
