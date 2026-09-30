"use client";

import { MapContainer, TileLayer, Marker, Tooltip, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { SITE_STATUS_META, type SiteStatusValue } from "@/lib/types";
import { formatDate } from "@/lib/format";

export type SiteMapPin = {
  id: string;
  buildingName: string;
  roomNo: string | null;
  clientName: string;
  lat: number;
  lng: number;
  status: SiteStatusValue;
  latestJobDate: string | null;
  latestWorkType: string | null;
  /** 前回施工の内容の先頭(20字程度) */
  latestContentHead: string | null;
  /** 検索に一致した現場(ピンを大きく・枠付きで強調) */
  highlighted: boolean;
};

function makeSitePinIcon(status: SiteStatusValue, highlighted: boolean) {
  const color = SITE_STATUS_META[status].color;
  const stroke = highlighted ? "#111827" : "white";
  const strokeWidth = highlighted ? 3.5 : 2;
  const scale = highlighted ? 1.3 : 1;
  // 透明な余白（padding）で当たり判定を広げ、カーソルを合わせやすくする（flyer-map.tsx と同じ手法）
  const html = `<div style="width:50px;height:52px;padding:8px;box-sizing:border-box;display:flex;justify-content:center;">
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
};

export default function SiteMap({ pins, center, onMapClick, onPinClick }: Props) {
  return (
    <MapContainer center={center} zoom={14} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onMapClick={onMapClick} />
      {pins.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={makeSitePinIcon(p.status, p.highlighted)}
          zIndexOffset={p.highlighted ? 1000 : 0}
        >
          <Tooltip direction="top" offset={[0, -46]} className="flyer-label">
            {p.buildingName}
          </Tooltip>
          <Popup autoPan>
            <div className="text-sm">
              <p className="font-bold">
                {p.buildingName}
                {p.roomNo ? ` ${p.roomNo}` : ""}
              </p>
              <p>{p.clientName}</p>
              <p>{SITE_STATUS_META[p.status].label}</p>
              {p.latestJobDate && (
                <p>
                  前回施工: {formatDate(p.latestJobDate)}
                  {p.latestWorkType ? ` ${p.latestWorkType}` : ""}
                </p>
              )}
              {p.latestContentHead && <p className="text-muted-foreground">{p.latestContentHead}</p>}
              {/* ピンのタップは吹き出しを開くだけ。前回施工を読んでから、ここで詳細へ進む */}
              <button
                type="button"
                className="mt-2 font-bold text-primary underline"
                onClick={() => onPinClick(p.id)}
              >
                詳細へ
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
