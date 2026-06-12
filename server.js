const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8080);
const root = __dirname;
const dataFile = path.join(root, "data.json");
const participantsTableFile = path.join(root, "participants-table.txt");
const predictionsTableFile = path.join(root, "predictions-table.txt");
const rankingTableFile = path.join(root, "ranking-table.txt");
const actualScoresTableFile = path.join(root, "actual-scores-table.txt");
const matchSummaryTableFile = path.join(root, "match-summary-table.txt");
const marketPredictionTableFile = path.join(root, "market-prediction-table.txt");
const fifaSyncLogFile = path.join(root, "fifa-sync-log.txt");
const activityLogFile = path.join(root, "activity-log.txt");
const adminAccount = { name: "admin", phone: "08111076079", password: "Kemanggisanno10", role: "admin" };
const viewerAccount = { name: "penonton", phone: "1234567890", password: "nontonajaye", role: "viewer" };
const fixedParticipantCredentials = [
  { name: "Charles", password: "9Onzales!" },
  { name: "Gusmilan P", password: "gusmilan" },
  { name: "Gibran", password: "Geo1001ui" },
  { name: "adam julio", password: "Emara@2026" },
  { name: "McDowell", password: "Jasonjohn99" },
  { name: "Bben white", password: "Bonaparte15#" },
  { name: "Raihan Virgatama", password: "thedark81" },
  { name: "Hidup korupsi", password: "Lolipop123!@#" }
];
const sessions = new Map();
const maxLoginFailures = 3;
const loginLockMs = 30 * 1000;
const sessionIdleMs = 5 * 60 * 1000;
const mediaIndonesiaScheduleUrl = process.env.MEDIA_INDONESIA_SCHEDULE_URL || "https://mediaindonesia.com/piala-dunia-2026/895180/jadwal-lengkap-piala-dunia-2026-wib-104-pertandingan-fase-grup-hingga-final";
const liveScoreUrl = process.env.WORLDCUP26_GAMES_URL || "https://worldcup26.ir/get/games";
const marketPredictionUrl = process.env.MARKET_PREDICTION_URL || "https://www.aiscore.com/world-cup";
const aiScoreMarketSnapshot = [
  "12 / 06 - Mexico V South Africa Group A 1.44 4.33 7.50",
  "12 / 06 - South Korea V Czechia Group A 2.63 3.10 2.70",
  "13 / 06 - Canada V Bosnia and Herzegovina Group B 1.80 3.70 4.50",
  "13 / 06 - USA V Paraguay Group D 1.95 3.40 4.00",
  "14 / 06 - Qatar V Switzerland Group B 12.00 6.00 1.22",
  "14 / 06 - Brazil V Morocco Group C 1.61 3.90 5.25",
  "14 / 06 - Haiti V Scotland Group C 5.50 4.75 1.50",
  "14 / 06 - Australia V Turkiye Group D 4.75 3.60 1.75",
  "15 / 06 - Germany V Curacao Group E 1.03 19.00 41.00",
  "15 / 06 - Netherlands V Japan Group F 1.95 3.80 3.50"
].join(" ");
const syncIntervalMs = Number(process.env.FIFA_SYNC_INTERVAL_MS || 30 * 60 * 1000);
const liveScoreRealtimeIntervalMs = Number(process.env.LIVESCORE_REALTIME_INTERVAL_MS || 60 * 1000);
let syncStatus = { running: false, lastRun: null, lastOk: null, lastError: null, updatedMatches: 0, sources: { schedule: mediaIndonesiaScheduleUrl, scores: liveScoreUrl }, sourceResults: [] };
let liveScoreStatus = { running: false, lastRun: null, lastOk: null, lastError: null, updatedScores: 0, source: liveScoreUrl };
let marketPredictionStatus = { running: false, lastRun: null, lastOk: null, lastError: null, updated: 0, found: 0, source: marketPredictionUrl };
const predictionOpenAt = new Date("2026-06-11T09:00:00+07:00").getTime();
const registrationCloseAt = new Date("2026-06-11T23:00:00+07:00").getTime();
const weekDeadlines = {
  w1: new Date("2026-06-11T23:59:00+07:00").getTime(),
  w2: new Date("2026-06-17T22:00:00+07:00").getTime(),
  w3: new Date("2026-06-24T22:00:00+07:00").getTime(),
  ko: new Date("2026-06-28T16:00:00+07:00").getTime()
};
const weekOpenAt = {
  w1: predictionOpenAt,
  w2: new Date("2026-06-17T16:00:00+07:00").getTime(),
  w3: new Date("2026-06-24T16:00:00+07:00").getTime(),
  ko: new Date("2026-06-27T16:00:00+07:00").getTime()
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  const isHtml = contentType.startsWith("text/html");
  const isJson = contentType.startsWith("application/json");
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": status === 200 && !isHtml && !isJson ? "public, max-age=300" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  });
  res.end(body);
}

function resolveFile(urlPath) {
  const requested = decodeURIComponent(urlPath.split("?")[0]);
  const cleanPath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, cleanPath === "/" ? "index.html" : cleanPath);
  return filePath.startsWith(root) ? filePath : path.join(root, "index.html");
}

function readJsonBody(req, callback) {
  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    try {
      callback(null, body ? JSON.parse(body) : {});
    } catch (error) {
      callback(error);
    }
  });
}

function readState() {
  try {
    const raw = fs.readFileSync(dataFile, "utf8").replace(/^\uFEFF/, "");
    return mergeParticipantsTable(ensureState(JSON.parse(raw)));
  } catch {
    return mergeParticipantsTable(ensureState({}));
  }
}

function writeState(data) {
  const state = ensureState(data);
  backupDataFile();
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
  writeAllTextTables(state);
}

