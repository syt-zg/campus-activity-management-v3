/* ==========================================================================
 * 规则引擎（V3.0 能力扩展）
 *
 * 背景：V3.0 第一轮迭代后，全部能力仍由 HTTP 请求触发。模拟数据里 85.2% 的
 * 候补者（746/876）在活动开始后仍无任何终态记录，状态页被反复访问 293 次，
 * 说明"人不来问，系统就不说话"是真实缺口。
 *
 * 本模块只做纯计算：输入活动快照与当前时间，输出应当产生的消息。
 * 落库、去重、调度由调用方负责，便于单测直接验证规则命中。
 * ========================================================================== */

'use strict';

const STATUS = Object.freeze({
  PENDING: '待审核',
  APPROVED: '正式参加',
  WAITLIST: '候补中',
  REJECTED: '未通过'
});

const DEFAULT_CONFIG = Object.freeze({
  reminderHours: 24,        // 活动开始前多久提醒已确认参加者
  waitlistNearHours: 12,    // 距开始不足该小时数时告知候补排位
  shortageRatio: 2,         // 候补人数达到名额的多少倍判定为供给不足
  historicalPromoteRate: 0.15 // 近 7 天候补转正率，用于临期提示的口径说明
});

function regs(item) {
  return Array.isArray(item.registrations) ? item.registrations : [];
}

function toMs(text) {
  const value = Date.parse(String(text || '').replace(' ', 'T'));
  return Number.isFinite(value) ? value : NaN;
}

function shortTime(text) {
  return String(text || '').slice(5, 16);
}

function hoursBetween(fromMs, toMs_) {
  return (toMs_ - fromMs) / 3600000;
}

/**
 * 计算两个活动的时间重叠分钟数；无重叠或时间不可解析时返回 0。
 * 活动起止时间取自教师发布时填写的 startTime / endTime。
 */
function overlapMinutes(a, b) {
  const aStart = toMs(a.startTime);
  const aEnd = toMs(a.endTime);
  const bStart = toMs(b.startTime);
  const bEnd = toMs(b.endTime);
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return 0;
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return end > start ? Math.round((end - start) / 60000) : 0;
}

/* ---------------------------- 规则定义 ---------------------------- */

/**
 * 每条规则产出统一结构：
 * { ruleId, userId, role, type, title, content, activityId, dedupeKey, link }
 * dedupeKey 由规则给出，调用方据此保证同一事件只通知一次。
 */
const RULES = [
  {
    id: 'waitlist_final',
    label: '候补终局',
    // 活动已开始而本人仍在候补：必须给出明确结论，不能让人一直"等下去"
    match(item, ctx) {
      return ctx.nowMs >= ctx.startMs && ctx.waitlist.length > 0;
    },
    emit(item, ctx) {
      return ctx.waitlist.map(reg => ({
        ruleId: 'waitlist_final',
        userId: reg.userId,
        role: 'student',
        type: 'warn',
        title: '候补结果：本期未获得名额',
        content: `「${item.title}」已于 ${shortTime(item.startTime)} 开始，您在候补队列中未能获得名额。`,
        activityId: item.id,
        dedupeKey: `waitlist_final:${item.id}:${reg.userId}`
      }));
    }
  },
  {
    id: 'waitlist_near',
    label: '候补临期提示',
    match(item, ctx) {
      return ctx.nowMs < ctx.startMs
        && ctx.hoursToStart <= ctx.config.waitlistNearHours
        && ctx.waitlist.length > 0;
    },
    emit(item, ctx) {
      return ctx.waitlist.map((reg, index) => ({
        ruleId: 'waitlist_near',
        userId: reg.userId,
        role: 'student',
        type: 'info',
        title: '候补即将截止',
        content: `「${item.title}」将于 ${shortTime(item.startTime)} 开始，您当前排在第 ${index + 1} 位。`
          + `历史候补转正率约 ${Math.round(ctx.config.historicalPromoteRate * 100)}%，建议同时关注仍有余额的活动。`,
        activityId: item.id,
        dedupeKey: `waitlist_near:${item.id}:${reg.userId}`
      }));
    }
  },
  {
    id: 'activity_reminder',
    label: '活动开始提醒',
    match(item, ctx) {
      return ctx.nowMs < ctx.startMs
        && ctx.hoursToStart <= ctx.config.reminderHours
        && ctx.approved.length > 0;
    },
    emit(item, ctx) {
      return ctx.approved.map(reg => ({
        ruleId: 'activity_reminder',
        userId: reg.userId,
        role: 'student',
        type: 'info',
        title: '活动即将开始',
        content: `「${item.title}」将于 ${shortTime(item.startTime)} 在 ${item.location || '指定地点'} 开始，请按时到场并由组织老师完成签到。`,
        activityId: item.id,
        dedupeKey: `activity_reminder:${item.id}:${reg.userId}`
      }));
    }
  },
  {
    id: 'capacity_shortage',
    label: '供给不足建议',
    // 候补达到名额的 N 倍：不是"热门"，而是供给判断该做决定了
    match(item, ctx) {
      return ctx.capacity > 0
        && ctx.waitlist.length >= ctx.capacity * ctx.config.shortageRatio;
    },
    emit(item, ctx) {
      const ratio = (ctx.waitlist.length / ctx.capacity).toFixed(1);
      const content = `「${item.title}」名额 ${item.maxParticipants}，当前候补 ${ctx.waitlist.length} 人（达名额 ${ratio} 倍）。`
        + `建议评估扩容、加开场次或更换更大场地，以消化等待队列。`;
      const targets = [];
      if (Number(item.publisherId)) {
        targets.push({ userId: item.publisherId, role: 'teacher' });
      }
      for (const adminId of ctx.adminIds) {
        targets.push({ userId: adminId, role: 'admin' });
      }
      return targets.map(target => ({
        ruleId: 'capacity_shortage',
        userId: target.userId,
        role: target.role,
        type: 'action',
        title: '供给不足：建议扩容',
        content,
        activityId: item.id,
        dedupeKey: `capacity_shortage:${item.id}:${target.userId}`
      }));
    }
  }
];

/**
 * 执行全部规则，返回待写入的消息数组。
 * @param {Array} activities 活动快照（含 registrations）
 * @param {number} nowMs 当前时间戳
 * @param {object} options { config, adminIds }
 */
function evaluate(activities, nowMs, options) {
  const config = Object.assign({}, DEFAULT_CONFIG, (options && options.config) || {});
  const adminIds = (options && options.adminIds) || [];
  const output = [];
  for (const item of activities || []) {
    if (!item || item.archived === true) continue;
    const startMs = toMs(item.startTime);
    if (!Number.isFinite(startMs)) continue;
    const capacity = Number(item.maxParticipants || 0);
    const ctx = {
      nowMs,
      startMs,
      capacity,
      hoursToStart: hoursBetween(nowMs, startMs),
      config,
      adminIds,
      approved: regs(item).filter(reg => reg.status === STATUS.APPROVED),
      waitlist: regs(item).filter(reg => reg.status === STATUS.WAITLIST)
    };
    for (const rule of RULES) {
      if (!rule.match(item, ctx)) continue;
      for (const message of rule.emit(item, ctx)) output.push(message);
    }
  }
  return output;
}

module.exports = { evaluate, overlapMinutes, DEFAULT_CONFIG, STATUS, toMs };
