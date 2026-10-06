/** "09:30:00" → "09:30"、null → "" */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  return t.slice(0, 5);
}

/** 開始〜終了時刻を "09:30〜10:15" の形に。両方無ければ "" */
export function formatTimeRange(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  const s = formatTime(start);
  const e = formatTime(end);
  if (s && e) return `${s}〜${e}`;
  if (s) return `${s}〜`;
  if (e) return `〜${e}`;
  return "";
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-07-03" → "2026/7/3(金)" */
export function formatDate(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const wd = WEEKDAYS[new Date(y, m - 1, day).getDay()];
  return `${y}/${m}/${day}(${wd})`;
}

/** ISO 日時 → "2026/7/3 12:34" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

/** "2026-03-11" → "2026/03/11"（ゼロ埋め・曜日なし。報告コピー用） */
export function formatDatePadded(d: string | null | undefined): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${y}/${m}/${day}`;
}

/** 今日の日付を YYYY-MM-DD で返す（ローカルタイム） */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 金額を "¥12,345" の形に（台帳・請求・入金の表示用） */
export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

/** "2026-07" → "2026年7月"（月次集計の見出し用） */
export function formatYearMonth(ym: string | null | undefined): string {
  if (!ym) return "(月未設定)";
  const [y, m] = ym.slice(0, 7).split("-").map(Number);
  if (!y || !m) return ym;
  return `${y}年${m}月`;
}

/** 符号つきの金額。マイナスは "−¥460"(値引きの表示用) */
export function formatSignedYen(amount: number): string {
  const v = Math.round(amount);
  return v < 0 ? `−¥${Math.abs(v).toLocaleString("ja-JP")}` : `¥${v.toLocaleString("ja-JP")}`;
}