function backupDataFile() {
  try {
    if (!fs.existsSync(dataFile)) return;
    const backupDir = path.join(root, "data-backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(dataFile, path.join(backupDir, `data-${stamp}.json`));
    const backups = fs.readdirSync(backupDir)
      .filter(name => /^data-.*\.json$/.test(name))
      .sort();
    while (backups.length > 50) {
      fs.unlinkSync(path.join(backupDir, backups.shift()));
    }
  } catch {}
}

function recoverParticipantsFromActivityLog(state) {
  try {
    if (!fs.existsSync(activityLogFile)) return state;
    const byName = new Map((state.users || []).map(user => [String(user.name).toLowerCase(), user]));
    const fixedPasswords = new Map(fixedParticipantCredentials.map(item => [item.name.toLowerCase(), item.password]));
    fixedPasswords.set("odir", "P@ssw0rd.1");
    const ignored = new Set(["codex-lock-test", "charled", "wizars", "espelho", "nizar yoga", "muhammad nizar yoga pratama"]);
    const lines = fs.readFileSync(activityLogFile, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split("\t");
      const action = parts[4];
      if (action !== "register-success" && action !== "login-success") continue;
      try {
        const payload = JSON.parse(parts.slice(5).join("\t"));
        if ((payload.role || "participant") !== "participant") continue;
        const name = String(payload.name || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (ignored.has(key) || byName.has(key)) continue;
        const user = {
          name,
          phone: payload.phone || "",
          role: "participant",
          password: fixedPasswords.get(key) || "P@ssw0rd.1"
        };
        state.users.push(user);
        byName.set(key, user);
      } catch {}
    }
  } catch {}
  return state;
}

function ensureState(data) {
  const state = {
    users: Array.isArray(data.users) ? data.users : [],
    schedule: Array.isArray(data.schedule) ? data.schedule : [],
    pred: data.pred || {},
    predLocks: data.predLocks || {},
    actual: data.actual || {},
    summary: data.summary || {},
    marketPrediction: data.marketPrediction || {},
    notif: Array.isArray(data.notif) ? data.notif : [],
    telegram: data.telegram || {},
    messages: Array.isArray(data.messages) ? data.messages : [],
    online: data.online || {},
    loginSecurity: data.loginSecurity || {}
  };
  const now = Date.now();
  state.messages = state.messages.filter(message => !message.expiresAt || new Date(message.expiresAt).getTime() > now);
  state.online = Object.fromEntries(Object.entries(state.online || {}).filter(([, rec]) => now - new Date(rec.lastSeen || 0).getTime() <= 90_000));
  state.loginSecurity = cleanLoginSecurity(state.loginSecurity);
  const admin = state.users.find(user => String(user.name).toLowerCase() === "admin");
  if (admin) Object.assign(admin, adminAccount);
  else state.users.unshift({ ...adminAccount });
  const viewer = state.users.find(user => String(user.name).toLowerCase() === "penonton");
  if (viewer) Object.assign(viewer, viewerAccount);
  else state.users.push({ ...viewerAccount });
  for (const fixed of fixedParticipantCredentials) {
    const participant = state.users.find(user => String(user.name).toLowerCase() === fixed.name.toLowerCase());
    if (participant) participant.password = fixed.password;
  }
  recoverParticipantsFromActivityLog(state);
  autoLockExpiredPredictions(state);
  return state;
}

function publicState(state) {
  const now = Date.now();
  const { telegram, loginSecurity, ...safeState } = state;
  return {
    ...safeState,
    users: state.users.map(({ password, ...user }) => user),
    messages: (state.messages || []).filter(message => !message.expiresAt || new Date(message.expiresAt).getTime() > now),
    online: Object.fromEntries(Object.entries(state.online || {}).filter(([, rec]) => now - new Date(rec.lastSeen || 0).getTime() <= 90_000))
  };
}

function participantStats(state, name) {
  const predictions = state.pred?.[name] || {};
  let points = 0;
  let correct = 0;
  let outcome = 0;
  let wrong = 0;
  for (const [matchId, prediction] of Object.entries(predictions)) {
    const actual = state.actual?.[matchId];
    if (!actual?.final) continue;
    const score = predictionScore(prediction, actual);
    points += score.points;
    if (score.type === "exact") {
      correct++;
    } else if (score.type === "outcome") {
      outcome++;
    } else {
      wrong++;
    }
  }
  return { points, total: Object.keys(predictions).length, correct, outcome, wrong };
}

function scoreOutcome(home, away) {
  const h = Number(home);
  const a = Number(away);
  if (h > a) return "home";
  if (h < a) return "away";
  return "draw";
}

function predictionScore(prediction, actual) {
  if (!prediction || !actual?.final) return { points: 0, type: "waiting" };
  const exact = Number(prediction.home) === Number(actual.home) && Number(prediction.away) === Number(actual.away);
  if (exact) return { points: 3, type: "exact" };
  const predictedOutcome = scoreOutcome(prediction.home, prediction.away);
  const actualOutcome = scoreOutcome(actual.home, actual.away);
  if (predictedOutcome === actualOutcome) return { points: 1, type: "outcome" };
  return { points: 0, type: "wrong" };
}

function matchWeek(state, matchId) {
  const match = (state.schedule || []).find(item => String(item.id) === String(matchId));
  return match?.week || "";
}

function matchById(state, matchId) {
  return (state.schedule || []).find(item => String(item.id) === String(matchId));
}

function matchKickoffMs(match) {
  if (!match?.date) return 0;
  const time = String(match.time || "00:00").padStart(5, "0").slice(0, 5);
  const timezone = match.timezone || "WIB";
  const offset = timezone === "WIB" ? "+07:00" : "+07:00";
  const value = new Date(`${match.date}T${time}:00${offset}`).getTime();
  return Number.isFinite(value) ? value : 0;
}

function matchDeadlinePassed(state, matchId) {
  const kickoff = matchKickoffMs(matchById(state, matchId));
  return kickoff ? Date.now() > kickoff - 60 * 60 * 1000 : false;
}

function predictionWeeks(state, predictions) {
  return [...new Set(Object.keys(predictions || {}).map(matchId => matchWeek(state, matchId)).filter(Boolean))];
}

function samePrediction(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Number(a.home) === Number(b.home) && Number(a.away) === Number(b.away);
}

function hasLockedPredictionChange(state, userName, incomingPredictions) {
  const currentPredictions = state.pred?.[userName] || {};
  for (const [matchId, prediction] of Object.entries(incomingPredictions || {})) {
    if (!matchDeadlinePassed(state, matchId)) continue;
    if (!samePrediction(currentPredictions[matchId], prediction)) return matchId;
  }
  for (const matchId of Object.keys(currentPredictions)) {
    if (matchDeadlinePassed(state, matchId) && !(matchId in (incomingPredictions || {}))) return matchId;
  }
  return "";
}

function changedPredictionWeeks(state, userName, incomingPredictions) {
  const currentPredictions = state.pred?.[userName] || {};
  const weeks = new Set();
  for (const [matchId, prediction] of Object.entries(incomingPredictions || {})) {
    if (!samePrediction(currentPredictions[matchId], prediction)) {
      const week = matchWeek(state, matchId);
      if (week) weeks.add(week);
    }
  }
  for (const matchId of Object.keys(currentPredictions)) {
    if (!(matchId in (incomingPredictions || {}))) {
      const week = matchWeek(state, matchId);
      if (week) weeks.add(week);
    }
  }
  return [...weeks];
}

function weekOpen(week) {
  return weekOpenAt[week] ? Date.now() >= weekOpenAt[week] : true;
}

function weekDeadlinePassed(week) {
  return weekDeadlines[week] ? Date.now() > weekDeadlines[week] : false;
}

function autoLockExpiredPredictions(state) {
  for (const [userName, predictions] of Object.entries(state.pred || {})) {
    const expiredPredictions = {};
    for (const [matchId, prediction] of Object.entries(predictions || {})) {
      if (matchDeadlinePassed(state, matchId)) expiredPredictions[matchId] = prediction;
    }
    lockPredictionMatches(state, userName, expiredPredictions);
  }
}

function lockPredictionMatches(state, userName, predictions) {
  const matchIds = Object.keys(predictions || {});
  if (!matchIds.length) return;
  state.predLocks = state.predLocks || {};
  state.predLocks[userName] = state.predLocks[userName] || {};
  const now = new Date().toISOString();
  for (const matchId of matchIds) {
    if (!state.predLocks[userName][matchId]) state.predLocks[userName][matchId] = now;
  }
}

function writeParticipantsTable(state) {
  const lines = [
    "name\tphone\trole\tstatus\tpoints\tpredictions\texact\toutcome\twrong"
  ];
  for (const user of state.users || []) {
    if (user.role === "viewer") continue;
    const stats = participantStats(state, user.name);
    const status = state.online?.[user.name] ? "online" : "offline";
    lines.push([
      user.name || "",
      user.phone || "",
      user.role || "participant",
      status,
      stats.points,
      stats.total,
      stats.correct,
      stats.outcome,
      stats.wrong
    ].map(value => String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"));
  }
  fs.writeFileSync(participantsTableFile, `${lines.join("\n")}\n`, "utf8");
}

function writePredictionsTable(state) {
  const lines = ["participant\tmatch_id\tweek\tmatch\tprediction_home\tprediction_away\tactual_home\tactual_away\tfinal\tresult\tpoints"];
  for (const [name, predictions] of Object.entries(state.pred || {})) {
    for (const [matchId, prediction] of Object.entries(predictions || {})) {
      const actual = state.actual?.[matchId] || {};
      const score = predictionScore(prediction, actual);
      lines.push([
        name,
        matchId,
        "",
        "",
        prediction.home ?? "",
        prediction.away ?? "",
        actual.home ?? "",
        actual.away ?? "",
        actual.final ? "yes" : "no",
        score.type,
        score.points
      ].map(value => String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"));
    }
  }
  fs.writeFileSync(predictionsTableFile, `${lines.join("\n")}\n`, "utf8");
}

function writeRankingTable(state) {
  const rows = (state.users || [])
    .filter(user => user.role !== "admin" && user.role !== "viewer")
    .map(user => ({ ...user, ...participantStats(state, user.name) }))
    .sort((a, b) => b.points - a.points || b.correct - a.correct || String(a.name).localeCompare(String(b.name)));
  const lines = ["rank\tparticipant\tphone\tstatus\tpoints\tpredictions\texact\toutcome\twrong"];
  rows.forEach((row, index) => {
    lines.push([
      index + 1,
      row.name || "",
      row.phone || "",
      state.online?.[row.name] ? "online" : "offline",
      row.points,
      row.total,
      row.correct,
      row.outcome,
      row.wrong
    ].map(value => String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"));
  });
  fs.writeFileSync(rankingTableFile, `${lines.join("\n")}\n`, "utf8");
}

function writeActualScoresTable(state) {
  const lines = ["match_id\tactual_home\tactual_away\tfinal\tupdated"];
  for (const [matchId, actual] of Object.entries(state.actual || {})) {
    lines.push([
      matchId,
      actual.home ?? "",
      actual.away ?? "",
      actual.final ? "yes" : "no",
      actual.updatedAt || ""
    ].map(value => String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"));
  }
  fs.writeFileSync(actualScoresTableFile, `${lines.join("\n")}\n`, "utf8");
}

function writeMatchSummaryTable(state) {
  const lines = ["match_id\tsource\tupdated\tgoals\tevents\tstats"];
  for (const [matchId, summary] of Object.entries(state.summary || {})) {
    const goals = (summary.goals || [])
      .map(goal => [goal.minute, goal.player, goal.team, goal.score].filter(Boolean).join(" "))
      .join(" | ");
    const events = (summary.events || [])
      .map(event => [event.minute, event.type, event.player, event.team].filter(Boolean).join(" "))
      .join(" | ");
    const stats = Object.entries(summary.stats || {})
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join("-") : value}`)
      .join(" | ");
    lines.push([
      matchId,
      summary.source || "",
      summary.updatedAt || "",
      goals,
      events,
      stats
    ].map(value => String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"));
  }
  fs.writeFileSync(matchSummaryTableFile, `${lines.join("\n")}\n`, "utf8");
}

function writeMarketPredictionTable(state) {
  const lines = ["match_id\tmarket_score\tfavorite\tconfidence\tsource\tupdated\tnote"];
  for (const [matchId, market] of Object.entries(state.marketPrediction || {})) {
    lines.push([
      matchId,
      market.score || "",
      market.favorite || "",
      market.confidence || "",
      market.source || "",
      market.updatedAt || "",
      market.note || ""
    ].map(value => String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"));
  }
  fs.writeFileSync(marketPredictionTableFile, `${lines.join("\n")}\n`, "utf8");
}

function writeAllTextTables(state) {
  writeParticipantsTable(state);
  writePredictionsTable(state);
  writeRankingTable(state);
  writeActualScoresTable(state);
  writeMatchSummaryTable(state);
  writeMarketPredictionTable(state);
}

function syncLog(message) {
  const line = `${new Date().toISOString()}\t${message}\n`;
  try { fs.appendFileSync(fifaSyncLogFile, line, "utf8"); } catch {}
}

function requestIp(req) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function loginAttemptKey(name, req) {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized ? `user:${normalized}` : `ip:${requestIp(req) || "unknown"}`;
}

function cleanLoginSecurity(records = {}) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(records || {}).map(([key, rec]) => {
    const lastFailedAt = new Date(rec.lastFailedAt || 0).getTime();
    const maxLockedUntil = lastFailedAt ? lastFailedAt + loginLockMs : 0;
    const lockedUntil = new Date(rec.lockedUntil || 0).getTime();
    if (lockedUntil && maxLockedUntil && lockedUntil > maxLockedUntil) {
      rec.lockedUntil = new Date(maxLockedUntil).toISOString();
    }
    return [key, rec];
  }).filter(([, rec]) => {
    const lockedUntil = new Date(rec.lockedUntil || 0).getTime();
    const lastFailedAt = new Date(rec.lastFailedAt || 0).getTime();
    return lockedUntil > now || (Number(rec.failed || 0) > 0 && now - lastFailedAt < loginLockMs);
  }));
}

function loginLockMessage(lockedUntil) {
  const remainingMs = Math.max(0, new Date(lockedUntil || 0).getTime() - Date.now());
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return `Akun dikunci sementara karena 3 kali salah login. Silakan coba login kembali setelah ${seconds} detik.`;
}

function loginFailureMessage(failed, lockedUntil) {
  if (lockedUntil) return `Mampus!! ${loginLockMessage(lockedUntil)}`;
  if (Number(failed || 0) === 1) return "Salah GOBLOG , inget lagi yg bener!";
  if (Number(failed || 0) === 2) return "Uda PIKUN lu??! coba lagi tolol";
  return "Login gagal.";
}

function currentLoginLock(state, key) {
  state.loginSecurity = cleanLoginSecurity(state.loginSecurity || {});
  const record = state.loginSecurity[key];
  if (!record?.lockedUntil) return null;
  return new Date(record.lockedUntil).getTime() > Date.now() ? record : null;
}

function recordFailedLogin(state, key) {
  state.loginSecurity = cleanLoginSecurity(state.loginSecurity || {});
  const now = Date.now();
  const record = state.loginSecurity[key] || { failed: 0 };
  record.failed = Number(record.failed || 0) + 1;
  record.lastFailedAt = new Date(now).toISOString();
  if (record.failed >= maxLoginFailures) {
    record.failed = maxLoginFailures;
    record.lockedUntil = new Date(now + loginLockMs).toISOString();
  }
  state.loginSecurity[key] = record;
  return record;
}

function resetLoginFailures(state, key) {
  if (!state.loginSecurity) return;
  delete state.loginSecurity[key];
}

function activityLog(req, event, details = {}) {
  const safeDetails = { ...details };
  delete safeDetails.password;
  delete safeDetails.token;
  const userAgent = String(req.headers["user-agent"] || "").replace(/\s+/g, " ").slice(0, 180);
  const line = [
    new Date().toISOString(),
    requestIp(req) || "-",
    req.method || "-",
    (req.url || "").split("?")[0],
    event,
    JSON.stringify({ ...safeDetails, userAgent })
  ].join("\t");
  try { fs.appendFileSync(activityLogFile, `${line}\n`, "utf8"); } catch {}
}

function getAny(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && obj[key] !== "") return obj[key];
  }
  return "";
}

function teamName(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return getAny(value, ["name", "Name", "shortName", "ShortName", "displayName", "DisplayName", "countryName", "CountryName", "teamName", "TeamName"]);
}

function scoreValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function valueText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value !== "object") return "";
  return getAny(value, ["name", "Name", "displayName", "DisplayName", "shortName", "ShortName", "text", "Text", "label", "Label", "value", "Value"]);
}

function minuteText(value) {
  const raw = valueText(value);
  if (!raw) return "";
  const match = raw.match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  return match ? `${match[1]}${match[2] ? `+${match[2]}` : ""}'` : raw;
}

function eventTypeText(value) {
  const text = valueText(value).toLowerCase();
  if (!text) return "";
  if (text.includes("goal")) return "Goal";
  if (text.includes("yellow")) return "Kartu Kuning";
  if (text.includes("red")) return "Kartu Merah";
  if (text.includes("substitution")) return "Pergantian";
  if (text.includes("penalty")) return "Penalti";
  if (text.includes("assist")) return "Assist";
  return valueText(value);
}

function normalizeSummaryEvent(event) {
  if (!event || typeof event !== "object") return null;
  const player = valueText(getAny(event, ["player", "Player", "playerName", "PlayerName", "scorer", "Scorer", "athlete", "Athlete", "name", "Name"]));
  const assist = valueText(getAny(event, ["assist", "Assist", "assistPlayer", "AssistPlayer", "assistedBy", "AssistedBy"]));
  const team = teamName(getAny(event, ["team", "Team", "competitor", "Competitor"])) || valueText(getAny(event, ["teamName", "TeamName"]));
  const minute = minuteText(getAny(event, ["minute", "Minute", "time", "Time", "matchClock", "MatchClock"]));
  const type = eventTypeText(getAny(event, ["type", "Type", "eventType", "EventType", "incidentType", "IncidentType", "category", "Category"])) || (player ? "Event" : "");
  const score = valueText(getAny(event, ["score", "Score", "result", "Result"]));
  if (!player && !team && !minute && !type && !score) return null;
  return { minute, type, player, assist, team, score };
}

function normalizeStats(stats) {
  const out = {};
  const add = (label, value) => {
    const key = valueText(label).replace(/\s+/g, " ").trim();
    if (!key) return;
    if (Array.isArray(value)) out[key] = value.map(valueText).filter(Boolean);
    else out[key] = valueText(value);
  };
  if (Array.isArray(stats)) {
    stats.forEach(item => {
      if (Array.isArray(item) && item.length >= 2) add(item[0], item.slice(1));
      else if (item && typeof item === "object") {
        add(getAny(item, ["name", "Name", "label", "Label", "type", "Type", "category", "Category"]),
          [getAny(item, ["home", "Home", "homeValue", "HomeValue", "valueHome", "ValueHome"]), getAny(item, ["away", "Away", "awayValue", "AwayValue", "valueAway", "ValueAway"])]
            .map(valueText).filter(Boolean));
      }
    });
  } else if (stats && typeof stats === "object") {
    Object.entries(stats).forEach(([key, value]) => {
      if (typeof value === "object" && !Array.isArray(value)) add(key, [getAny(value, ["home", "Home"]), getAny(value, ["away", "Away"])].map(valueText).filter(Boolean));
      else add(key, value);
    });
  }
  return out;
}

function normalizeSummaryCandidate(obj) {
  if (!obj || typeof obj !== "object") return null;
  const rawEvents = getAny(obj, ["incidents", "Incidents", "events", "Events", "matchEvents", "MatchEvents", "goals", "Goals", "timeline", "Timeline"]);
  const rawStats = getAny(obj, ["statistics", "Statistics", "stats", "Stats", "matchStats", "MatchStats"]);
  const events = Array.isArray(rawEvents) ? rawEvents.map(normalizeSummaryEvent).filter(Boolean) : [];
  const goals = events.filter(event => String(event.type || "").toLowerCase().includes("goal"));
  const stats = normalizeStats(rawStats);
  if (!events.length && !Object.keys(stats).length) return null;
  return {
    source: "livescore",
    updatedAt: new Date().toISOString(),
    goals,
    events,
    stats
  };
}

function cleanScorerText(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text || text.toLowerCase() === "null") return [];
  return text
    .replace(/[{}]/g, "")
    .replace(/[“”]/g, '"')
    .split(/"\s*,\s*"|,\s*/)
    .map(item => item.replace(/^"+|"+$/g, "").trim())
    .filter(Boolean);
}

function parseWorldCup26Scorers(value, team) {
  return cleanScorerText(value).map(item => {
    const minute = minuteText(item);
    const player = item.replace(/\s+\d{1,3}(?:\+\d{1,2})?'?$/g, "").trim();
    return {
      minute,
      type: "Goal",
      player: player || item,
      assist: "",
      team,
      score: ""
    };
  });
}

function parseWorldCup26DateToWib(value) {
  const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!match) return { date: "", time: "" };
  const [, month, day, year, hour, minute] = match;
  const localNorthAmerica = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const wib = new Date(localNorthAmerica + 13 * 60 * 60 * 1000);
  return {
    date: `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, "0")}-${String(wib.getUTCDate()).padStart(2, "0")}`,
    time: `${String(wib.getUTCHours()).padStart(2, "0")}:${String(wib.getUTCMinutes()).padStart(2, "0")}`
  };
}

function parseWorldCup26Games(text) {
  const parsed = typeof text === "string" ? JSON.parse(text) : text;
  const games = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.games) ? parsed.games : []);
  return games.map(game => {
    const matchNumber = Number(game.id || game.matchNumber || game.match_number || 0);
    const id = matchNumber ? String(matchNumber).padStart(3, "0") : String(game._id || game.id || "");
    const home = game.home_team_name_en || game.home_team_label || "";
    const away = game.away_team_name_en || game.away_team_label || "";
    const { date, time } = parseWorldCup26DateToWib(game.local_date);
    const homeScore = scoreValue(game.home_score);
    const awayScore = scoreValue(game.away_score);
    const status = String(game.time_elapsed || game.status || "").toLowerCase();
    const final = String(game.finished).toUpperCase() === "TRUE" || status === "finished" || status === "completed";
    const live = String(game.finished).toUpperCase() !== "TRUE" && status && status !== "notstarted";
    const goals = [
      ...parseWorldCup26Scorers(game.home_scorers, home),
      ...parseWorldCup26Scorers(game.away_scorers, away)
    ];
    const events = goals.length ? goals : [];
    return {
      id,
      matchNumber: matchNumber || id,
      week: weekForDate(date),
      group: game.group ? `Grup ${game.group}` : (game.type || "FIFA"),
      phase: game.type || game.group || "FIFA",
      date,
      time,
      timezone: "WIB",
      home,
      away,
      venue: game.stadium_id ? `Stadium ${game.stadium_id}` : "",
      syncedAt: new Date().toISOString(),
      source: "worldcup26.ir",
      actual: homeScore !== "" && awayScore !== "" && (final || live || homeScore !== 0 || awayScore !== 0)
        ? { home: homeScore, away: awayScore, final, live, status: status || (final ? "finished" : "notstarted") }
        : null,
      summary: {
        source: "worldcup26.ir",
        updatedAt: new Date().toISOString(),
        goals,
        events,
        stats: {
          status: status || (final ? "finished" : "notstarted"),
          matchday: valueText(game.matchday),
          type: valueText(game.type),
          localDate: valueText(game.local_date),
          persianDate: valueText(game.persian_date),
          homeTeamId: valueText(game.home_team_id),
          awayTeamId: valueText(game.away_team_id),
          stadiumId: valueText(game.stadium_id)
        }
      }
    };
  }).filter(item => item.id && (item.home || item.away));
}

function scoreTextFromMarket(value) {
  const text = valueText(value);
  const match = text.match(/(\d{1,2})\s*[-:]\s*(\d{1,2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function normalizeMarketCandidate(obj) {
  if (!obj || typeof obj !== "object") return null;
  const homeObj = getAny(obj, ["home", "homeTeam", "HomeTeam", "teamA", "TeamA", "homeCompetitor", "HomeCompetitor"]);
  const awayObj = getAny(obj, ["away", "awayTeam", "AwayTeam", "teamB", "TeamB", "awayCompetitor", "AwayCompetitor"]);
  const home = teamName(homeObj) || getAny(obj, ["homeTeamName", "HomeTeamName", "homeName", "HomeName"]);
  const away = teamName(awayObj) || getAny(obj, ["awayTeamName", "AwayTeamName", "awayName", "AwayName"]);
  const score = scoreTextFromMarket(getAny(obj, ["marketScore", "MarketScore", "predictedScore", "PredictedScore", "correctScore", "CorrectScore", "score", "Score", "prediction", "Prediction"]));
  if (!home || !away || !score) return null;
  return {
    home,
    away,
    score,
    favorite: valueText(getAny(obj, ["favorite", "Favorite", "fav", "Fav"])) || "",
    confidence: valueText(getAny(obj, ["confidence", "Confidence", "probability", "Probability", "percent", "Percent"])) || "",
    source: "market",
    updatedAt: new Date().toISOString(),
    note: valueText(getAny(obj, ["note", "Note", "market", "Market"])) || ""
  };
}

function walkMarketJson(value, out = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  const candidate = normalizeMarketCandidate(value);
  if (candidate) out.push(candidate);
  if (Array.isArray(value)) value.forEach(item => walkMarketJson(item, out, seen));
  else Object.values(value).forEach(item => walkMarketJson(item, out, seen));
  return out;
}

function parseMarketPredictionText(html) {
  const text = htmlToPlainText(html).replace(/\s+/g, " ");
  const out = [];
  const teams = [
    ...new Set((text.match(/[A-Z][A-Za-z' .&-]{2,40}\s+vs\s+[A-Z][A-Za-z' .&-]{2,40}\s+\d{1,2}\s*[-:]\s*\d{1,2}/g) || []))
  ];
  for (const item of teams) {
    const match = item.match(/^(.+?)\s+vs\s+(.+?)\s+(\d{1,2})\s*[-:]\s*(\d{1,2})$/i);
    if (!match) continue;
    out.push({
      home: match[1].trim(),
      away: match[2].trim(),
      score: `${match[3]}-${match[4]}`,
      favorite: "",
      confidence: "",
      source: "market",
      updatedAt: new Date().toISOString(),
      note: "parsed-text"
    });
  }
  return out;
}

function impliedProbability(odd) {
  const n = Number(String(odd || "").replace(",", "."));
  return Number.isFinite(n) && n > 1 ? 1 / n : 0;
}

function scoreFromOdds(homeOdd, drawOdd, awayOdd) {
  const home = impliedProbability(homeOdd);
  const draw = impliedProbability(drawOdd);
  const away = impliedProbability(awayOdd);
  if (!home && !draw && !away) return "";
  const total = home + draw + away || 1;
  const hp = home / total;
  const dp = draw / total;
  const ap = away / total;
  if (dp >= hp && dp >= ap) return "1-1";
  if (hp >= ap) {
    if (hp >= 0.68) return "2-0";
    if (hp >= 0.56) return "2-1";
    return "1-0";
  }
  if (ap >= 0.68) return "0-2";
  if (ap >= 0.56) return "1-2";
  return "0-1";
}

function confidenceFromOdds(homeOdd, drawOdd, awayOdd) {
  const probs = [impliedProbability(homeOdd), impliedProbability(drawOdd), impliedProbability(awayOdd)];
  const total = probs.reduce((sum, value) => sum + value, 0) || 1;
  const best = Math.max(...probs) / total;
  return `${Math.round(best * 100)}%`;
}

function parseAiScoreMarketPredictions(html) {
  const text = htmlToPlainText(html).replace(/\s+/g, " ");
  const out = [];
  const rowRe = /(?:\d{1,2}\s*\/\s*\d{1,2}\s*-\s*)?([A-Z][A-Za-z' .&-]{2,45}?)\s+V\s+([A-Z][A-Za-z' .&-]{2,45}?)(?:\s+Group\s+[A-L])?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g;
  let match;
  while ((match = rowRe.exec(text))) {
    const [, home, away, homeOdd, drawOdd, awayOdd] = match;
    const score = scoreFromOdds(homeOdd, drawOdd, awayOdd);
    if (!score) continue;
    const favorite = Number(homeOdd) <= Number(awayOdd) ? home.trim() : away.trim();
    out.push({
      home: home.trim(),
      away: away.trim(),
      score,
      favorite,
      confidence: confidenceFromOdds(homeOdd, drawOdd, awayOdd),
      source: "aiscore.com",
      updatedAt: new Date().toISOString(),
      note: `1X2 odds ${homeOdd}/${drawOdd}/${awayOdd}; estimasi skor diturunkan dari odds pasar`
    });
  }
  return out;
}

function weekForDate(date) {
  if (!date) return "fifa-sync";
  if (date >= "2026-06-11" && date <= "2026-06-17") return "w1";
  if (date >= "2026-06-18" && date <= "2026-06-24") return "w2";
  if (date >= "2026-06-25" && date <= "2026-06-27") return "w3";
  if (date >= "2026-06-28" && date <= "2026-07-19") return "ko";
  return "fifa-sync";
}

function normalizeFifaCandidate(obj) {
  if (!obj || typeof obj !== "object") return null;
  const homeObj = getAny(obj, ["home", "homeTeam", "HomeTeam", "teamA", "TeamA", "homeCompetitor", "HomeCompetitor"]);
  const awayObj = getAny(obj, ["away", "awayTeam", "AwayTeam", "teamB", "TeamB", "awayCompetitor", "AwayCompetitor"]);
  const home = teamName(homeObj) || getAny(obj, ["homeTeamName", "HomeTeamName", "homeName", "HomeName"]);
  const away = teamName(awayObj) || getAny(obj, ["awayTeamName", "AwayTeamName", "awayName", "AwayName"]);
  const dateRaw = getAny(obj, ["date", "Date", "kickoff", "KickOff", "kickoffTime", "KickOffTime", "matchDate", "MatchDate", "startTime", "StartTime"]);
  if (!home || !away || !dateRaw) return null;
  const id = String(getAny(obj, ["id", "Id", "matchId", "MatchId", "matchNumber", "MatchNumber", "number", "Number"]) || `${dateRaw}-${home}-${away}`).replace(/\s+/g, "-");
  const homeScore = scoreValue(getAny(obj, ["homeScore", "HomeScore", "scoreHome", "ScoreHome", "homeTeamScore", "HomeTeamScore"]));
  const awayScore = scoreValue(getAny(obj, ["awayScore", "AwayScore", "scoreAway", "ScoreAway", "awayTeamScore", "AwayTeamScore"]));
  const status = String(getAny(obj, ["status", "Status", "matchStatus", "MatchStatus", "period", "Period"])).toLowerCase();
  const final = status.includes("final") || status.includes("full") || status === "finished" || status === "completed";
  const date = String(dateRaw).slice(0, 10);
  const time = String(dateRaw).includes("T") ? String(dateRaw).slice(11, 16) : "";
  return {
    id,
    week: weekForDate(date),
    group: getAny(obj, ["group", "Group", "stage", "Stage", "phase", "Phase"]) || "FIFA",
    date,
    time,
    home,
    away,
    venue: teamName(getAny(obj, ["venue", "Venue", "stadium", "Stadium"])) || getAny(obj, ["venueName", "VenueName", "stadiumName", "StadiumName"]) || "",
    syncedAt: new Date().toISOString(),
    actual: homeScore !== "" && awayScore !== "" ? { home: homeScore, away: awayScore, final } : null,
    summary: normalizeSummaryCandidate(obj)
  };
}

function walkFifaJson(value, out = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  const candidate = normalizeFifaCandidate(value);
  if (candidate) out.push(candidate);
  if (Array.isArray(value)) value.forEach(item => walkFifaJson(item, out, seen));
  else Object.values(value).forEach(item => walkFifaJson(item, out, seen));
  return out;
}

function extractJsonObjects(html) {
  const objects = [];
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRe.exec(html))) {
    const text = match[1].trim();
    if (!text || (!text.includes("Match") && !text.includes("match") && !text.includes("home"))) continue;
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try { objects.push(JSON.parse(text.slice(jsonStart, jsonEnd + 1))); } catch {}
    }
  }
  return objects;
}

function decodeHtml(text) {
  return String(text)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "-");
}

function htmlToPlainText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h2|h3|h4)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n");
}

const monthId = {
  januari: "01",
  jan: "01",
  februari: "02",
  feb: "02",
  maret: "03",
  mar: "03",
  april: "04",
  apr: "04",
  mei: "05",
  may: "05",
  juni: "06",
  jun: "06",
  juli: "07",
  jul: "07",
  agustus: "08",
  aug: "08",
  september: "09",
  sep: "09",
  oktober: "10",
  oct: "10",
  november: "11",
  nov: "11",
  desember: "12"
  ,dec: "12"
};

const knownVenues = [
  "New York New Jersey Stadium",
  "San Francisco Bay Area Stadium",
  "Mexico City Stadium",
  "Kansas City Stadium",
  "Philadelphia Stadium",
  "Los Angeles Stadium",
  "Dallas Stadium",
  "Boston Stadium",
  "Houston Stadium",
  "Atlanta Stadium",
  "Seattle Stadium",
  "Miami Stadium",
  "Toronto Stadium",
  "Vancouver Stadium",
  "Guadalajara Stadium",
  "Monterrey Stadium",
  "Estadio Azteca",
  "Estadio Guadalajara",
  "Estadio Monterrey",
  "BMO Field",
  "BC Place"
].sort((a, b) => b.length - a.length);

function splitFixtureAndVenue(rest) {
  const normalized = rest.replace(/\s+/g, " ").trim();
  for (const venue of knownVenues) {
    const index = normalized.toLowerCase().lastIndexOf(venue.toLowerCase());
    if (index > 0) {
      return {
        fixture: normalized.slice(0, index).trim(),
        venue: normalized.slice(index).trim()
      };
    }
  }
  return { fixture: normalized, venue: "" };
}

function parseMediaIndonesiaSchedule(html) {
  const tableMatches = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html))) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td;
    while ((td = tdRe.exec(tr[1]))) {
      cells.push(htmlToPlainText(td[1]).replace(/\s+/g, " ").trim());
    }
    if (cells.length < 6 || !/^\d+$/.test(cells[0])) continue;
    const [number, dateText, timeText, phase, fixture, venue] = cells;
    const dateMatch = dateText.match(/(\d{1,2})\s+([A-Za-z]+)\s+2026/i);
    if (!dateMatch) continue;
    const month = monthId[dateMatch[2].toLowerCase()];
    const parts = fixture.split(/\s+vs\s+/i);
    if (!month || parts.length !== 2) continue;
    const date = `2026-${month}-${String(dateMatch[1]).padStart(2, "0")}`;
    tableMatches.push({
      id: String(number).padStart(3, "0"),
      matchNumber: Number(number),
      week: weekForDate(date),
      group: phase,
      phase,
      date,
      time: timeText.replace(".", ":"),
      timezone: "WIB",
      home: parts[0].trim(),
      away: parts[1].trim(),
      venue,
      syncedAt: new Date().toISOString(),
      source: "mediaindonesia"
    });
  }
  if (tableMatches.length) return tableMatches;

  const text = htmlToPlainText(html);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const out = [];
  const phasePattern = "(Grup\\s+[A-L]|Babak\\s+32\\s+Besar|16\\s+Besar|Perempat\\s+final|Semifinal|Perebutan\\s+tempat\\s+ketiga|Final)";
  const rowRe = new RegExp(`^(\\d{1,3})\\s+[A-Za-z]+,\\s*(\\d{1,2})\\s+([A-Za-z]+)\\s+2026\\s+(\\d{1,2})[.:](\\d{2})\\s+${phasePattern}\\s+(.+)$`, "i");
  for (const line of lines) {
    const match = line.match(rowRe);
    if (!match) continue;
    const [, number, day, monthName, hour, minute, phase, rest] = match;
    const month = monthId[monthName.toLowerCase()];
    if (!month) continue;
    const date = `2026-${month}-${String(day).padStart(2, "0")}`;
    const { fixture, venue } = splitFixtureAndVenue(rest);
    const parts = fixture.split(/\s+vs\s+/i);
    if (parts.length !== 2) continue;
    const home = parts[0].trim();
    const away = parts[1].trim();
    if (!home || !away) continue;
    out.push({
      id: String(number).padStart(3, "0"),
      week: weekForDate(date),
      group: phase.replace(/\s+/g, " ").trim(),
      date,
      time: `${String(hour).padStart(2, "0")}:${minute}`,
      home,
      away,
      venue,
      syncedAt: new Date().toISOString(),
      source: "mediaindonesia"
    });
  }
  return out;
}

function mergeSyncedMatches(state, synced) {
  const schedule = Array.isArray(state.schedule) ? [...state.schedule] : [];
  const byKey = new Map(schedule.map(match => [match.id, match]));
  let updated = 0;
  for (const item of synced) {
    const match = { ...item };
    delete match.actual;
    const existing = byKey.get(match.id);
    if (existing) Object.assign(existing, match);
    else schedule.push(match);
    if (item.actual) {
      state.actual[item.id] = { ...state.actual[item.id], ...item.actual, updatedAt: new Date().toISOString(), source: "fifa-sync" };
    }
    if (item.summary) {
      state.summary[item.id] = { ...state.summary[item.id], ...item.summary, updatedAt: new Date().toISOString(), source: item.summary.source || "livescore" };
    }
    updated++;
  }
  state.schedule = schedule;
  state.schedule.sort((a, b) => Number(a.matchNumber || a.id) - Number(b.matchNumber || b.id));
  return updated;
}

function normTeam(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const aliases = {
    "south korea": "korea republic",
    "korea republic": "korea republic",
    "czech republic": "czechia",
    "czechia": "czechia",
    "united states": "usa",
    "usa": "usa",
    "bosnia and herzegovina": "bosnia herzegovina",
    "bosnia herzegovina": "bosnia herzegovina",
    "turkey": "turkiye",
    "tuerkiye": "turkiye",
    "cote d ivoire": "cote d ivoire",
    "ivory coast": "cote d ivoire"
  };
  return aliases[normalized] || normalized;
}

function findScheduleMatch(state, item) {
  const wantedHome = normTeam(item.home);
  const wantedAway = normTeam(item.away);
  const date = item.date || "";
  return (state.schedule || []).find(match => {
    const sameTeams = normTeam(match.home) === wantedHome && normTeam(match.away) === wantedAway;
    const reverseTeams = normTeam(match.home) === wantedAway && normTeam(match.away) === wantedHome;
    const sameDate = !date || !match.date || match.date === date;
    return sameDate && (sameTeams || reverseTeams);
  });
}

function mergeLiveScores(state, synced) {
  let updated = 0;
  for (const item of synced) {
    const match = findScheduleMatch(state, item) || item;
    const id = match.id || item.id;
    if (!id) continue;
    if (item.actual) {
      const next = { ...state.actual[id], ...item.actual, updatedAt: new Date().toISOString(), source: item.source || "worldcup26.ir" };
      const prev = state.actual[id] || {};
      if (prev.home !== next.home || prev.away !== next.away || prev.final !== next.final || prev.source !== next.source) {
        state.actual[id] = next;
        updated++;
      }
    }
    if (item.summary) {
      const nextSummary = { ...state.summary[id], ...item.summary, source: item.summary.source || item.source || "worldcup26.ir", updatedAt: new Date().toISOString() };
      const prevSummary = JSON.stringify(state.summary[id] || {});
      const nextText = JSON.stringify(nextSummary);
      if (prevSummary !== nextText) {
        state.summary[id] = nextSummary;
        updated++;
      }
    }
  }
  return updated;
}

function mergeMarketPredictions(state, synced) {
  let updated = 0;
  state.marketPrediction = state.marketPrediction || {};
  for (const item of synced) {
    const match = findScheduleMatch(state, item) || item;
    const id = match.id || item.id;
    if (!id || !item.score) continue;
    const next = {
      score: item.score,
      favorite: item.favorite || "",
      confidence: item.confidence || "",
      source: item.source || "market",
      updatedAt: new Date().toISOString(),
      note: item.note || ""
    };
    const prev = JSON.stringify(state.marketPrediction[id] || {});
    if (prev !== JSON.stringify(next)) {
      state.marketPrediction[id] = next;
      updated++;
    }
  }
  return updated;
}

async function fetchMarketPredictions() {
  if (!marketPredictionUrl) return [];
  let html = "";
  try {
    const response = await fetch(marketPredictionUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Referer": "https://www.aiscore.com/",
        "Origin": "https://www.aiscore.com"
      }
    });
    if (!response.ok) throw new Error(`market-prediction returned ${response.status}`);
    html = await response.text();
  } catch (error) {
    if (String(marketPredictionUrl).includes("aiscore.com")) {
      syncLog(`market-aiscore-fallback\t${error.message || String(error)}`);
      html = aiScoreMarketSnapshot;
    } else {
      throw error;
    }
  }
  const objects = extractJsonObjects(html);
  return [...objects.flatMap(obj => walkMarketJson(obj)), ...parseAiScoreMarketPredictions(html), ...parseMarketPredictionText(html)]
    .filter((item, index, arr) => arr.findIndex(other => normTeam(other.home) === normTeam(item.home) && normTeam(other.away) === normTeam(item.away) && other.score === item.score) === index);
}

