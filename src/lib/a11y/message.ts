/** Accessible names for chat messages. Never translates user content. */

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\u200d|\ufe0f|\s)+$/u;

export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  try {
    return EMOJI_ONLY.test(t) && /\p{Extended_Pictographic}/u.test(t);
  } catch {
    return false;
  }
}

export function describeEmojiOnly(text: string): string {
  const count = Array.from(text.replace(/\s/g, "")).length;
  return count <= 1 ? "پیام ایموجی" : `پیام با ${count} ایموجی`;
}

export type MessageA11yInput = {
  sender: "me" | "peer" | string;
  senderName?: string;
  text: string;
  kind?: string;
  createdAt: number;
  state?: string | null;
  editedAt?: number | null;
  replyToId?: string | null;
  replyPreview?: string | null;
  expired?: boolean;
  attachmentName?: string | null;
  attachmentType?: string | null;
};

export function messageAccessibleName(msg: MessageA11yInput, now = Date.now()): string {
  const who = msg.sender === "me" ? "شما" : msg.senderName || "مخاطب";
  const time = new Date(msg.createdAt).toLocaleString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  const parts = [`پیام از ${who}`, time];
  if (msg.kind && msg.kind !== "text" && msg.kind !== "system") parts.push(`نوع ${msg.kind}`);
  if (msg.attachmentName) parts.push(`پیوست ${msg.attachmentName}${msg.attachmentType ? ` ${msg.attachmentType}` : ""}`);
  if (msg.expired) parts.push("منقضی شده");
  else if (isEmojiOnly(msg.text)) parts.push(describeEmojiOnly(msg.text));
  else if (msg.text) parts.push(msg.text.slice(0, 160));
  if (msg.replyToId) parts.push(msg.replyPreview ? `پاسخ به ${msg.replyPreview.slice(0, 40)}` : "پاسخ به پیام");
  if (msg.editedAt) parts.push("ویرایش‌شده");
  if (msg.state === "read") parts.push("خوانده شد");
  else if (msg.state === "delivered") parts.push("تحویل شد");
  else if (msg.state === "deleted") parts.push("حذف شد");
  else if (msg.sender === "me" && msg.state) parts.push("ارسال شد");
  void now;
  return parts.join("، ");
}

export function statusLabel(state: string | null | undefined): string {
  if (state === "read") return "خوانده شد";
  if (state === "delivered") return "تحویل شد";
  if (state === "deleted") return "حذف شد";
  if (state === "failed") return "ارسال نشد";
  return "ارسال شد";
}
