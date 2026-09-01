export function isNixoOps(username: string | null | undefined): boolean {
  const h = (username ?? "").replace(/^@/, "").toLowerCase();
  return h === "nixo" || h === "nixo_ops";
}
