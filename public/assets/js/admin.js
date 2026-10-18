/* 系统管理员端业务封装（V2.0 新增角色，V3.0 增加运行数据查询）
 * 职责边界来自访谈证据：管理员只维护平台账号状态与活动秩序，
 * 不介入具体活动的人数、资格、候补与审核业务；
 * V3.0 增加"看数据"能力（运行统计与事件日志），但仍不介入业务决策。 */
const Admin = {
    async getOverview() { return Api.adminOverview(); },
    async getUsers(keyword = '') { return Api.adminUsers(keyword ? { keyword } : {}); },
    async setUserStatus(userId, status) {
        try { await Api.adminUserStatus(userId, status); return { success: true }; }
        catch (error) { return { success: false, message: error.message || '账号状态修改失败' }; }
    },
    async getActivities(keyword = '') { return Api.adminActivities(keyword ? { keyword } : {}); },
    async setActivityStatus(activityId, status) {
        try { await Api.adminActivityStatus(activityId, status); return { success: true }; }
        catch (error) { return { success: false, message: error.message || '活动状态修改失败' }; }
    },
    /* V3.0 */
    async getMetrics(days = 7) { return Api.adminMetrics(days); },
    async getEvents(params = {}) { return Api.adminEvents(params); }
};
