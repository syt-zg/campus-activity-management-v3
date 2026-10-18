/* 教师端业务封装：本人活动的维护、名单查看与报名审核（V2.0 新增审核） */
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
    }
};

function toApiData(data) {
    return {
        title: data.title, type: data.type, content: data.description,
        notice: data.notice, place: data.location, start_time: data.startTime,
        end_time: data.endTime, max_num: data.maxParticipants,
        require_review: data.requireReview === true, eligibility: data.eligibility || ''
    };
}
