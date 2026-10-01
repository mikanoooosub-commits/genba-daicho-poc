import type { SiteStatusValue } from "@/lib/types";

/** 同じ建物とみなす距離(m)。PM決定 D71: 目安 30m 以内 */
export const SAME_BUILDING_METERS = 30;

type Placed = { buildingName: string; lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;

/** 2点間の距離(m)。ハーヴァーサイン式（30m 程度の近さの判定には十分な精度） */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * 「建物名が完全一致(前後の空白は無視)、かつ座標が近い」現場を1組にまとめる。
 * - 建物名が空の現場は、他とまとめず単独の組にする(無関係な現場が並ぶのを防ぐ)。
 * - 表記ゆれ(全角/半角等)は同じ建物として拾わない(CHANGE-A-019 と同じ方針)。
 * - 比べる相手は組の最初の1件(基準)。拡大率に応じたまとめ直しはしない。
 * 入力の並びは保ち、組は「最初のメンバーの出現順」で返す。
 */
export function groupByBuilding<T extends Placed>(
  items: T[],
  meters: number = SAME_BUILDING_METERS
): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const name = item.buildingName.trim();
    const target =
      name === ""
        ? undefined
        : groups.find(
            (g) => g[0].buildingName.trim() === name && distanceMeters(g[0], item) <= meters
          );
    if (target) target.push(item);
    else groups.push([item]);
  }
  return groups;
}

/** まとめピンの色に使う優先順位。いちばん要対応の状態を借りる(D65 の判定は現場ごとのまま) */
const STATUS_PRIORITY: SiteStatusValue[] = ["請求済_未入金", "未請求", "入金済"];

export function mostUrgentStatus(statuses: SiteStatusValue[]): SiteStatusValue {
  for (const s of STATUS_PRIORITY) {
    if (statuses.includes(s)) return s;
  }
  return "未請求";
}

/** 部屋番号の並び(数字は数の大きさで比べる)。部屋番号が無い現場は末尾 */
export function compareRoomNo(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, "ja", { numeric: true });
}
