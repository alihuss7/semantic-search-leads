export function resolveLeadName(
  rawData: Record<string, string>,
  id?: number,
): string {
  const firstName = (rawData["First Name"] || "").trim();
  const lastName = (rawData["Last Name"] || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || rawData["Project"] || rawData["Lead ID"] || `Lead #${id ?? "?"}`;
}
