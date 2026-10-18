/* 前端唯一接口入口：业务数据不再读写活动/用户/报名 localStorage */
const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
const Api = {
  token: () => localStorage.getItem('cas_token'),
  async request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = this.token(); if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try { res = await fetch(`${API_BASE}${path}`, { ...options, headers }); }
    catch (error) { throw new Error('无法连接后端服务：请先启动 backend，并确认 http://localhost:3000 可访问'); }
    let body;
    try { body = await res.json(); }
    catch { throw new Error(`服务器返回了无效响应（HTTP ${res.status}）`); }
    if (body.code !== 200) throw new Error(body.msg || this.httpMessage(res.status));
    return body.data;
  },
  httpMessage(status) { return status === 404 ? '接口不存在，请检查后端版本' : status === 500 ? '服务器内部错误，请查看后端控制台' : `请求失败（HTTP ${status}）`; },

  /* ===== 认证 ===== */
  login: (username, password) => Api.request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: data => Api.request('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  teacherApply: data => Api.request('/auth/teacher/apply', { method: 'POST', body: JSON.stringify(data) }),
  teacherVerify: data => Api.request('/auth/teacher/verify', { method: 'POST', body: JSON.stringify(data) }),
  info: () => Api.request('/auth/info'),
  setAvatar: data => Api.request('/auth/avatar', { method: 'PUT', body: JSON.stringify(data) }),
  changePassword: data => Api.request('/auth/password', { method: 'PUT', body: JSON.stringify(data) }),
  logout: () => Api.request('/auth/logout', { method: 'POST' }),

  /* ===== 活动（学生 / 教师共用） ===== */
  list: params => Api.request(`/activity/list?${new URLSearchParams(params)}`),
  detail: id => Api.request(`/activity/${id}`),
  myJoin: () => Api.request('/activity/myjoin'),
  join: id => Api.request(`/activity/${id}/join`, { method: 'POST' }),
  cancel: (id, payload) => Api.request(`/activity/${id}/join`, { method: 'DELETE', body: JSON.stringify(payload || {}) }),
  confirmSeat: id => Api.request(`/activity/${id}/confirm`, { method: 'POST' }),
  myActivities: () => Api.request('/activity/my'),
  create: data => Api.request('/activity', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => Api.request(`/activity/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: id => Api.request(`/activity/${id}`, { method: 'DELETE' }),
  joinList: id => Api.request(`/activity/${id}/joinlist`),
  review: (id, userId, action) => Api.request(`/activity/${id}/review`, { method: 'PUT', body: JSON.stringify({ userId, action }) }),
  checkin: (id, userId, attended) => Api.request(`/activity/${id}/checkin`, { method: 'PUT', body: JSON.stringify({ userId, attended }) }),

  /* V3.0：导出名单（需要带令牌，因此用 fetch + blob 而不是直接开链接） */
  async downloadJoinList(id, title) {
    let res;
    try { res = await fetch(`${API_BASE}/activity/${id}/export`, { headers: { Authorization: `Bearer ${this.token()}` } }); }
    catch { throw new Error('无法连接后端服务'); }
    if (!res.ok) throw new Error('导出失败（HTTP ' + res.status + '）');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '报名名单-' + String(title || id).replace(/[\\/:*?"<>|]/g, '_') + '.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  },

  /* ===== 平台管理（V2.0 新增） ===== */
  adminOverview: () => Api.request('/admin/overview'),
  adminUsers: params => Api.request(`/admin/users?${new URLSearchParams(params || {})}`),
  adminUserStatus: (id, status) => Api.request(`/admin/users/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  adminActivities: params => Api.request(`/admin/activities?${new URLSearchParams(params || {})}`),
  adminActivityStatus: (id, status) => Api.request(`/admin/activities/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),

  /* ===== V3.0 运行数据 ===== */
  adminMetrics: (days = 7) => Api.request(`/admin/metrics?days=${days}`),
  adminEvents: params => Api.request(`/admin/events?${new URLSearchParams(params || {})}`)
};
