// ============================================================
// Code.gs — 경남수학문화관 운영 만족도 통합 대시보드
//
// 이 파일은 "스프레드시트를 읽어 JSON으로 넘기는 일"만 한다.
// 통계 계산·화면 구성은 전부 index.html에서 한다.
// ============================================================

// ▼ 스프레드시트 ID 설정
const FREE_SS_ID = '1yZfJfJdEMJGZu9TMDXXDDk0edqURtIEUiwGlDRNRpag'; // 자유관람
const EDUC_SS_ID = '1_QHrQqTM4_J9rA4iw7dudEHqy2vhEzyXR7I9xrQW1Vs'; // 교구대여
const PROG_SS_ID = '1TzfWGDGqqbYxpsqgXXPT7dtWGYy7hbKBrkctFk-CO3g'; // 학교·가족 프로그램
const CAMP_SS_ID = '1csbLxMowWSNJ0LGFnrYa-Z6cC5ICJ_3FOe4UMhWqTts'; // 여름방학 캠프
const SHEET_NAME = '설문지 응답';
const CAMP_SHEET_NAME = '설문지 응답 시트1';

// ▼ 이미지 (구글 드라이브 파일 ID)
const LOGO_FILE_ID  = '1d4ApBhKXMX3Q0SnJmlBlJRQXIauUsUdH';
const SCENE_FILE_ID = '1Dq6GJOrSDYPr9w64VIQrGWZ5nkn7HkPw';

// ▼ 비밀번호 (서버 검증)
//   스크립트 속성 DASHBOARD_PW 가 있으면 그 값을 쓰고, 없으면 아래 기본값을 쓴다.
//   설정: 편집기 → 프로젝트 설정 → 스크립트 속성 → 속성 추가
//        이름 DASHBOARD_PW / 값 원하는 4자리
//   (이렇게 두면 소스 코드에 비밀번호가 남지 않는다)
const DEFAULT_PW    = '3141';
const TOKEN_TTL_SEC = 21600;  // 발급 토큰 유효시간 6시간 (CacheService 최대)

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('경남수학문화관 운영 만족도')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ══════════════════════════════════════════════════════════
//  인증
//
//  웹앱이 ANYONE_ANONYMOUS로 배포되어 있어, URL을 아는 사람은
//  google.script.run으로 서버 함수를 직접 부를 수 있다.
//  그래서 데이터를 읽는 함수는 전부 이름 끝에 _ 를 붙여
//  google.script.run에서 호출할 수 없게 막고(Apps Script 규칙),
//  바깥에 노출되는 getAllData()는 토큰을 검사한다.
//
//  ⚠ 이름 끝의 _ 를 떼면 그 함수가 외부에 그대로 열린다. 떼지 말 것.
// ══════════════════════════════════════════════════════════

function currentPassword_() {
  const p = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PW');
  return (p && p.trim()) ? p.trim() : DEFAULT_PW;
}

/**
 * 비밀번호 확인 → 성공하면 토큰 발급.
 * 비밀번호 자체는 클라이언트에 내려가지 않는다.
 */
function checkPassword(pw) {
  const cache   = CacheService.getScriptCache();
  const failKey = 'pwfail';
  const fails   = parseInt(cache.get(failKey) || '0', 10);

  if (String(pw == null ? '' : pw).trim() !== currentPassword_()) {
    cache.put(failKey, String(fails + 1), 600);   // 10분 창
    // 무차별 대입 속도를 떨어뜨린다. 실패가 쌓이면 더 오래 기다리게 한다.
    Utilities.sleep(fails >= 10 ? 5000 : 1000);
    return { ok: false };
  }

  cache.remove(failKey);
  const token = Utilities.getUuid();
  cache.put('tok_' + token, '1', TOKEN_TTL_SEC);
  return { ok: true, token: token };
}

/** 토큰이 유효하지 않으면 예외를 던진다. 유효하면 만료를 연장한다. */
function requireAuth_(token) {
  const t = String(token == null ? '' : token);
  if (!t) throw new Error('AUTH_REQUIRED');
  const cache = CacheService.getScriptCache();
  if (cache.get('tok_' + t) !== '1') throw new Error('AUTH_REQUIRED');
  cache.put('tok_' + t, '1', TOKEN_TTL_SEC);
}

/** 로그아웃 — 토큰을 무효화한다. */
function revokeToken(token) {
  const t = String(token == null ? '' : token);
  if (t) CacheService.getScriptCache().remove('tok_' + t);
  return true;
}