async function runMarketPredictionSync() {
  if (marketPredictionStatus.running) return marketPredictionStatus;
  marketPredictionStatus = { ...marketPredictionStatus, running: true, lastRun: new Date().toISOString(), lastError: null, updated: 0, found: 0 };
  try {
    const synced = await fetchMarketPredictions();
    const state = readState();
    const updated = mergeMarketPredictions(state, synced);
    writeState(state);
    marketPredictionStatus = { ...marketPredictionStatus, running: false, lastOk: new Date().toISOString(), found: synced.length, updated };
    syncLog(`market-ok\tfound=${synced.length}\tupdated=${updated}`);
  } catch (error) {
    marketPredictionStatus = { ...marketPredictionStatus, running: false, lastError: error.message || String(error) };
    syncLog(`market-error\t${marketPredictionStatus.lastError}`);
  }
  return marketPredictionStatus;
}

async function fetchParsedMatches(source) {
  const response = await fetch(source.url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 Martebak26/1.0",
      "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`${source.label} returned ${response.status}`);
  const html = await response.text();
  const textParsed = source.parser ? source.parser(html) : [];
  const objects = extractJsonObjects(html);
  return [...textParsed, ...objects.flatMap(obj => walkFifaJson(obj))]
    .filter((item, index, arr) => arr.findIndex(other => other.id === item.id) === index);
}

async function runLiveScoreRealtimeSync() {
  if (liveScoreStatus.running) return liveScoreStatus;
  liveScoreStatus = { ...liveScoreStatus, running: true, lastRun: new Date().toISOString(), lastError: null, updatedScores: 0 };
  try {
    const synced = await fetchParsedMatches({ label: "worldcup26-scores", url: liveScoreUrl, parser: parseWorldCup26Games });
    const state = readState();
    const updated = mergeLiveScores(state, synced);
    writeState(state);
    liveScoreStatus = { ...liveScoreStatus, running: false, lastOk: new Date().toISOString(), updatedScores: updated };
    syncLog(`worldcup26-ok\tfound=${synced.length}\tupdatedScores=${updated}`);
  } catch (error) {
    liveScoreStatus = { ...liveScoreStatus, running: false, lastError: error.message || String(error) };
    syncLog(`worldcup26-error\t${liveScoreStatus.lastError}`);
  }
  return liveScoreStatus;
}

async function runFifaSync() {
  if (syncStatus.running) return syncStatus;
  syncStatus = { ...syncStatus, running: true, lastRun: new Date().toISOString(), lastError: null, updatedMatches: 0, sourceResults: [] };
  try {
    const state = readState();
    const sources = [
      { label: "mediaindonesia-schedule", url: mediaIndonesiaScheduleUrl, parser: parseMediaIndonesiaSchedule },
      { label: "worldcup26-scores", url: liveScoreUrl, parser: parseWorldCup26Games }
    ];
    let totalUpdated = 0;
    const sourceResults = [];
    for (const source of sources) {
      try {
        const synced = await fetchParsedMatches(source);
        const updated = source.label === "worldcup26-scores"
          ? mergeLiveScores(state, synced)
          : mergeSyncedMatches(state, synced);
        totalUpdated += updated;
        sourceResults.push({ label: source.label, ok: true, found: synced.length, updated });
        syncLog(`source-ok\t${source.label}\tfound=${synced.length}\tupdated=${updated}`);
      } catch (error) {
        sourceResults.push({ label: source.label, ok: false, error: error.message || String(error) });
        syncLog(`source-error\t${source.label}\t${error.message || String(error)}`);
      }
    }
    writeState(state);
    syncStatus = { ...syncStatus, running: false, lastOk: new Date().toISOString(), updatedMatches: totalUpdated, sourceResults };
    syncLog(`ok\ttotalUpdated=${totalUpdated}`);
  } catch (error) {
    syncStatus = { ...syncStatus, running: false, lastError: error.message || String(error) };
    syncLog(`error\t${syncStatus.lastError}`);
  }
  return syncStatus;
}

function authUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.headers["x-session-token"];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - Number(session.lastActivity || session.createdAt || 0) > sessionIdleMs) {
    sessions.delete(token);
    activityLog(req, "session-idle-expired", { name: session.name });
    return null;
  }
  session.lastActivity = Date.now();
  const state = readState();
  return state.users.find(user => String(user.name).toLowerCase() === String(session.name).toLowerCase()) || null;
}

