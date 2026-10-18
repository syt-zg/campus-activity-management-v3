/* 教师端业务封装：本人活动的维护、名单查看、报名审核与出席记录（V3.0 新增出席与导出） */
const Teacher = {
    async getMyActivities() { return Api.myActivities(); },
    async getSignupList(activityId) { return Api.joinList(activityId); },
    async reviewRegistration(activityId, userId, action) {
        try { return { success: true, data: await Api.review(activityId, userId, action) }; }
        catch (error) { return { success: false, message: error.message || '审核失败' }; }
    },
    async createActivity(data) {
        try { await Api.create(toApiData(data)); return { success: true }; }
        catch (error) { return { success: false, message: error.message || '发布失败' }; }
    },
    async updateActivity(activityId, data) {
        try { await Api.update(activityId, toApiData(data)); return { success: true }; }
        catch (error) { return { success: false, message: error.message || '修改失败' }; }
    },
    async deleteActivity(activityId) {
        try { await Api.remove(activityId); return { success: true }; }
        catch (error) { return { success: false, message: error.message || '删除失败' }; }
    },
    /* V3.0：出席标记与名单导出 */
    async setCheckin(activityId, userId, attended) {
        try { return { success: true, data: await Api.checkin(activityId, userId, attended) }; }
        catch (error) { return { success: false, message: error.message || '记录出席失败' }; }
    },
    async exportSignupList(activityId, title) {
        try { await Api.downloadJoinList(activityId, title); return { success: true }; }
        catch (error) { return { success: false, message: error.message || '导出失败' }; }
    }
};

function toApiData(data) {
    return {
        title: data.title, type: data.type, content: data.description,
        notice: data.notice, place: data.location, start_time: data.startTime,
        end_time: data.endTime, max_num: data.maxParticipants,
        require_review: data.requireReview === true, eligibility: data.eligibility || '',
        eligibility_rule: data.eligibilityRule || ''
    };
}
