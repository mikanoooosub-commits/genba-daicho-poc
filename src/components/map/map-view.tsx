"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { X, Crosshair } from "lucide-react";

import { useGeoTracking } from "@/lib/use-geo-tracking";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LocationPicker } from "@/components/map/location-picker";
import { NoteForm } from "@/components/map/note-form";
import type { PinHistoryItem } from "@/components/map/flyer-map";
import {
  createLocationAtAction,
  setLocationCoordsAction,
  createMapNoteAction,
  updateMapNoteAction,
  deleteMapNoteAction,
} from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import { noteColor, type Rating, type School, type VisitWithRelations, type MapNote } from "@/lib/types";
import type { LocationWithSchool } from "@/lib/data/queries";

const FlyerMap = dynamic(() => import("@/components/map/flyer-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      地図を読み込み中…
    </div>
  ),
});

const DEFAULT_CENTER: [number, number] = [35.6812, 139.7671]; // 東京駅

type Props = {
  schools: School[];
  locations: LocationWithSchool[];
  ratings: Record<string, Rating | null>;
  visits: VisitWithRelations[];
  notes: MapNote[];
};

export function MapView({ schools, locations, ratings, visits, notes }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const placeId = searchParams.get("place");

  const [newLoc, setNewLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [placeDraft, setPlaceDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [editingNote, setEditingNote] = useState<MapNote | null>(null);

  // 現在地トラッキング
  const track = useGeoTracking();
  const [panTarget, setPanTarget] = useState<{ lat: number; lng: number; seq: number } | null>(null);
  const panSeqRef = useRef(0);
  const centerPendingRef = useRef(false);

  const currentPos = useMemo(
    () => (track.position ? { lat: track.position.lat, lng: track.position.lng } : null),
    [track.position]
  );

  function handleTrackingToggle() {
    // トラッキング開始時、最初の測位で1度だけ現在地へ寄せる
    if (!track.tracking) centerPendingRef.current = true;
    track.toggle();
  }

  useEffect(() => {
    if (centerPendingRef.current && track.position) {
      panSeqRef.current += 1;
      setPanTarget({ lat: track.position.lat, lng: track.position.lng, seq: panSeqRef.current });
      centerPendingRef.current = false;
    }
  }, [track.position]);

  const placedLocations = useMemo(
    () => locations.filter((l) => l.lat != null && l.lng != null),
    [locations]
  );

  const history = useMemo(() => {
    const map: Record<string, PinHistoryItem[]> = {};
    for (const v of visits) {
      (map[v.location_id] ??= []).push({ date: v.date, count: v.count, rating: v.rating });
    }
    for (const id of Object.keys(map)) {
      map[id].sort((a, b) => (a.date < b.date ? 1 : -1));
    }
    return map;
  }, [visits]);

  const schoolPins = useMemo(
    () =>
      schools
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          lat: s.lat as number,
          lng: s.lng as number,
        })),
    [schools]
  );

  const center = useMemo<[number, number]>(() => {
    if (placedLocations.length === 0) return DEFAULT_CENTER;
    const lat =
      placedLocations.reduce((s, l) => s + (l.lat as number), 0) / placedLocations.length;
    const lng =
      placedLocations.reduce((s, l) => s + (l.lng as number), 0) / placedLocations.length;
    return [lat, lng];
  }, [placedLocations]);

  function handleMapClick(lat: number, lng: number) {
    if (placeId) setPlaceDraft({ lat, lng });
    else setNewLoc({ lat, lng });
  }

  return (
    <div className="flex flex-col">
      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 text-xs">
        <span className="font-bold text-muted-foreground">評価:</span>
        <LegendDot color="var(--rating-good)" label="良好" />
        <LegendDot color="var(--rating-normal)" label="普通" />
        <LegendDot color="var(--rating-bad)" label="非推奨" />
        <LegendDot color="#9ca3af" label="履歴なし" />
        <LegendDot color="#2563eb" label="小学校" />
      </div>

      {/* 現在地トラッキング */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2 text-sm">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={track.tracking}
            onChange={handleTrackingToggle}
          />
          現在地トラッキング
        </label>
        {track.error ? (
          <span className="text-xs text-destructive">{track.error}</span>
        ) : track.tracking ? (
          <span className="text-xs text-muted-foreground">
            {track.position
              ? `追従中（精度 ±${Math.round(track.position.accuracy)}m${
                  track.heading == null ? "・向きなし" : ""
                }）`
              : "取得中…"}
          </span>
        ) : null}
      </div>

      {/* 配置モードのバナー */}
      {placeId && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          <Crosshair className="size-4 shrink-0 text-primary" />
          <span className="flex-1">地図をタップして、この配布場所の位置を指定してください</span>
          <Button variant="ghost" size="sm" onClick={() => router.replace("/")}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      {/* 地図本体（isolate で Leaflet の高い z-index を閉じ込め、ダイアログを前面に保つ） */}
      <div className="relative z-0 h-[calc(100dvh-18rem)] w-full overflow-hidden [isolation:isolate]">
        <FlyerMap
          placedLocations={placedLocations}
          ratings={ratings}
          history={history}
          notes={notes}
          schoolPins={schoolPins}
          center={center}
          currentPosition={currentPos}
          heading={track.heading}
          panTarget={panTarget}
          onMapClick={handleMapClick}
          onPinClick={(id) => router.push(`/list?location=${id}`)}
          onNoteClick={(id) => {
            const n = notes.find((x) => x.id === id);
            if (n) setEditingNote(n);
          }}
        />
      </div>

      <p className="px-4 pt-2 text-center text-xs text-muted-foreground">
        {placeId
          ? "地図をタップして位置を指定してください。"
          : "ピンをクリックで一覧、カーソルで履歴。地図タップでその地点に配布場所・メモを登録できます。"}
      </p>

      {/* 新規配布場所の登録ダイアログ */}
      <NewLocationDialog
        schools={schools}
        coords={newLoc}
        onClose={() => setNewLoc(null)}
        onCreated={() => {
          setNewLoc(null);
          router.refresh();
        }}
      />

      {/* 配置モード: 位置を調整して決定 */}
      <PlaceConfirmDialog
        coords={placeDraft}
        onClose={() => setPlaceDraft(null)}
        onConfirm={(lat, lng) => {
          if (!placeId) return;
          setPlaceDraft(null);
          setLocationCoordsAction(placeId, lat, lng).then(() => {
            router.replace("/");
            router.refresh();
          });
        }}
      />

      {/* マップメモ 編集・削除 */}
      <Dialog open={editingNote !== null} onOpenChange={(o) => !o && setEditingNote(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <span
                className="inline-block size-3.5 rounded-full"
                style={{ background: editingNote ? noteColor(editingNote.color) : undefined }}
              />
              マップメモを編集
            </DialogTitle>
          </DialogHeader>
          {editingNote && (
            <NoteForm
              initial={{
                color: editingNote.color,
                label: editingNote.label ?? "",
                memo: editingNote.memo ?? "",
                lat: editingNote.lat,
                lng: editingNote.lng,
              }}
              submitLabel="保存する"
              onSubmit={(v) =>
                updateMapNoteAction(editingNote.id, v.color, v.label, v.memo, v.lat, v.lng)
              }
              onDelete={() => deleteMapNoteAction(editingNote.id)}
              onSuccess={() => {
                setEditingNote(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block size-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function PlaceConfirmDialog({
  coords,
  onClose,
  onConfirm,
}: {
  coords: { lat: number; lng: number } | null;
  onClose: () => void;
  onConfirm: (lat: number, lng: number) => void;
}) {
  return (
    <Dialog open={coords !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>この位置で決定しますか？</DialogTitle>
        </DialogHeader>
        {coords && <PlaceConfirmBody initial={coords} onConfirm={onConfirm} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function PlaceConfirmBody({
  initial,
  onConfirm,
  onClose,
}: {
  initial: { lat: number; lng: number };
  onConfirm: (lat: number, lng: number) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState(initial);
  return (
    <>
      <LocationPicker value={pos} center={initial} onChange={(lat, lng) => setPos({ lat, lng })} />
      <p className="text-xs text-muted-foreground">
        緯度 {pos.lat.toFixed(5)} / 経度 {pos.lng.toFixed(5)}（現在地・タップ・ドラッグで微調整）
      </p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose}>
          キャンセル
        </Button>
        <Button className="flex-1" onClick={() => onConfirm(pos.lat, pos.lng)}>
          この位置で決定
        </Button>
      </div>
    </>
  );
}

function NewLocationDialog({
  schools,
  coords,
  onClose,
  onCreated,
}: {
  schools: School[];
  coords: { lat: number; lng: number } | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"location" | "note">("location");

  function handleOpenChange(open: boolean) {
    if (!open) {
      onClose();
      setMode("location");
    }
  }

  return (
    <Dialog open={coords !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>この地点に登録</DialogTitle>
        </DialogHeader>

        {/* 種別トグル（登録ボタンのダイアログと同じ構成） */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode("location")}
            className={cn(
              "flex-1 rounded-lg border-2 py-1.5 text-sm font-bold transition-colors",
              mode === "location"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground"
            )}
          >
            配布場所
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className={cn(
              "flex-1 rounded-lg border-2 py-1.5 text-sm font-bold transition-colors",
              mode === "note"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground"
            )}
          >
            マップメモ
          </button>
        </div>

        {coords &&
          (mode === "location" ? (
            <NewLocationBody schools={schools} initial={coords} onCreated={onCreated} />
          ) : (
            <NoteForm
              initial={{ lat: coords.lat, lng: coords.lng }}
              submitLabel="メモを登録"
              onSubmit={(v) => createMapNoteAction(v.lat, v.lng, v.color, v.label, v.memo)}
              onSuccess={onCreated}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function NewLocationBody({
  schools,
  initial,
  onCreated,
}: {
  schools: School[];
  initial: { lat: number; lng: number };
  onCreated: () => void;
}) {
  const [schoolId, setSchoolId] = useState("");
  const [spot, setSpot] = useState("");
  const [pos, setPos] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError("");
    if (!schoolId) {
      setError("小学校を選択してください");
      return;
    }
    startTransition(async () => {
      const result = await createLocationAtAction(schoolId, spot, pos.lat, pos.lng);
      if (result.ok) onCreated();
      else setError(result.error);
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nl-school">対象小学校</Label>
        <Select value={schoolId} onValueChange={setSchoolId}>
          <SelectTrigger id="nl-school">
            <SelectValue placeholder="小学校を選択" />
          </SelectTrigger>
          <SelectContent>
            {schools.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                「小学校」タブで先に登録してください
              </div>
            ) : (
              schools.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nl-spot">立ち位置</Label>
        <Input
          id="nl-spot"
          placeholder="例: 正門西側"
          value={spot}
          onChange={(e) => setSpot(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>位置（現在地・検索・タップ・ドラッグで調整）</Label>
        <LocationPicker value={pos} center={initial} onChange={(lat, lng) => setPos({ lat, lng })} />
        <p className="text-xs text-muted-foreground">
          緯度 {pos.lat.toFixed(5)} / 経度 {pos.lng.toFixed(5)}
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleCreate} disabled={pending}>
        {pending ? "登録中…" : "この位置で配布場所を登録"}
      </Button>
    </>
  );
}
