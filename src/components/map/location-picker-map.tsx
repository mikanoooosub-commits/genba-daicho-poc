"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const pickIcon = L.divIcon({
  html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10 15 25 15 25s15-15 15-25C30 6.7 23.3 0 15 0z" fill="var(--primary)" stroke="white" stroke-width="2"/>
    <circle cx="15" cy="15" r="5.5" fill="white"/>
  </svg>`,
  className: "flyer-pin",
  iconSize: [30, 40],
  iconAnchor: [15, 40],
});

function ClickToSet({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** center（小学校など）が変わったら地図を移動する。マーカー移動では追従しない。 */
function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1]]);
  return null;
}

type Props = {
  value: [number, number] | null;
  center: [number, number];
  zoom?: number;
  onChange: (lat: number, lng: number) => void;
};

export default function LocationPickerMap({ value, center, zoom = 16, onChange }: Props) {
  return (
    <MapContainer center={value ?? center} zoom={zoom} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToSet onChange={onChange} />
      <Recenter center={center} />
      {value && (
        <Marker
          position={value}
          draggable
          icon={pickIcon}
          eventHandlers={{
            dragend(e) {
              const m = (e.target as L.Marker).getLatLng();
              onChange(m.lat, m.lng);
            },
          }}
        />
      )}
    </MapContainer>
  );
}
