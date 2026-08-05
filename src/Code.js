// ============================================================
// Code.gs — 경남수학문화관 운영 만족도 통합 대시보드
// ============================================================

// ▼ 스프레드시트 ID 설정
const FREE_SS_ID = '1yZfJfJdEMJGZu9TMDXXDDk0edqURtIEUiwGlDRNRpag'; // 자유관람
const EDUC_SS_ID = '1_QHrQqTM4_J9rA4iw7dudEHqy2vhEzyXR7I9xrQW1Vs'; // 교구대여
const PROG_SS_ID = '1TzfWGDGqqbYxpsqgXXPT7dtWGYy7hbKBrkctFk-CO3g'; // 학교·가족 프로그램
const CAMP_SS_ID = '1csbLxMowWSNJ0LGFnrYa-Z6cC5ICJ_3FOe4UMhWqTts'; // 여름방학 캠프
const SHEET_NAME = '설문지 응답';
const CAMP_SHEET_NAME = '설문지 응답 시트1';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('경남수학문화관 운영 만족도')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── 공통 유틸 ──
function parseTs(ts) {
  if (ts instanceof Date) {
    return { year: ts.getFullYear(), month: ts.getMonth() + 1, day: ts.getDate() };
  }
  const m = String(ts).match(/(\d{4})\.\s*(\d+)\.\s*(\d+)/);
  if (!m) return null;
  return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) };
}

function scoreToNum(str) {
  const s = (str || '').trim();
  if (s.includes('매우 만족') || s.includes('매우만족')) return 5;
  if (s.includes('매우 불만족') || s.includes('매우불만족')) return 1;
  if (s === '만족') return 4;
  if (s === '불만족') return 2;
  if (s === '보통') return 3;
  if (s.includes('매우 그렇다')) return 5;
  if (s === '그렇다') return 4;
  if (s === '보통이다') return 3;
  if (s === '그렇지 않다') return 2;
  if (s.includes('전혀 그렇지 않다')) return 1;
  if (s.startsWith('매우 만족') || s.startsWith('매우만족')) return 5;
  if (s.startsWith('만족')) return 4;
  if (s.startsWith('보통')) return 3;
  if (s.startsWith('불만족')) return 2;
  return null;
}

function getSheet(ssId) {
  const ss = SpreadsheetApp.openById(ssId);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

// ──────────────────────────────────────────
// [4] 여름방학 캠프
// A=타임스탬프, B=캠프종류
// C~G(2~6)=문항5개, H(7)=주1, I(8)=주2
// ──────────────────────────────────────────
function getCampData() {
  const ss    = SpreadsheetApp.openById(CAMP_SS_ID);
  const sheet = ss.getSheetByName(CAMP_SHEET_NAME) || ss.getSheets()[0];
  const data  = sheet.getDataRange().getValues();
  const rows  = [];
  const yearSet = new Set();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet.add(d.year);
    rows.push({
      year: d.year, month: d.month, day: d.day,
      campType: String(row[1] || '').trim(), // 캠프 종류
      scores: [row[2], row[3], row[4], row[5], row[6]]
               .map(v => scoreToNum(String(v || '').trim())),
      comment1: String(row[7] || '').trim(), // 주1 기억에 남는 활동
      comment2: String(row[8] || '').trim(), // 주2 강사 관련 의견
    });
  }
  return { years: [...yearSet].sort(), rows };
}

// ──────────────────────────────────────────
// [1] 자유관람
// A=타임스탬프, B=참여자, E~L(4~11)=문항8개, O(14)=주1, P(15)=주2
// ──────────────────────────────────────────
function getFreeData() {
  const sheet = getSheet(FREE_SS_ID);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  const yearSet = new Set();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet.add(d.year);
    rows.push({
      year: d.year, month: d.month, day: d.day,
      participant: String(row[1] || '').trim(),
      scores: [row[4],row[5],row[6],row[7],row[8],row[9],row[10],row[11]]
               .map(v => scoreToNum(String(v||'').trim())),
      comment1: String(row[14] || '').trim(),
      comment2: String(row[15] || '').trim(),
    });
  }
  return { years: [...yearSet].sort(), rows };
}

// ──────────────────────────────────────────
// [2] 교구대여
// A=타임스탬프, B=교구종류, C=학교급, D=설문자
// E~H(4~7)=문항4개, I(8)=주관식
// ──────────────────────────────────────────
function getEducData() {
  const sheet = getSheet(EDUC_SS_ID);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  const yearSet = new Set();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet.add(d.year);
    rows.push({
      year: d.year, month: d.month, day: d.day,
      toolType:    String(row[1] || '').trim(), // 수학교구 / SW교구
      schoolLevel: String(row[2] || '').trim(), // 초등학교 / 중학교 / 고등학교
      respondent:  String(row[3] || '').trim(), // 학생 / 교원
      scores: [row[4],row[5],row[6],row[7]]
               .map(v => scoreToNum(String(v||'').trim())),
      comment1: String(row[8] || '').trim(),
    });
  }
  return { years: [...yearSet].sort(), rows };
}

// ──────────────────────────────────────────
// [3] 학교·가족 프로그램
// A=타임스탬프, B=프로그램종류, C=설문자
// D~H(3~7)=프1~프5, I~L(8~11)=시1~시4
// M(12)=주1, N(13)=주2, O(14)=주3
// ──────────────────────────────────────────
function getProgramData() {
  const sheet = getSheet(PROG_SS_ID);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  const yearSet = new Set();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const d = parseTs(row[0]);
    if (!d) continue;
    yearSet.add(d.year);
    rows.push({
      year: d.year, month: d.month, day: d.day,
      programType: String(row[1] || '').trim(),
      respondent:  String(row[2] || '').trim(),
      scores: [row[3],row[4],row[5],row[6],row[7],row[8],row[9],row[10],row[11]]
               .map(v => scoreToNum(String(v||'').trim())),
      comment1: String(row[12] || '').trim(),
      comment2: String(row[13] || '').trim(),
      comment3: String(row[14] || '').trim(),
    });
  }
  return { years: [...yearSet].sort(), rows };
}

// ──────────────────────────────────────────
// 이미지 base64 변환 — 구글 드라이브 파일을
// Apps Script에서 직접 읽어 base64로 반환
// ──────────────────────────────────────────
const LOGO_FILE_ID  = '1d4ApBhKXMX3Q0SnJmlBlJRQXIauUsUdH';
const SCENE_FILE_ID = '1Dq6GJOrSDYPr9w64VIQrGWZ5nkn7HkPw';

function getImages() {
  try {
    const logoFile  = DriveApp.getFileById(LOGO_FILE_ID);
    const sceneFile = DriveApp.getFileById(SCENE_FILE_ID);

    const logoBlob  = logoFile.getBlob();
    const sceneBlob = sceneFile.getBlob();

    const logoB64  = Utilities.base64Encode(logoBlob.getBytes());
    const sceneB64 = Utilities.base64Encode(sceneBlob.getBytes());

    const logoMime  = logoBlob.getContentType()  || 'image/png';
    const sceneMime = sceneBlob.getContentType() || 'image/jpeg';

    return {
      logo:  'data:' + logoMime  + ';base64,' + logoB64,
      scene: 'data:' + sceneMime + ';base64,' + sceneB64,
    };
  } catch(e) {
    return { logo: '', scene: '', error: e.message };
  }
}