// ──────────────────────────────────────────
// 공통 유틸
// ──────────────────────────────────────────
function parseTs(ts) {
  if (ts instanceof Date) {
    return { year: ts.getFullYear(), month: ts.getMonth() + 1, day: ts.getDate() };
  }
  // '2026. 8. 5 오후 2:02' / '2026-08-05 14:02' / '2026/8/5' 모두 허용
  const m = String(ts).match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

/**
 * 만족도 응답 텍스트 → 1~5 점수. 인식 못 하면 null(통계에서 제외).
 *
 * 세 세대의 표현이 한 시트에 섞여 있어 전부 받아야 한다.
 *   구버전  : 매우 그렇다 / 그렇다 / 보통이다 / 그렇지 않다 / 전혀 그렇지 않다
 *   신버전  : 매우 만족 / 만족 / 보통 / 불만족 / 매우 불만족
 *   복합형  : 매우 만족(매우 그렇다) ...
 *   선형배율: 5 / 4 / 3 / 2 / 1  (구글 폼 '선형 배율' 문항)
 *
 * ⚠ 새 표현이 생기면 조건을 "추가"만 하고 기존 조건은 지우지 말 것.
 * ⚠ '매우 불만족'을 '불만족'보다, '불만족'을 '만족'보다 먼저 검사해야 한다.
 */
function scoreToNum(str) {
  const s = String(str == null ? '' : str).trim();
  if (!s) return null;

  // 선형 배율(숫자) 문항
  if (/^[1-5](\.0+)?$/.test(s)) return parseInt(s, 10);

  // 앞에서부터 시작하는 표현 (복합형 '매우 만족(매우 그렇다)' 포함)
  if (s.indexOf('매우 불만족') === 0 || s.indexOf('매우불만족') === 0) return 1;
  if (s.indexOf('매우 만족') === 0 || s.indexOf('매우만족') === 0) return 5;
  if (s.indexOf('전혀 그렇지 않다') === 0) return 1;
  if (s.indexOf('매우 그렇다') === 0) return 5;
  if (s.indexOf('불만족') === 0 || s.indexOf('그렇지 않다') === 0) return 2;
  if (s.indexOf('만족') === 0 || s.indexOf('그렇다') === 0) return 4;
  if (s.indexOf('보통') === 0) return 3;

  // 앞에 다른 말이 붙은 변형 대비 (순서 동일하게 유지)
  if (s.includes('매우 불만족') || s.includes('매우불만족')) return 1;
  if (s.includes('매우 만족') || s.includes('매우만족')) return 5;
  if (s.includes('전혀 그렇지 않다')) return 1;
  if (s.includes('매우 그렇다')) return 5;
  if (s.includes('불만족') || s.includes('그렇지 않다')) return 2;
  if (s.includes('만족') || s.includes('그렇다')) return 4;
  if (s.includes('보통')) return 3;

  return null;
}

function getSheet_(ssId) {
  const ss = SpreadsheetApp.openById(ssId);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function toScores(row, from, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(scoreToNum(row[from + i]));
  return out;
}

function cell(row, idx) {
  return String(row[idx] == null ? '' : row[idx]).trim();
}

function yearKeys(obj) {
  return Object.keys(obj).map(function (y) { return parseInt(y, 10); })
                         .sort(function (a, b) { return a - b; });
}

// ──────────────────────────────────────────
// [1] 자유관람
// A=타임스탬프, B=참여자, E~L(4~11)=문항8개, O(14)=주1, P(15)=주2
//   문항 = 프1~프4(4~7) + 시1~시4(8~11)
// ──────────────────────────────────────────
function getFreeData_() {
  const data = getSheet_(FREE_SS_ID).getDataRange().getValues();
  const rows = [];
  const yearSet = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet[d.year] = true;
    rows.push({
      year: d.year, month: d.month, day: d.day,
      participant: cell(row, 1),
      scores: toScores(row, 4, 8),
      comment1: cell(row, 14),
      comment2: cell(row, 15),
    });
  }
  return { years: yearKeys(yearSet), rows: rows };
}

// ──────────────────────────────────────────
// [2] 교구대여
// A=타임스탬프, B=교구종류, C=학교급, D=설문자
// E~H(4~7)=문항4개, I(8)=주관식
// ──────────────────────────────────────────
function getEducData_() {
  const data = getSheet_(EDUC_SS_ID).getDataRange().getValues();
  const rows = [];
  const yearSet = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet[d.year] = true;
    rows.push({
      year: d.year, month: d.month, day: d.day,
      toolType:    cell(row, 1), // 수학교구 / SW교구
      schoolLevel: cell(row, 2), // 초등학교 / 중학교 / 고등학교
      respondent:  cell(row, 3), // 학생 / 교원
      scores: toScores(row, 4, 4),
      comment1: cell(row, 8),
    });
  }
  return { years: yearKeys(yearSet), rows: rows };
}

// ──────────────────────────────────────────
// [3] 학교·가족 프로그램
// A=타임스탬프, B=프로그램종류, C=설문자
// D~H(3~7)=프1~프5, I~L(8~11)=시1~시4
// M(12)=주1, N(13)=주2, O(14)=주3
// ──────────────────────────────────────────
function getProgramData_() {
  const data = getSheet_(PROG_SS_ID).getDataRange().getValues();
  const rows = [];
  const yearSet = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet[d.year] = true;
    rows.push({
      year: d.year, month: d.month, day: d.day,
      programType: cell(row, 1),
      respondent:  cell(row, 2),
      scores: toScores(row, 3, 9),
      comment1: cell(row, 12),
      comment2: cell(row, 13),
      comment3: cell(row, 14),
    });
  }
  return { years: yearKeys(yearSet), rows: rows };
}

