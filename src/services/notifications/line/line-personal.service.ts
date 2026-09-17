import {
  notifyNeedsRevision,
  notifyClipApproved,
  notifyTaskAssigned,
  notifyTasksAssigned,
  notifySubmissionPending,
  notifyLoginSuccess,
} from "./flex-templates";

export const LinePersonalService = {
  async sendNeedsRevision(payload: any) {
    if (!payload.toLineUserId) return;
    return notifyNeedsRevision(payload);
  },

  async sendApproved(payload: any) {
    if (!payload.toLineUserId) return;
    return notifyClipApproved(payload);
  },

  async sendTaskAssigned(payload: any) {
    if (!payload.toLineUserId) return;
    return notifyTaskAssigned(payload);
  },

  async sendTasksAssigned(payload: any) {
    if (!payload.toLineUserId) return;
    return notifyTasksAssigned({
      ...payload,
      toLineUserId: payload.toLineUserId,
    });
  },
  
  async sendLoginSuccess(payload: any) {
    if (!payload.toLineUserId) return;
    return notifyLoginSuccess(payload);
  },

  async sendSubmissionPending(payload: any) {
    // This is the editor's copy of pending review
    if (!payload.toLineUserId) return;
    return notifySubmissionPending(payload);
  }
};
