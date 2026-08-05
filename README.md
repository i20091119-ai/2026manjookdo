# 경남수학문화관 운영 만족도 대시보드

경남수학문화관의 4개 설문(자유관람 · 교구대여 · 학교/가족 프로그램 · 방학캠프)
응답을 모아 **월말 집계 보고서**와 **설문별 만족도 통계**를 보여주는 정적 웹 대시보드.

Apps Script를 쓰지 않는다. GitHub Actions가 구글 시트를 읽어 JSON으로 떠 두고,
GitHub Pages가 정적 사이트로 서빙한다. **배포는 `git push`.**

```
구글 시트 4개
   ↓  GitHub Actions (하루 3회 + 수동)
site/data.json
   ↓  GitHub Pages
site/index.html  ← 브라우저에서 통계 계산
```

## 구조

```
site/
  index.html        대시보드 전체 (단일 파일 · 통계 계산 포함)
  data.json         Actions가 만드는 생성물 (커밋 안 함)
  logo.png          로고 (선택 · 없으면 자동으로 숨김)
scripts/
  fetch-sheets.mjs  구글 시트 → data.json (외부 패키지 없음)
.github/workflows/
  publish.yml       데이터 갱신 & Pages 배포
test/
  score.test.js     만족도 응답 표현 인식
  report.test.js    월말 집계 4개 표
  pipeline.test.js  시트 원본 → data.json → 화면 (컬럼 매핑 검증)
docs/
  유지보수_가이드.md  비개발자용 상세 수정 가이드
legacy/
  apps-script/      예전 Apps Script 판 (참고용 · 더 이상 안 씀)
CLAUDE.md           작업 시 참고할 프로젝트 컨텍스트
```

## 화면 구성

상단에서 연도·월을 고른다. 탭 12개.

### 탭 0 — 📊 월말 집계

그 달의 보고서 4개 표를 만들어 준다. 각 표 우측 **📋 복사** 버튼을 누르면
머리글을 뺀 데이터 행이 TSV로 복사되어, 한컴/엑셀 양식의 첫 데이터 셀에 바로 붙는다.

| 표 | 내용 |
|---|---|
| 1. 운영 현황 | 총괄 집계 양식 · 7분류 (유/초/중/고/교원/보호자/일반) |
| 2. 참여자 현황 | 거제 양식 · 6분류 (유아·일반을 '그 외'로 통합) |
| 3. 만족도 통계 | 문항1~5 × 5단계 응답수 + 합계 + 만족이상 |
| 4. 만족도 결과 | 프로그램 운영(문항1~4) / 강사(문항5) 만족도 % |

> 만족도(%) = [ '만족' 이상 답변 수의 합 / (설문 응답자 수 × 설문 문항 수) ] × 100

### 탭 1~11 — 설문별 상세

자유관람 / 교구대여(수학·SW) / 학교·가족(4종) / 캠프(4종).
응답수·평균 점수·만족 이상 비율, 대상별 분포, 문항별 분포(드롭다운 필터), 주관식 응답.

## 처음 세팅 (한 번만)

1. **구글 서비스 계정**을 만들고 키 JSON을 받는다
2. 설문 응답 시트 4개를 그 서비스 계정 이메일에 **뷰어**로 공유한다
3. 저장소 Settings → Secrets → Actions 에 `GOOGLE_SERVICE_ACCOUNT_JSON` 등록
4. 저장소 Settings → Pages → Source 를 **GitHub Actions** 로 설정
5. Actions 탭 → **데이터 갱신 & 배포** → Run workflow

클릭 단위 절차는 `docs/유지보수_가이드.md`의 **2. 배포** 참고.

## 이후 사용

- **데이터만 새로 받기**: Actions 탭 → Run workflow (또는 하루 3회 자동)
- **화면·계산 수정**: `site/index.html` 고쳐서 push → 자동 재배포
- **컬럼·시트 변경**: `scripts/fetch-sheets.mjs`의 `SOURCES` 수정

## 테스트

배포 전에 돌린다. Actions에서도 자동으로 돌고, 깨지면 배포가 멈춘다.

```bash
node test/score.test.js
node test/report.test.js
node test/pipeline.test.js
```

로컬에서 실제 데이터로 확인하려면:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)" node scripts/fetch-sheets.mjs
cd site && python3 -m http.server 8000    # http://localhost:8000
```

## ⚠️ 공개 범위

**GitHub Pages 사이트는 URL을 아는 누구나 볼 수 있다.**
무료 요금제에서 Pages는 공개이고, 정적 사이트라 비밀번호를 걸어도 의미가 없어
로그인 화면을 없앴다. `data.json`도 그대로 내려받을 수 있다.

주관식 응답 원문을 공개하고 싶지 않으면
`scripts/fetch-sheets.mjs` 위쪽의

```javascript
const INCLUDE_COMMENTS = true;   // → false
```

를 `false`로 바꾼다. 통계·월말 집계는 그대로 나오고 '주관식 응답' 절만 빈다.

원본 스프레드시트 자체는 공개되지 않는다 — 서비스 계정만 읽고, 사이트에는
`data.json`에 담은 것만 나간다.
