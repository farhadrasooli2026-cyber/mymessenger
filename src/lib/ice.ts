import "server-only";
import { config } from "@/lib/config";

export type IceServerPublic = {
  urls: string;
  username?: string;
  credential?: string;
};

export function iceServersForSession() {
  const iceServers: IceServerPublic[] = [{ urls: config.stunUrl }];
  const turnReady = Boolean(config.turnUrl && config.turnUser && config.turnCredential);
  if (turnReady) {
    iceServers.push({
      urls: config.turnUrl,
      username: config.turnUser,
      credential: config.turnCredential,
    });
  }
  return {
    iceServers,
    relay: turnReady,
    note: turnReady
      ? "STUN و TURN از تنظیم سرور؛ TURN فقط برای نشست احرازشده."
      : "STUN عمومی. برای NAT سخت، NIXO_TURN_URL و اعتبار TURN را روی سرور بگذار.",
  };
}
