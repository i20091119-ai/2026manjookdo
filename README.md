# 경남수학문화관 운영 만족도 대시보드

경남수학문화관의 4개 설문(자유관람 · 교구대여 · 학교/가족 프로그램 · 방학캠프)
응답을 월별로 집계해 보여주는 Google Apps Script 웹앱.

## 구조

```
src/
  Code.js           서버 — 스프레드시트 읽기
  index.html        클라이언트 — UI + 통계 계산
  logo.html         로고 base64
  scene.html        전경 이미지 base64
  appsscript.json   매니페스트
docs/
  유지보수_가이드.md   비개발자용 상세 수정 가이드
CLAUDE.md           작업 시 참고할 프로젝트 컨텍스트
```

## 화면 구성

비밀번호 게이트를 통과하면 11개 탭이 나온다.
각 탭은 연도·월을 선택해 아래 항목을 보여준다.

- 전체 응답수 및 대상별 응답수 요약
- 전체 만족도 분포 (전 문항 합산)
- 응답자별 만족도 분포
- 문항별 응답 분포 (응답자 드롭다운으로 필터)
- 주관식 응답 (문항별로 분리)

## 로컬 개발 (clasp)

clasp를 쓰면 로컬에서 편집하고 명령 한 줄로 반영할 수 있다.

```bash
npm install -g @google/clasp
clasp login

# .clasp.json.example을 복사해 scriptId를 채운다
cp .clasp.json.example .clasp.json

clasp push        # 로컬 → Apps Script
clasp open        # 편집기 열기
```

`scriptId`는 Apps Script 편집기의 **프로젝트 설정**에서 확인할 수 있다.

`clasp push` 후에도 웹앱에 반영하려면 배포 버전을 올려야 한다:
**배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포**

> "새 배포"는 URL이 바뀌므로 쓰지 않는다.

## clasp 없이 쓰기

`src/` 안의 파일 내용을 Apps Script 편집기에 그대로 붙여넣어도 된다.
`Code.js`는 편집기에서 `Code.gs`에 해당한다.

## 이미지 교체

1. https://www.base64-image.de 에 이미지를 올린다
2. **copy image** 로 복사
3. `src/logo.html` (또는 `scene.html`) 내용을 전부 지우고 붙여넣는다

`data:image/png;base64,` 접두사가 **정확히 한 번만** 있어야 한다.

## 문제가 생기면

`docs/유지보수_가이드.md` 의 트러블슈팅 절을 먼저 본다.
증상별로 원인과 확인 방법이 정리되어 있다.
