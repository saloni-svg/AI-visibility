// Formatting that gives the same text on the server and in every browser
// (built-in locale formatting differs: Node writes "Sep", Safari "Sept"),
// so pages don't show hydration warnings.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 18 Sep 2024 */
export function fmtDay(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 18 Sep, 5:30 pm */
export function fmtDayTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "2024-09" -> Sep 2024 */
export function fmtMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : ym;
}

/** Indian digit grouping: 14,800 · 1,23,456 */
export function fmtNum(n: number) {
  const neg = n < 0;
  const [int, dec] = String(Math.abs(n)).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${rest ? `${rest},` : ""}${last3}${dec ? `.${dec}` : ""}`;
}
