/*
 * V3.0 新增：运行事件日志（可观测性基础设施）
 * ------------------------------------------------------------------
 * 需求依据：实验三模拟数据包中的"系统日志"表表明，系统的运行质量与用户
 * 行为只能靠外部数据推断；而 V2.0 自身不记录任何过程事件（报名、取消、
 * 审核、递补、出席全都没有留痕），导致每一轮迭代都要依赖外部数据喂。
 *
 * 设计取舍：
 * 1. 采用 JSON Lines（一行一个事件）而不是塞进 activities.json ——
 *    现有 writeJson 是全量序列化 + 每次备份，事件量大时会显著放大写入成本；
 *    追加写（appendFileSync）成本恒定，且天然按时间有序。
 * 2. 事件与业务数据分离：事件文件损坏不影响主业务，主业务损坏也不丢事件。
 * 3. 单文件超过 5 MB 自动滚动为 events.archive.jsonl，避免无限增长。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.CAMPUS_ACTIVITY_DATA_DIR || path.resolve(__dirname, '../data'));
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const ARCHIVE_FILE = path.join(DATA_DIR, 'events.archive.jsonl');
const MAX_BYTES = 5 * 1024 * 1024;

/** 本地时间文本，与活动业务字段（startTime 等）使用同一时区口径 */
function localText(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function rotateIfNeeded() {
  try {
    if (fs.existsSync(EVENTS_FILE) && fs.statSync(EVENTS_FILE).size > MAX_BYTES) {
      fs.renameSync(EVENTS_FILE, ARCHIVE_FILE);
    }
  } catch (error) {
    console.warn('事件日志滚动失败：' + error.message);
  }
}

/**
 * 写入一条事件。任何异常都不得影响主业务流程，因此整体包在 try 中。
 * @param {string} type 事件类型，见下方 EVENT_TYPES
 * @param {object} payload actor / activity / result / detail / durationMs
 */
function logEvent(type, payload = {}) {
  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    time: localText(),
    type,
    actorId: payload.actor ? payload.actor.id : null,
    actorRole: payload.actor ? payload.actor.role : null,
    actorName: payload.actor ? (payload.actor.real_name || payload.actor.name || '') : '',
    activityId: payload.activity ? payload.activity.id : null,
    activityTitle: payload.activity ? (payload.activity.title || '') : '',
    result: payload.result || 'ok',
    detail: payload.detail === undefined ? '' : payload.detail,
    durationMs: payload.durationMs === undefined ? null : payload.durationMs
  };
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (error) {
    console.warn('事件写入失败（不影响业务）：' + error.message);
  }
  return record;
}

/** 逆序读取（最新在前），支持类型过滤与分页 */
function readEvents({ type = '', limit = 50, offset = 0, from = '' } = {}) {
  let lines = [];
  try {
    if (fs.existsSync(EVENTS_FILE)) {
      lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
    }
  } catch (error) {
    console.warn('事件读取失败：' + error.message);
  }
  const list = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let item;
    try { item = JSON.parse(lines[i]); } catch { continue; }
    if (type && item.type !== type) continue;
    if (from && String(item.time) < from) continue;
    list.push(item);
  }
  const total = list.length;
  return { total, list: list.slice(offset, offset + limit) };
}

/** 供统计使用：一次读出全部事件（仅用于聚合，不返回给前端） */
function allEvents() {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return [];
    return fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

const EVENT_TYPES = Object.freeze({
  LOGIN: 'login',
  LOGIN_FAILED: 'login_failed',
  REGISTER: 'register',
  ACTIVITY_CREATE: 'activity_create',
  ACTIVITY_UPDATE: 'activity_update',
  ACTIVITY_ARCHIVE: 'activity_archive',
  ACTIVITY_SUSPEND: 'activity_suspend',
  ACTIVITY_RESUME: 'activity_resume',
  JOIN_APPROVED: 'join_approved',
  JOIN_PENDING: 'join_pending',
  JOIN_WAITLIST: 'join_waitlist',
  JOIN_BLOCKED: 'join_blocked',
  CANCEL: 'cancel',
  REVIEW_APPROVE: 'review_approve',
  REVIEW_REJECT: 'review_reject',
  PROMOTE: 'promote',
  WAITLIST_CONFIRM: 'waitlist_confirm',
  WAITLIST_EXPIRE: 'waitlist_expire',
  CHECKIN: 'checkin',
  EXPORT: 'export'
});

module.exports = { logEvent, readEvents, allEvents, localText, EVENT_TYPES, EVENTS_FILE, DATA_DIR };
