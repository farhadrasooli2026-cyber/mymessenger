export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installProcessGuards } = await import("@/lib/lifecycle");
    installProcessGuards();
    const { currentDeployEnv } = await import("@/lib/env-config");
    const { persistMode, databaseUrl } = await import("@/lib/persist");
    const { otpProvidersReady } = await import("@/lib/otp-env");
    const { deployedGitSha } = await import("@/lib/release");
    const otp = otpProvidersReady();
    console.info(
      JSON.stringify({
        service: "boot",
        level: "info",
        msg: "nixo_runtime",
        env: currentDeployEnv(),
        gitSha: deployedGitSha(),
        persist: { driver: persistMode(), databaseUrlSet: Boolean(databaseUrl()) },
        otp: {
          email: otp.email,
          sms: otp.sms,
          emailSandbox: otp.emailSandbox,
          missingEmail: otp.missingEmail,
          missingSms: otp.missingSms,
        },
      }),
    );
  }
}
