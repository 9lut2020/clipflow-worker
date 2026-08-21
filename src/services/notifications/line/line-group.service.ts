import {
  notifyAdminGroupNewSubmission,
} from "./flex-templates";

export const LineGroupService = {
  async sendPendingReview(payload: any) {
    if (!payload.channelAccessToken) {
        console.warn("[LINE GROUP] Missing channel access token");
    }
    return notifyAdminGroupNewSubmission(payload);
  }
};
