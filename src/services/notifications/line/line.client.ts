/**
 * Service for sending LINE Push Notifications via LINE Messaging API
 */

export async function sendLinePushMessage({
  toLineUserId,
  text,
  channelAccessToken,
}: {
  toLineUserId: string;
  text: string;
  channelAccessToken?: string;
}): Promise<{ success: boolean; message: string }> {
  if (!toLineUserId) {
    return { success: false, message: "Missing toLineUserId" };
  }

  const token = channelAccessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    console.log(`[LINE PUSH SIMULATION] To: ${toLineUserId}\n${text}`);
    return {
      success: true,
      message: `[LINE PUSH SIMULATION] Sent to ${toLineUserId}`,
    };
  }

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: toLineUserId,
        messages: [{ type: "text", text }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[LINE PUSH API ERROR]", res.status, errBody);
      return { success: false, message: `LINE API error: ${res.statusText}` };
    }

    return { success: true, message: "LINE notification sent successfully" };
  } catch (err: any) {
    console.error("[LINE PUSH EXCEPTION]", err);
    return { success: false, message: err?.message || "LINE Push failed" };
  }
}

/**
 * Send LINE Flex Card Push Message with fallback text
 */
export async function sendLinePushFlexMessage({
  toLineUserId,
  altText,
  flexContents,
  fallbackText,
  channelAccessToken,
}: {
  toLineUserId: string;
  altText: string;
  flexContents: any;
  fallbackText?: string;
  channelAccessToken?: string;
}): Promise<{ success: boolean; message: string }> {
  if (!toLineUserId) {
    return { success: false, message: "Missing toLineUserId" };
  }

  const token = channelAccessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    console.log(
      `[LINE FLEX SIMULATION] To: ${toLineUserId}\nAltText: ${altText}`,
    );
    return {
      success: true,
      message: `[LINE FLEX SIMULATION] Sent to ${toLineUserId}`,
    };
  }

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: toLineUserId,
        messages: [
          {
            type: "flex",
            altText,
            contents: flexContents,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[LINE FLEX API ERROR]", res.status, errBody);
      if (fallbackText) {
        return sendLinePushMessage({
          toLineUserId,
          text: fallbackText,
          channelAccessToken: token,
        });
      }
      return { success: false, message: `LINE Flex error: ${res.statusText}` };
    }

    return {
      success: true,
      message: "LINE Flex notification sent successfully",
    };
  } catch (err: any) {
    console.error("[LINE FLEX EXCEPTION]", err);
    if (fallbackText) {
      return sendLinePushMessage({
        toLineUserId,
        text: fallbackText,
        channelAccessToken: token,
      });
    }
    return { success: false, message: err?.message || "LINE Flex Push failed" };
  }
}

/**
 * Link a specific Rich Menu to a LINE User
 */
export async function linkUserRichMenu(
  lineUserId: string,
  richMenuId: string,
  channelAccessToken?: string
): Promise<{ success: boolean; message: string }> {
  if (!lineUserId || !richMenuId) {
    return { success: false, message: "Missing lineUserId or richMenuId" };
  }

  const token = channelAccessToken || process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.log(`[LINE RICHMENU SIMULATION] Link User: ${lineUserId} -> Menu: ${richMenuId}`);
    return {
      success: true,
      message: `[LINE RICHMENU SIMULATION] Linked ${richMenuId} to ${lineUserId}`,
    };
  }

  try {
    const res = await fetch(`https://api.line.me/v2/bot/user/${lineUserId}/richmenu/${richMenuId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[LINE RICHMENU API ERROR]", res.status, errBody);
      return { success: false, message: `LINE Richmenu API error: ${res.statusText}` };
    }

    return { success: true, message: "Richmenu linked successfully" };
  } catch (err: any) {
    console.error("[LINE RICHMENU EXCEPTION]", err);
    return { success: false, message: err?.message || "LINE Richmenu Link failed" };
  }
}

