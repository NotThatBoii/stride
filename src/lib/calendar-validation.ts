// Date.parse normalizes some impossible dates (for example February 31).
// Check the written calendar day before preserving the legacy parser's
// timezone/offset-less timestamp interpretation.
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function isStudyTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const day = /^(\d{4}-\d{2}-\d{2})T/.exec(value)?.[1];
  return !!day && isCalendarDate(day) && Number.isFinite(Date.parse(value));
}
