/**
 * 의견 받는 구글 시트 — 앱의 「의견 보내기」가 여기로 글을 보낸다 (구글 설문지 없이 시트에 한 줄씩)
 *
 * 만드는 법 (한 번만)
 *  1. 구글 시트 새로 만들기 (이름 예: 말씀통독 의견)
 *  2. 확장 프로그램 → Apps Script → 이 파일 내용을 통째로 붙여 넣고 저장
 *  3. 배포 → 새 배포 → 유형 '웹 앱' → 실행: 나 / 액세스 권한: 모든 사용자 → 배포 (처음엔 권한 허용 창이 뜬다)
 *  4. 나온 '웹 앱 URL'(https://script.google.com/macros/s/…/exec)을 data/church.json의 feedback.url에 넣는다
 *
 * 주의: 주소를 아는 누구나 글을 넣을 수 있다(로그인 없음). 교회 안에서만 쓰는 앱이라 이 정도로 둔다.
 *       장난 글이 많아지면 주소를 바꾸면 된다 (새 배포 → 새 주소).
 */
function doPost(e) {
  const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(['받은 때', '의견', '폰·디자인·앱 판', '처리']);
  // =, +, -, @로 시작하는 글이 수식으로 실행되지 않게 앞에 ' 를 붙인다
  const safe = (v, n) => { const t = String(v || '').slice(0, n); return /^[=+\-@]/.test(t) ? "'" + t : t; };
  if (!safe(d.text, 1000).trim()) return ContentService.createTextOutput('empty');
  sheet.appendRow([new Date(), safe(d.text, 1000), safe(d.info, 200), '']);
  return ContentService.createTextOutput('ok');
}
