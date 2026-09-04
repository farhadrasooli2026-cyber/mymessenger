export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installProcessGuards } = await import("@/lib/lifecycle");
    installProcessGuards();
    const { currentDeployEnv } = await import("@/lib/env-config");
    const { persistMode, databaseUrl, migratePostgres } = await import("@/lib/persist");
    const { otpProvidersReady } = await import("@/lib/otp-env");
    const { deployedGitSha } = await import("@/lib/release");
    const otp = otpProvidersReady();
    const migrate = await migratePostgres();
    console.info(
      JSON.stringify({
        service: "boot",
        level: "info",
        msg: "nixo_runtime",
        env: currentDeployEnv(),
        gitSha: deployedGitSha(),
        persist: {
          driver: persistMode(),
          databaseUrlSet: Boolean(databaseUrl()),
          dataDir: (await import("@/lib/data-dir")).dataDir(),
          envPresent: {
            DATABASE_URL: Boolean(process.env.DATABASE_URL),
            NIXO_DATABASE_URL: Boolean(process.env.NIXO_DATABASE_URL),
            POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
          },
          migrate,
        },
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