function mergeParticipantsTable(state) {
  try {
    const text = fs.readFileSync(participantsTableFile, "utf8").trim();
    const lines = text.split(/\r?\n/).slice(1);
    const byName = new Map(state.users.map(user => [String(user.name).toLowerCase(), user]));
    for (const line of lines) {
      const [name, phone, role] = line.split("\t");
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        existing.phone = existing.phone || phone;
        existing.role = existing.role || role || "participant";
      } else {
        state.users.push({ name, phone, role: role || "participant" });
      }
    }
  } catch {}
  try {
    if (!fs.existsSync(participantsTableFile) || !fs.existsSync(predictionsTableFile) || !fs.existsSync(rankingTableFile) || !fs.existsSync(actualScoresTableFile) || !fs.existsSync(matchSummaryTableFile) || !fs.existsSync(marketPredictionTableFile)) writeAllTextTables(state);
  } catch {}
  return ensureState(state);
}

function mergeState(incoming) {
  const current = readState();
  const byName = new Map(current.users.map(user => [String(user.name).toLowerCase(), user]));
  const users = [...current.users];
  if (Array.isArray(incoming.users)) {
    incoming.users.forEach(user => {
      const key = String(user.name).toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        Object.assign(existing, { ...user, password: user.password || existing.password });
      } else {
        users.push(user);
      }
    });
  }
  return ensureState({
    users,
    schedule: Array.isArray(incoming.schedule) ? incoming.schedule : current.schedule,
    pred: incoming.pred || current.pred,
    predLocks: incoming.predLocks || current.predLocks,
    actual: incoming.actual || current.actual,
    summary: incoming.summary || current.summary,
    marketPrediction: incoming.marketPrediction || current.marketPrediction,
    notif: Array.isArray(incoming.notif) ? incoming.notif : current.notif,
    telegram: incoming.telegram || current.telegram,
    messages: Array.isArray(incoming.messages) ? incoming.messages : current.messages,
    online: incoming.online || current.online
  });
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/data.json") || req.url?.startsWith("/activity-log.txt") || req.url?.endsWith("-table.txt") || req.url?.startsWith("/participants-table.txt")) {
    activityLog(req, "blocked-private-file", {});
    return send(res, 404, "Not Found");
  }

  if (req.url?.startsWith("/api/tables") && (req.method === "GET" || req.method === "HEAD")) {
    const user = authUser(req);
    if (!user || user.role !== "admin") {
      activityLog(req, "tables-denied", { user: user?.name || null });
      return send(res, 403, JSON.stringify({ error: "Admin only" }), "application/json; charset=utf-8");
    }
    const state = readState();
    writeAllTextTables(state);
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const table = url.searchParams.get("name") || "participants";
    const files = {
      participants: participantsTableFile,
      predictions: predictionsTableFile,
      ranking: rankingTableFile,
      scores: actualScoresTableFile,
      summary: matchSummaryTableFile,
      market: marketPredictionTableFile,
      activity: activityLogFile
    };
    if (!files[table]) return send(res, 404, "Not Found");
    activityLog(req, "tables-read", { user: user.name, table });
    const body = req.method === "HEAD" ? "" : fs.readFileSync(files[table], "utf8");
    return send(res, 200, body, "text/plain; charset=utf-8");
  }

  if (req.url?.startsWith("/api/sync/status") && (req.method === "GET" || req.method === "HEAD")) {
    const user = authUser(req);
    if (!user || user.role !== "admin") {
      activityLog(req, "sync-status-denied", { user: user?.name || null });
      return send(res, 403, JSON.stringify({ error: "Admin only" }), "application/json; charset=utf-8");
    }
    activityLog(req, "sync-status-read", { user: user.name });
    return send(res, 200, req.method === "HEAD" ? "" : JSON.stringify({ scheduleSync: syncStatus, liveScoreRealtime: liveScoreStatus, marketPrediction: marketPredictionStatus }), "application/json; charset=utf-8");
  }

  if (req.url?.startsWith("/api/market/run") && req.method === "POST") {
    const user = authUser(req);
    if (!user || user.role !== "admin") {
      activityLog(req, "market-sync-denied", { user: user?.name || null });
      return send(res, 403, JSON.stringify({ error: "Admin only" }), "application/json; charset=utf-8");
    }
    activityLog(req, "market-sync-run", { user: user.name });
    runMarketPredictionSync().then(status => send(res, 200, JSON.stringify(status), "application/json; charset=utf-8"));
    return;
  }

  if (req.url?.startsWith("/api/match-summary") && (req.method === "GET" || req.method === "HEAD")) {
    const user = authUser(req);
    if (!user) {
      activityLog(req, "match-summary-auth-required", {});
      return send(res, 401, JSON.stringify({ error: "Login required" }), "application/json; charset=utf-8");
    }
    const state = readState();
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const matchId = String(url.searchParams.get("matchId") || "").trim();
    if (!matchId) return send(res, 400, JSON.stringify({ error: "matchId wajib diisi" }), "application/json; charset=utf-8");
    const match = (state.schedule || []).find(item => String(item.id) === matchId);
    const summary = state.summary?.[matchId] || { source: "worldcup26.ir", updatedAt: null, goals: [], events: [], stats: {} };
    activityLog(req, "match-summary-read", { user: user.name, role: user.role || "participant", matchId });
    return send(res, 200, req.method === "HEAD" ? "" : JSON.stringify({ matchId, match, summary }), "application/json; charset=utf-8");
  }

  if (req.url?.startsWith("/api/sync/run") && req.method === "POST") {
    const user = authUser(req);
    if (!user || user.role !== "admin") {
      activityLog(req, "sync-denied", { user: user?.name || null });
      return send(res, 403, JSON.stringify({ error: "Admin only" }), "application/json; charset=utf-8");
    }
    activityLog(req, "sync-run", { user: user.name });
    runFifaSync().then(status => send(res, 200, JSON.stringify(status), "application/json; charset=utf-8"));
    return;
  }

  if (req.url?.startsWith("/api/score/run") && req.method === "POST") {
    const user = authUser(req);
    if (!user || user.role !== "admin") {
      activityLog(req, "score-sync-denied", { user: user?.name || null });
      return send(res, 403, JSON.stringify({ error: "Admin only" }), "application/json; charset=utf-8");
    }
    activityLog(req, "score-sync-run", { user: user.name });
    runLiveScoreRealtimeSync().then(status => send(res, 200, JSON.stringify(status), "application/json; charset=utf-8"));
    return;
  }

  if (req.url?.startsWith("/api/heartbeat") && req.method === "POST") {
    const user = authUser(req);
    if (!user) {
      activityLog(req, "heartbeat-auth-required", {});
      return send(res, 401, JSON.stringify({ error: "Login required" }), "application/json; charset=utf-8");
    }
    const state = readState();
    state.online = state.online || {};
    state.online[user.name] = { role: user.role || "participant", lastSeen: new Date().toISOString() };
    writeState(state);
    const pub = publicState(readState());
    return send(res, 200, JSON.stringify({ ok: true, online: pub.online, messages: pub.messages }), "application/json; charset=utf-8");
  }

  if (req.url?.startsWith("/api/messages") && req.method === "POST") {
    const user = authUser(req);
    if (!user || user.role !== "admin") {
      activityLog(req, "message-write-denied", { user: user?.name || null });
      return send(res, 403, JSON.stringify({ error: "Admin only" }), "application/json; charset=utf-8");
    }
    return readJsonBody(req, (error, body) => {
      if (error) {
        activityLog(req, "message-invalid-json", { user: user.name });
        return send(res, 400, JSON.stringify({ error: "Invalid JSON" }), "application/json; charset=utf-8");
      }
      const text = String(body.text || "").trim().replace(/\s+/g, " ");
      if (!text) return send(res, 400, JSON.stringify({ error: "Pesan wajib diisi" }), "application/json; charset=utf-8");
      if (text.length > 240) return send(res, 400, JSON.stringify({ error: "Pesan maksimal 240 karakter" }), "application/json; charset=utf-8");
      const state = readState();
      const now = Date.now();
      state.messages = (state.messages || []).filter(message => !message.expiresAt || new Date(message.expiresAt).getTime() > now);
      state.messages.unshift({
        id: crypto.randomBytes(8).toString("hex"),
        text,
        createdBy: user.name,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString()
      });
      state.messages = state.messages.slice(0, 12);
      writeState(state);
      activityLog(req, "message-created", { user: user.name });
      return send(res, 200, JSON.stringify({ ok: true, messages: publicState(readState()).messages }), "application/json; charset=utf-8");
    });
  }

  if (req.url?.startsWith("/api/login") && req.method === "POST") {
    return readJsonBody(req, (error, body) => {
      if (error) {
        activityLog(req, "login-invalid-json", {});
        return send(res, 400, JSON.stringify({ error: "Invalid JSON" }), "application/json; charset=utf-8");
      }
      const state = readState();
      const name = String(body.name || "").trim();
      const password = String(body.password || "").trim();
      const phone = String(body.phone || "").trim();
      if (!name || !password || !phone) {
        activityLog(req, "login-missing-field", { name, phoneProvided: Boolean(phone) });
        return send(res, 400, JSON.stringify({ error: "Nama, password, dan nomor HP wajib diisi" }), "application/json; charset=utf-8");
      }
      const lockKey = loginAttemptKey(name, req);
      const activeLock = currentLoginLock(state, lockKey);
      if (activeLock) {
        activityLog(req, "login-locked", { name, lockedUntil: activeLock.lockedUntil });
        return send(res, 423, JSON.stringify({ error: loginLockMessage(activeLock.lockedUntil), lockedUntil: activeLock.lockedUntil }), "application/json; charset=utf-8");
      }
      let user = state.users.find(item => String(item.name).toLowerCase() === name.toLowerCase());
      if (user && user.password !== password) {
        const failed = recordFailedLogin(state, lockKey);
        writeState(state);
        activityLog(req, "login-password-mismatch", { name, role: user.role || "participant", failed: failed.failed, lockedUntil: failed.lockedUntil || null });
        if (failed.lockedUntil) {
          return send(res, 423, JSON.stringify({ error: loginFailureMessage(failed.failed, failed.lockedUntil), lockedUntil: failed.lockedUntil }), "application/json; charset=utf-8");
        }
        return send(res, 401, JSON.stringify({ error: loginFailureMessage(failed.failed) }), "application/json; charset=utf-8");
      }
      if (!user) {
        if (Date.now() >= registrationCloseAt) {
          const failed = recordFailedLogin(state, lockKey);
          writeState(state);
          activityLog(req, "register-closed", { name, phone, failed: failed.failed, lockedUntil: failed.lockedUntil || null });
          if (failed.lockedUntil) {
            return send(res, 423, JSON.stringify({ error: loginFailureMessage(failed.failed, failed.lockedUntil), lockedUntil: failed.lockedUntil }), "application/json; charset=utf-8");
          }
          return send(res, 403, JSON.stringify({ error: loginFailureMessage(failed.failed) }), "application/json; charset=utf-8");
        }
        user = { name, password, phone, role: "participant" };
        state.users.push(user);
        activityLog(req, "register-success", { name, phone, role: user.role });
      } else if (phone && user.role !== "admin") {
        user.phone = phone;
      }
      resetLoginFailures(state, lockKey);
      writeState(state);
      const { password: _, ...safeUser } = user;
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { name: user.name, createdAt: Date.now(), lastActivity: Date.now() });
      activityLog(req, "login-success", { name: user.name, phone: user.phone || "", role: user.role || "participant" });
      return send(res, 200, JSON.stringify({ token, user: safeUser, state: publicState(readState()) }), "application/json; charset=utf-8");
    });
  }

  if (req.url?.startsWith("/api/state")) {
    const user = authUser(req);
    if (!user) {
      activityLog(req, "state-auth-required", {});
      return send(res, 401, JSON.stringify({ error: "Login required" }), "application/json; charset=utf-8");
    }
    if (req.method === "GET" || req.method === "HEAD") {
      activityLog(req, "state-read", { user: user.name, role: user.role || "participant" });
      return send(res, 200, req.method === "HEAD" ? "" : JSON.stringify(publicState(readState())), "application/json; charset=utf-8");
    }
    if (req.method === "POST") {
      return readJsonBody(req, (error, data) => {
        if (error) {
          activityLog(req, "state-invalid-json", { user: user.name, role: user.role || "participant" });
          return send(res, 400, JSON.stringify({ error: "Invalid JSON" }), "application/json; charset=utf-8");
        }
        if (user.role === "viewer") {
          activityLog(req, "state-write-denied-viewer", { user: user.name });
          return send(res, 403, JSON.stringify({ error: "Viewer hanya dapat melihat data." }), "application/json; charset=utf-8");
        }
        if (user.role !== "admin") {
          const currentState = readState();
          if (Date.now() < predictionOpenAt) {
            activityLog(req, "prediction-save-before-open", { user: user.name });
            return send(res, 403, JSON.stringify({ error: "Prediksi baru dapat disimpan mulai 11 Juni 2026 pukul 09.00 WIB." }), "application/json; charset=utf-8");
          }
          const userPredictions = data.pred?.[user.name] || {};
          const notOpenWeek = changedPredictionWeeks(currentState, user.name, userPredictions).find(week => !weekOpen(week));
          if (notOpenWeek) {
            activityLog(req, "prediction-save-before-week-open", { user: user.name, week: notOpenWeek });
            return send(res, 403, JSON.stringify({ error: "Prediksi minggu ini belum terbuka. Periode setelah minggu 1 baru dapat diisi 1 hari sebelum periode tersebut." }), "application/json; charset=utf-8");
          }
          const lockedMatchId = hasLockedPredictionChange(currentState, user.name, userPredictions);
          if (lockedMatchId) {
            activityLog(req, "prediction-change-denied-locked", { user: user.name, matchId: lockedMatchId });
            return send(res, 403, JSON.stringify({ error: "Prediksi pertandingan ini sudah terkunci dan tidak dapat dirubah kembali." }), "application/json; charset=utf-8");
          }
          data.pred = { ...currentState.pred, [user.name]: userPredictions };
          data.predLocks = currentState.predLocks || {};
          data.schedule = undefined;
          data.actual = undefined;
          data.summary = undefined;
          data.marketPrediction = undefined;
          data.users = currentState.users;
          data.notif = currentState.notif;
          data.telegram = { ...currentState.telegram, [user.name]: data.telegram?.[user.name] || currentState.telegram?.[user.name] };
          data.messages = currentState.messages;
          data.online = currentState.online;
          activityLog(req, "prediction-draft-save", {
            user: user.name,
            predictionCount: Object.keys(userPredictions).length,
            locked: false
          });
        } else {
          activityLog(req, "admin-state-write", { user: user.name });
        }
        writeState(mergeState(data));
        send(res, 200, JSON.stringify({ ok: true }), "application/json; charset=utf-8");
      });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "Method Not Allowed");
  }

  let filePath = resolveFile(req.url || "/");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, "index.html");
  }

  fs.readFile(filePath, (error, body) => {
    if (error) return send(res, 500, "Internal Server Error");
    if (path.basename(filePath) === "index.html") activityLog(req, "page-view", {});
    if (req.method === "HEAD") return send(res, 200, "", types[path.extname(filePath)] || "application/octet-stream");
    send(res, 200, body, types[path.extname(filePath)] || "application/octet-stream");
  });
});

server.listen(port, host, () => {
  console.log(`Martebak26 production server running at http://localhost:${port}`);
  setTimeout(() => runFifaSync(), 3000);
  setTimeout(() => runLiveScoreRealtimeSync(), 6000);
  setTimeout(() => runMarketPredictionSync(), 9000);
  setInterval(() => runFifaSync(), syncIntervalMs);
  setInterval(() => runLiveScoreRealtimeSync(), liveScoreRealtimeIntervalMs);
  setInterval(() => runMarketPredictionSync(), syncIntervalMs);
});
