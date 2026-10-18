/* 学生端业务封装：只处理本人报名相关操作（V2.0 增加候补与状态） */
const Student = {
    async getActivities(params = {}) { return (await Api.list(params)).list; },
    async getMySignups() { return Api.myJoin(); },
    async hasSignedUp(activityId) {
        const list = await this.getMySignups();
        return list.some(activity => String(activity.id) === String(activityId));
    },
    async signup(activityId) {
        try { return { success: true, data: await Api.join(activityId) }; }
        catch (error) { return { success: false, message: error.message || '报名失败' }; }
    },
    async cancelSignup(activityId) {
        try { return { success: true, data: await Api.cancel(activityId) }; }
        catch (error) { return { success: false, message: error.message || '取消报名失败' }; }
    }
};
