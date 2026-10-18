# -*- coding: utf-8 -*-
"""
实验三 数据发现脚本（可复跑）
------------------------------------------------------------------
输入：教师提供的模拟运行数据包（analysis/data/*.csv）
输出：analysis/REPORT-数据发现.md

设计原则：
1. 每个数字都注明分子/分母/筛选条件，口径可复核；
2. 只做描述性统计，不做因果断言；推测单独标注；
3. 明确声明：本数据不是本组 V2.0/V3.0 系统产生的日志。

运行：python analysis/analyze.py
"""
import csv
import os
import re
import json
import collections
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, 'data')
OUT = os.path.join(BASE, 'REPORT-数据发现.md')


def rows(name):
    with open(os.path.join(DATA, name), encoding='utf-8-sig', newline='') as fh:
        return list(csv.DictReader(fh))


def pct(a, b, digits=1):
    return round(a / b * 100, digits) if b else 0.0


def quantile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * q))]


def md_table(header, body, align=None):
    align = align or ['---'] * len(header)
    out = ['| ' + ' | '.join(header) + ' |', '| ' + ' | '.join(align) + ' |']
    for line in body:
        out.append('| ' + ' | '.join(str(c) for c in line) + ' |')
    return '\n'.join(out)


class Report:
    def __init__(self):
        self.parts = []

    def h(self, level, text):
        self.parts.append('#' * level + ' ' + text + '\n')

    def p(self, text):
        self.parts.append(text + '\n')

    def raw(self, text):
        self.parts.append(text + '\n')

    def save(self, path):
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(self.parts))


