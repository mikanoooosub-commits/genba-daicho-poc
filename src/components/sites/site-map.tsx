"use client";

import { MapContainer, TileLayer, Marker, Tooltip, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { SITE_STATUS_META, type SiteStatusValue } from "@/lib/types";
import { formatDate } from "@/lib/format";

/** まとめピンの吹き出しに並べる部屋の上限。超えた分は「ほか N 室」(PM決定 D71) */
export const MAX_LISTED_ROOMS = 5;

/** ピンの中の1現場(1室) */
export type SiteMapMember = {
  id: string;
  roomNo: string | null;
  clientName: string;
  status: SiteStatusValue;
  latestJobDate: string | null;
  latestWorkType: string | null;
  /** 前回施工の内容の先頭(20字程度) */
  latestContentHead: string | null;
};

/** 地図の1本のピン。同じ建物・近い位置の現場は1本にまとまる(members が2件以上) */
export type SiteMapPin = {
  /** ピンの識別子(最初のメンバーの現場ID) */
  key: string;
  buildingName: string;
  lat: number;
  lng: number;
  /** ピンの色に使う状態。メンバーのうちいちばん要対応のもの */
  status: SiteStatusValue;
  /** 部屋番号順に並べたメンバー(1件以上) */
  members: SiteMapMember[];
  /** 検索に一致した現場を含む(ピンを大きく・枠付きで強調) */
  highlighted: boolean;
};

function makeSitePinIcon(status: SiteStatusValue, highlighted: boolean, count: number) {
  const color = SITE_STATUS_META[status].color;
  const stroke = highlighted ? "#111827" : "white";
  const strokeWidth = highlighted ? 3.5 : 2;
  const scale = highlighted ? 1.3 : 1;
  // 透明な余白（padding）で当たり判定を広げ、カーソルを合わせやすくする（flyer-map.tsx と同じ手法）
  // 部屋数(2以上のとき)をピンの右上に小さく出す
  const badge =
    count >= 2
      ? `<span style="position:absolute;top:2px;right:4px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:#111827;color:white;font-size:11px;font-weight:700;line-height:18px;text-align:center;">${count}</span>`
      : "";
  const html = `<div style="position:relative;width:50px;height:52px;padding:8px;box-sizing:border-box;display:flex;justify-content:center;">
    ${badge}
    <svg width="${34 * scale}" height="${44 * scale}" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10 15 25 15 25s15-15 15-25C30 6.7 23.3 0 15 0z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
      <circle cx="15" cy="15" r="5.5" fill="white"/>
    </svg>
  </div>`;
  return L.divIcon({ html, className: "site-pin", iconSize: [50, 52], iconAnchor: [25, 52] });
}

function ClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

type Props = {
  pins: SiteMapPin[];
  center: [number, number];
  onMapClick: (lat: number, lng: number) => void;
  onPinClick: (siteId: string) => void;
  /** 「ほか N 室」から、建物名で検索した状態へ進む */
  onMoreRooms: (buildingName: string) => void;
};

export default function SiteMap({ pins, center, onMapClick, onPinClick, onMoreRooms }: Props) {
  return (
    <MapContainer center={center} zoom={14} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onMapClick={onMapClick} />
      {pins.map((p) => (
        <Marker
          key={p.key}
          position={[p.lat, p.lng]}
          icon={makeSitePinIcon(p.status, p.highlighted, p.members.length)}
          zIndexOffset={p.highlighted ? 1000 : 0}
        >
          <Tooltip direction="top" offset={[0, -46]} className="flyer-label">
            {p.members.length >= 2 ? `${p.buildingName}(${p.members.length}室)` : p.buildingName}
          </Tooltip>
          <Popup autoPan>
            {p.members.length >= 2 ? (
              <BuildingPopup pin={p} onPinClick={onPinClick} onMoreRooms={onMoreRooms} />
            ) : (
              <SinglePopup pin={p} onPinClick={onPinClick} />
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

/** 1室だけの現場の吹き出し(まとめピンになる前から変わらない表示) */
function SinglePopup({ pin, onPinClick }: { pin: SiteMapPin; onPinClick: (siteId: string) => void }) {
  const m = pin.members[0];
  return (
    <div className="text-sm">
      <p className="font-bold">
        {pin.buildingName}
        {m.roomNo ? ` ${m.roomNo}` : ""}
      </p>
      <p>{m.clientName}</p>
      <p>{SITE_STATUS_META[m.status].label}</p>
      {m.latestJobDate && (
        <p>
          前回施工: {formatDate(m.latestJobDate)}
          {m.latestWorkType ? ` ${m.latestWorkType}` : ""}
        </p>
      )}
      {m.latestContentHead && <p className="text-muted-foreground">{m.latestContentHead}</p>}
      {/* ピンのタップは吹き出しを開くだけ。前回施工を読んでから、ここで詳細へ進む */}
      <button
        type="button"
        className="mt-2 font-bold text-primary underline"
        onClick={() => onPinClick(m.id)}
      >
        詳細へ
      </button>
    </div>
  );
}

/** まとめピン(同じ建物の複数室)の吹き出し: 建物名+部屋の一覧 */
function BuildingPopup({
  pin,
  onPinClick,
  onMoreRooms,
}: {
  pin: SiteMapPin;
  onPinClick: (siteId: string) => void;
  onMoreRooms: (buildingName: string) => void;
}) {
  const listed = pin.members.slice(0, MAX_LISTED_ROOMS);
  const restCount = pin.members.length - listed.length;
  return (
    <div className="text-sm">
      <p className="font-bold">
        {pin.buildingName}({pin.members.length}室)
      </p>
      <ul className="mt-1 space-y-2">
        {listed.map((m) => (
          <li key={m.id}>
            <p>
              <span className="font-bold">{m.roomNo ? `${m.roomNo}号室` : "部屋番号なし"}</span>
              <span
                className="mx-1.5 inline-block size-2.5 rounded-full align-baseline"
                style={{ backgroundColor: SITE_STATUS_META[m.status].color }}
                aria-hidden="true"
              />
              {SITE_STATUS_META[m.status].label}
            </p>
            {m.latestJobDate && (
              <p>
                前回施工: {formatDate(m.latestJobDate)}
                {m.latestWorkType ? ` ${m.latestWorkType}` : ""}
              </p>
            )}
            <button
              type="button"
              className="font-bold text-primary underline"
              onClick={() => onPinClick(m.id)}
            >
              詳細へ
            </button>
          </li>
        ))}
      </ul>
      {restCount > 0 && (
        <button
          type="button"
          className="mt-2 font-bold text-primary underline"
          onClick={() => onMoreRooms(pin.buildingName)}
        >
          ほか {restCount} 室
        </button>
      )}
    </div>
  );
}