// ──────────────────────────────────────────
// [4] 여름방학 캠프
// A=타임스탬프, B=캠프종류
// C~G(2~6)=문항5개, H(7)=주1, I(8)=주2
//   문항5가 강사 만족도라서 학교·가족 프로그램과 구조가 같다.
//   응답자 구분 컬럼이 없다 — 학교급은 캠프 종류명으로 판별한다.
// ──────────────────────────────────────────
function getCampData_() {
  const ss    = SpreadsheetApp.openById(CAMP_SS_ID);
  const sheet = ss.getSheetByName(CAMP_SHEET_NAME) || ss.getSheets()[0];
  const data  = sheet.getDataRange().getValues();
  const rows  = [];
  const yearSet = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet[d.year] = true;
    rows.push({
      year: d.year, month: d.month, day: d.day,
      campType: cell(row, 1),
      scores: toScores(row, 2, 5),
      comment1: cell(row, 7), // 주1 기억에 남는 활동
      comment2: cell(row, 8), // 주2 강사 관련 의견
    });
  }
  return { years: yearKeys(yearSet), rows: rows };
}

// ──────────────────────────────────────────
// 이미지 — 드라이브 파일을 base64로 인라인해 반환
// (드라이브 URL 직접 참조는 Apps Script CSP에 막힌다)
// ──────────────────────────────────────────
function getImages() {
  try {
    const logoBlob  = DriveApp.getFileById(LOGO_FILE_ID).getBlob();
    const sceneBlob = DriveApp.getFileById(SCENE_FILE_ID).getBlob();
    return {
      logo:  'data:' + (logoBlob.getContentType()  || 'image/png')  + ';base64,' + Utilities.base64Encode(logoBlob.getBytes()),
      scene: 'data:' + (sceneBlob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(sceneBlob.getBytes()),
    };
  } catch (e) {
    return { logo: '', scene: '', error: e.message };
  }
}

// ──────────────────────────────────────────
// 4개 시트 + 이미지를 한 덩어리로 모은다 (내부용, 인증 검사 없음)
// 하나가 실패해도 나머지는 살려서 보낸다.
// ──────────────────────────────────────────
function collectAll_() {
  const out = { free: null, educ: null, prog: null, camp: null, images: null, errors: {} };
  const jobs = [
    ['free',   getFreeData_],
    ['educ',   getEducData_],
    ['prog',   getProgramData_],
    ['camp',   getCampData_],
    ['images', getImages],
  ];
  for (let i = 0; i < jobs.length; i++) {
    const key = jobs[i][0];
    try {
      out[key] = jobs[i][1]();
    } catch (e) {
      out[key] = (key === 'images') ? { logo: '', scene: '' } : { years: [], rows: [] };
      out.errors[key] = String(e && e.message ? e.message : e);
    }
  }
  return out;
}

// ──────────────────────────────────────────
// 클라이언트가 부르는 유일한 데이터 함수.
// checkPassword()로 받은 토큰이 있어야 응답한다.
// google.script.run 왕복도 5회 → 1회로 준다.
// ──────────────────────────────────────────
function getAllData(token) {
  requireAuth_(token);
  return collectAll_();
}

/** 편집기에서 직접 실행 중인지 (익명 웹앱 호출과 구분) */
function isOwner_() {
  try {
    const active = Session.getActiveUser().getEmail();
    return !!active && active === Session.getEffectiveUser().getEmail();
  } catch (e) {
    return false;
  }
}

// ──────────────────────────────────────────
// 진단용 — Apps Script 편집기에서 이 함수를 직접 실행한다.
// 시트에 실제로 어떤 값이 들어오는지 실행 로그로 확인할 수 있다.
// "해당 월의 응답이 없습니다"만 뜰 때 여기부터 본다.
// ──────────────────────────────────────────
function diagnose(token) {
  if (!isOwner_()) requireAuth_(token);   // 편집기 실행이면 토큰 없이 통과
  const all = collectAll_();
  const keyOf = { free: 'participant', educ: 'toolType', prog: 'programType', camp: 'campType' };
  ['free', 'educ', 'prog', 'camp'].forEach(function (k) {
    const rows = (all[k] || {}).rows || [];
    const uniq = {};
    rows.forEach(function (r) { uniq[r[keyOf[k]]] = (uniq[r[keyOf[k]]] || 0) + 1; });
    Logger.log('[%s] %s행 · 연도 %s', k, rows.length, JSON.stringify((all[k] || {}).years));
    Logger.log('    %s 고유값: %s', keyOf[k], JSON.stringify(uniq));
    const nulls = rows.filter(function (r) {
      return r.scores.every(function (s) { return s === null; });
    }).length;
    if (nulls) Logger.log('    ⚠ 점수가 전부 null인 행 %s개 — scoreToNum() 확인 필요', nulls);
  });
  if (Object.keys(all.errors).length) Logger.log('오류: %s', JSON.stringify(all.errors));
  return all.errors;
}