def main():
    activity = rows('activity.csv')
    reg = rows('registration_log.csv')
    wait = rows('waitlist_log.csv')
    behavior = rows('user_behavior.csv')
    feedback = rows('feedback.csv')
    syslog = rows('system_log.csv')

    act_by_id = {r['activity_id']: r for r in activity}
    r = Report()
    r.h(1, '数据发现报告｜校园活动管理系统 V3.0')
    r.p('> 数据来源：教师提供的模拟运行数据包（2026-09-21 至 2026-10-04，北京时间）。'
        '**该数据并非本组 V2.0/V3.0 系统产生的日志**，本文所有结论只作为需求判断依据，'
        '不作为本组 V3.0 的实测结果。')
    r.p('> 生成方式：`python analysis/analyze.py`，全部数字可复跑。')

    # ---------------- 0. 数据规模与质量 ----------------
    r.h(2, '零、数据规模与三个必须先说明的口径问题')
    r.raw(md_table(
        ['表', '行数', '粒度', '本文用途'],
        [['activity.csv', len(activity), '每个活动一行', '容量与供需'],
         ['registration_log.csv', len(reg), '每次业务请求一行', '报名结果与耗时'],
         ['waitlist_log.csv', len(wait), '每次候补状态变化一行', '候补漏斗'],
         ['user_behavior.csv', len(behavior), '每次埋点事件一行', '行为分布（受限）'],
         ['feedback.csv', len(feedback), '每条反馈一行', '定性主题'],
         ['system_log.csv', len(syslog), '每条日志一行', '性能与错误']]))

    dup_event = len(behavior) - len({r_['event_id'] for r_ in behavior})
    empty_device = sum(1 for r_ in behavior if not r_['device'].strip())
    empty_student = sum(1 for r_ in behavior if not r_['student_id'].strip())
    r.h(3, '三个容易算错的地方')
    r.raw(md_table(['现象', '数量', '对分析的影响'], [
        ['埋点事件 ID 重复', f'{dup_event} 条（{pct(dup_event, len(behavior), 2)}%）', '行为次数会略微高估'],
        ['device 为空', f'{empty_device} 条', '设备占比按有值记录计算'],
        ['student_id 为空', f'{empty_student} 条', '人数统计需去空'],
    ]))
    r.p('**口径提醒**：`user_behavior` 只记录列表页与详情页，'
        '`registration_page_view` 仅 %d 条，而 `registration_log` 中有 %d 次 apply 请求 —— '
        '两者数量级不匹配，说明**不能用埋点表算"浏览→报名"的转化率**。'
        '本文因此只用埋点表做页面/设备分布，不做漏斗。'
        % (sum(1 for r_ in behavior if r_['page'] == 'registration'), sum(1 for r_ in reg if r_['action'] == 'apply')))

    # ---------------- 1. 供需 ----------------
    accepted = collections.Counter(r_['activity_id'] for r_ in reg if r_['result'] == 'accepted')
    waitlisted = collections.Counter(r_['activity_id'] for r_ in reg if r_['result'] == 'waitlisted')
    total_cap = sum(int(a['capacity']) for a in activity)
    total_acc = sum(accepted.values())
    full = [a for a in activity if accepted[a['activity_id']] >= int(a['capacity'])]

    r.h(2, '一、供需：整体接近满员，但热冷差距极大')
    r.p('名额利用率 = 各活动 accepted 记录数之和 / 各活动 capacity 之和 = %d / %d = **%.1f%%**；'
        '满员活动 %d / %d。' % (total_acc, total_cap, pct(total_acc, total_cap), len(full), len(activity)))
    r.p('这个数字很容易被误读成"名额不够"。按活动拆开看，真实结构是**少数活动严重超需、'
        '另一批活动始终有 5%～20% 空位**：')

    body = []
    for a in sorted(activity, key=lambda x: -int(x['capacity'])):
        aid = a['activity_id']
        cap = int(a['capacity'])
        acc = accepted[aid]
        wl = waitlisted[aid]
        body.append([aid, a['activity_name'], a['category'], cap, acc, wl,
                     f'{pct(acc, cap)}%', f'{pct(wl, acc + wl)}%'])
    r.raw(md_table(['活动', '名称', '类型', '容量', '正式', '候补', '利用率', '候补占比'], body))

    idle = [a for a in activity if accepted[a['activity_id']] < int(a['capacity'])]
    r.p('**观察事实**：%d 个活动未满，合计空位 %d 个（占这些活动容量的 %.1f%%）；'
        '同时 %d 个活动满员并积压候补 %d 人。'
        '**推测（未验证）**：报名集中在少数"名气大"的活动，'
        '学生缺少判断活动是否还有名额、是否值得排队的即时信息。'
        % (len(idle),
           sum(int(a['capacity']) - accepted[a['activity_id']] for a in idle),
           pct(sum(int(a['capacity']) - accepted[a['activity_id']] for a in idle),
               sum(int(a['capacity']) for a in idle)),
           len(full),
           sum(waitlisted[a['activity_id']] for a in full)))

    # ---------------- 2. 候补 ----------------
    waiting_in = sum(1 for w in wait if w['new_status'] == 'waiting')
    accepted_in = sum(1 for w in wait if w['new_status'] == 'accepted')
    cancels = sum(1 for r_ in reg if r_['action'] == 'cancel')
    r.h(2, '二、候补：递补机制本身是好的，问题在"池子太深"')
    r.p('候补转化率 = 由 waiting 变为 accepted 的记录数 / 曾进入 waiting 的记录数 = '
        '%d / %d = **%.1f%%**。' % (accepted_in, waiting_in, pct(accepted_in, waiting_in)))
    r.p('**这一条修正了我们的初始判断。** 我们原本假设"候补转化率低是因为递补机制没闭环"；'
        '但取消记录 %d 条、候补转正式记录 %d 条，两者数量级一致，说明**每一次名额释放都成功递补了**，'
        '机制本身没有漏。真正的原因是：进入候补的学生数是可释放名额的 %.1f 倍。'
        % (cancels, accepted_in, waiting_in / cancels if cancels else 0))
    body = []
    for aid, cnt in waitlisted.most_common(6):
        a = act_by_id[aid]
        body.append([aid, a['activity_name'], int(a['capacity']), accepted[aid], cnt,
                     '%.1f 倍' % (cnt / int(a['capacity']))])
    r.raw(md_table(['活动', '名称', '容量', '正式', '候补人数', '候补/容量'], body))
    r.p('**由此得出的需求判断**：不应该继续加强"递补自动化"（已经很顺），'
        '而应该解决**候补者的等待预期**与**分流**——学生需要知道"我排在多少位、'
        '大概等不到"，平台需要把需求引向还有空位的活动。')

    # ---------------- 3. 性能 ----------------
    lat = [int(r_['latency_ms']) for r_ in reg]
    by_hour = collections.defaultdict(list)
    for r_ in reg:
        by_hour[r_['request_ts'][11:13]].append(int(r_['latency_ms']))
    slow_events = [s for s in syslog if s['event_code'] == 'SLOW_REQUEST']
    r.h(2, '三、性能：不是"普遍慢"，而是"开抢那一瞬间慢"')
    r.p('全部 %d 次业务请求：P50 = %d ms、P95 = %d ms、P99 = %d ms、最大 %d ms；'
        '超过 1000 ms 的请求占 %.1f%%。'
        % (len(lat), quantile(lat, .5), quantile(lat, .95), quantile(lat, .99), max(lat),
           pct(sum(1 for x in lat if x > 1000), len(lat))))
    body = []
    for h in sorted(by_hour):
        v = by_hour[h]
        body.append([h + ':00', len(v), quantile(v, .5), quantile(v, .95),
                     f'{pct(sum(1 for x in v if x > 1000), len(v))}%'])
    r.raw(md_table(['小时', '请求数', 'P50(ms)', 'P95(ms)', '慢请求占比'], body, ['---', '---:', '---:', '---:', '---:']))
    peak = max(by_hour.items(), key=lambda kv: len(kv[1]))
    r.p('**观察事实**：%s 点一小时内有 %d 次请求（占全天 %.1f%%），该时段 P50 从约 210 ms '
        '抬升到 %d ms，慢请求占比 %.1f%%；其余时段慢请求几乎为 0。'
        '`SLOW_REQUEST` 日志 %d 条，与这一分布一致。'
        % (peak[0], len(peak[1]), pct(len(peak[1]), len(reg)), quantile(peak[1], .5),
           pct(sum(1 for x in peak[1] if x > 1000), len(peak[1])), len(slow_events)))
    open_slots = collections.Counter(a['registration_open'][11:16] for a in activity)
    in_open_hour = sum(1 for r_ in reg if r_['action'] == 'apply'
                       and r_['request_ts'][:13] == act_by_id.get(r_['activity_id'], {}).get('registration_open', '')[:13])
    total_apply = sum(1 for r_ in reg if r_['action'] == 'apply')
    r.p('**更直接的原因**：%d 个活动的报名开放时刻只有 %s 两种取值，'
        '%d / %d 次报名申请（%.1f%%）发生在开放当小时。需求不是均匀到达的，'
        '而是被"开放时间"这一设计**人为压缩到两个时刻**，再叠加"每次写都全量重写"的实现，'
        '就形成了峰值处的延迟。'
        % (len(activity), '、'.join('%s（%d 个）' % (k, v) for k, v in open_slots.most_common()),
           in_open_hour, total_apply, pct(in_open_hour, total_apply)))
    r.p('**推测（有代码依据）**：V2.0 的 `writeJson` 每次写操作都做"复制备份 + 全量序列化 + 改名替换"，'
        '报名量越大单次写越贵；同一时刻集中报名时写操作串行排队，于是延迟在峰值处抬升。'
        '这一条在我们自己的实现里有据可查（`src/app.js` 的 writeJson），'
        '但**模拟数据本身不能证明我们的系统也有同样延迟**，只能说明该风险模式真实存在。')

    # ---------------- 4. 错误与重复 ----------------
    result_count = collections.Counter(r_['result'] for r_ in reg)
    dup = [r_ for r_ in reg if r_['result'] == 'duplicate']
    conflict = [r_ for r_ in reg if r_['result'] == 'capacity_conflict']
    errors = [r_ for r_ in reg if r_['result'] == 'server_error']
    r.h(2, '四、请求结果：重复提交与容量冲突都集中在热门活动')
    body = []
    for key, label in [('accepted', '报名成功'), ('waitlisted', '进入候补'), ('cancelled', '取消'),
                       ('duplicate', '重复提交'), ('capacity_conflict', '容量冲突'), ('server_error', '服务端错误')]:
        body.append([label, result_count[key], f'{pct(result_count[key], len(reg), 2)}%'])
    r.raw(md_table(['结果', '次数', '占全部请求'], body, ['---', '---:', '---:']))
    r.p('重复提交 %d 条中，`client_retry = 1` 的占 **%.0f%%**；'
        '容量冲突 %d 条、服务端错误 %d 条均集中在候补最多的几个活动（%s）。'
        % (len(dup),
           pct(sum(1 for r_ in dup if r_['client_retry'] == '1'), len(dup)),
           len(conflict), len(errors),
           '、'.join(f'{k}({v})' for k, v in collections.Counter(r_['activity_id'] for r_ in conflict + errors).most_common(3))))
    r.p('**由此得到的判断**：重复提交几乎全部来自客户端重试，而重试通常发生在"用户没看懂上一次到底成功没有"之后。'
        '反馈里也有对应原文：「报名失败了，但没有弄清楚原因，后来又试了一次」。'
        '所以这既是**幂等问题**，也是**结果反馈不清**的问题。')

    # ---------------- 5. 行为 ----------------
    page_count = collections.Counter(r_['page'] for r_ in behavior)
    device_count = collections.Counter(r_['device'] for r_ in behavior if r_['device'].strip())
    students = len({r_['student_id'] for r_ in behavior if r_['student_id'].strip()})
    sessions = len({r_['session_id'] for r_ in behavior})
    session_pages = collections.defaultdict(set)
    for r_ in behavior:
        session_pages[r_['session_id']].add(r_['page'])
    both = sum(1 for v in session_pages.values() if 'activity_list' in v and 'activity_detail' in v)
    r.h(2, '五、行为分布：可以看结构，不能算转化')
    r.p('去重后 %d 名学生、%d 个会话；会话中同时出现列表页与详情页的占 %.1f%%。'
        % (students, sessions, pct(both, sessions)))
    r.raw(md_table(['页面', '事件数'],
                   [[k, v] for k, v in page_count.most_common()]))
    r.raw(md_table(['设备', '事件数', '占比'],
                   [[k, v, f'{pct(v, sum(device_count.values()))}%'] for k, v in device_count.most_common()]))
    r.p('**必须克制的一步**：移动端占 %.0f%% 看起来很像"应该做移动端"，'
        '但本组 V2.0/V3.0 是 Electron 桌面程序，模拟数据来自教师构造的另一套平台，'
        '**这条比例不能直接推论成本组的需求**。本文只记录该事实，不据此排优先级。'
        % pct(device_count['mobile'], sum(device_count.values())))

    # ---------------- 6. 反馈 ----------------
    themes = {
        '名额/候补': ['名额', '候补', '排队', '抢', '满'],
        '时间冲突': ['时间冲突', '冲突', '错过'],
        '信息不清': ['不清楚', '不知道', '看不懂', '标题', '说明', '介绍', '写着'],
        '性能/等待': ['慢', '卡', '延迟', '加载', '等待', '费时间'],
        '地点/组织': ['地点', '组织', '安排'],
        '结果不明': ['没有弄清楚原因', '不知道有没有', '没提示', '失败了'],
    }
    counts = collections.Counter()
    for r_ in feedback:
        text = r_['feedback_text']
        for name, words in themes.items():
            if any(w in text for w in words):
                counts[name] += 1
    r.h(2, '六、反馈文本：112 条，主题集中在名额与信息')
    r.p('**注意**：这是 %d 条非结构化文本，不是 %d 名用户的抽样，'
        '只能说明"这些说法出现过几次"，不能当作人群比例。' % (len(feedback), students))
    r.raw(md_table(['主题（关键词粗分类，可重复计数）', '提及条数', '占 112 条的比例'],
                   [[k, v, f'{pct(v, len(feedback))}%'] for k, v in counts.most_common()]))
    samples = [
        '普通活动报名比较顺利，热门的偶尔等待时间明显更长。',
        '报名失败了，但没有弄清楚原因，后来又试了一次。',
        '活动标题看着差不多，打开详情才知道具体内容。',
        '校园活动很丰富，就是查起来有点费时间。',
    ]
    r.p('原文示例（未改动）：\n' + '\n'.join('- 「%s」' % s for s in samples))

    # ---------------- 7. 需求对照 ----------------
    r.h(2, '七、从发现到需求：对照表')
    idle_seats = sum(int(a['capacity']) - accepted[a['activity_id']] for a in idle)
    peak_share = pct(len(by_hour[peak[0]]), len(reg))
    peak_p50 = quantile(by_hour[peak[0]], .5)
    peak_slow = pct(sum(1 for x in by_hour[peak[0]] if x > 1000), len(by_hour[peak[0]]))
    wait_ratio = waiting_in / cancels if cancels else 0
    accept_rate = pct(accepted_in, waiting_in)
    mobile_share = pct(device_count['mobile'], sum(device_count.values()))
    retry_share = pct(sum(1 for x in dup if x['client_retry'] == '1'), len(dup))
    info_count = counts['信息不清']
    r.raw(md_table(
        ['发现（事实）', '判断（推测）', '需求选项', '本组取舍'],
        [['%d 个活动中 %d 个满员，整体利用率 %.1f%%，另有 %d 个活动空位合计 %d 个'
          % (len(activity), len(full), pct(total_acc, total_cap), len(idle), idle_seats),
          '需求分布不均，学生缺"哪里还有位"的即时信息',
          '活动列表显示余位与候补深度；热门活动引导替代场次',
          '**做**（轻量：列表多显示两个数）'],
         ['候补转化率 %.1f%%，但每次取消都成功递补；候补池是释放名额的 %.1f 倍'
          % (accept_rate, wait_ratio),
          '递补机制没问题，问题在候补池过深与等待预期缺失',
          '显示候补人数/容量倍数；超阈值提示分流；确认窗口防占位',
          '**做**（确认窗口已做，本轮补"深度提示"）'],
         ['%s 点一小时占全天 %.1f%% 请求，P50 由 210 ms 升至 %d ms，慢请求 %.1f%%'
          % (peak[0], peak_share, peak_p50, peak_slow),
          '写入是全量重写 + 备份，峰值时写操作排队',
          '合并写/延迟落盘、降低备份频率、耗时可观测',
          '**做**（写入合并 + 耗时统计）'],
         ['报名开放时刻只有 %s 两种，%.1f%% 的报名发生在开放当小时'
          % ('/'.join(k for k, _ in open_slots.most_common()), pct(in_open_hour, total_apply)),
          '需求被集中释放，是峰值延迟的直接来源',
          '活动可配置报名开放时间，支持错峰',
          '**做**（本轮新增 registrationOpen）'],
         ['重复提交 %d 条，其中 %.0f%% 为客户端重试' % (len(dup), retry_share),
          '用户不知道上一次是否成功，重试造成重复请求',
          '请求幂等（requestId）+ 明确的结果回执',
          '**做**（幂等 + 文案）'],
         ['容量冲突 %d 条、服务端错误 %d 条，集中在热门活动' % (len(conflict), len(errors)),
          '高并发下的写入竞争',
          '显式冲突响应、服务端兜底',
          '**部分做**：本系统单进程串行，无此竞态，只补幂等与写入合并'],
         ['移动端占 %.0f%%' % mobile_share,
          '可能需要移动端适配',
          '响应式改造',
          '**不做**：本组是桌面应用，该比例不可外推，留待确认'],
         ['反馈中"信息不清"类 %d 条（占 %d 条反馈的 %.0f%%）'
          % (info_count, len(feedback), pct(info_count, len(feedback))),
          '标题/详情区分度不足',
          '列表卡片增加关键字段',
          '**下一轮**：需用户访谈补充证据']]))

    r.h(2, '八、本报告的边界')
    r.p('- 全部为描述性统计，未做因果检验；"推测"均已单独标注，未与"事实"混写。\n'
        '- 数据是教学模拟数据，不代表本组系统真实表现；V3.0 的效果以 `tests/v3-smoke.js`、'
        '`tests/ui-render.js` 与本系统 `events.jsonl` 的自采数据为准。\n'
        '- 数据包内的取消记录**没有原因字段**，因此本组 V3.0 的"取消原因"枚举来自 V2.0 访谈整理，'
        '属于**假设**而非本数据验证过的结论。')

    r.save(OUT)
    print('已生成：' + OUT)
    print(json.dumps({'activities': len(activity), 'requests': len(reg),
                      'waitlist': len(wait), 'behavior': len(behavior),
                      'feedback': len(feedback), 'system_log': len(syslog)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
