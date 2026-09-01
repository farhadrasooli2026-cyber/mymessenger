export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installProcessGuards } = await import("@/lib/lifecycle");
    installProcessGuards();
  }
}
