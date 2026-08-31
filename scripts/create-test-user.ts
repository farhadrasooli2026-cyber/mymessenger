import { issueHumanChallenge, ackHumanChallenge, startRegistration, verifyOtp } from "../src/lib/registration";
import { completeProfile } from "../src/lib/profile";
import { getOutbox } from "../src/lib/outbox";
import { hashIp } from "../src/lib/crypto-utils";

async function main() {
  const ip = hashIp("test-automation-ip-001");

  console.log("Issuing human challenge...");
  const issued = await issueHumanChallenge(ip);
  const ack = await ackHumanChallenge(issued.token, ip);
  if (!ack.ok) {
    console.error("Failed to ack");
    process.exit(1);
  }

  console.log("Starting registration...");
  const start = await startRegistration(
    { channel: "email", identifier: "testuser@nixo.test", humanToken: issued.token, website: "" },
    ip,
  );
  if (!start.ok) {
    console.error("Failed to start:", "error" in start ? start.error : "unknown");
    process.exit(1);
  }

  const outboxMessage = getOutbox(start.challengeId);
  const code = outboxMessage?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  console.log("Verification code:", code);

  console.log("Verifying OTP...");
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) {
    console.error("Failed to verify");
    process.exit(1);
  }

  console.log("Completing profile...");
  const done = await completeProfile(verified.userId, {
    firstName: "Test",
    lastName: "User",
    username: "testuser",
    bio: "Test user for NIXO appearance verification",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });

  if (!done.ok) {
    console.error("Failed to complete profile");
    process.exit(1);
  }

  console.log("User created successfully! User ID:", verified.userId);
}

main();
