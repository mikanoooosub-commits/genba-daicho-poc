"use client";

import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LocationPicker } from "@/components/map/location-picker";
import { createSiteAction } from "@/lib/data/actions-sites";
import {
  LEAD_SOURCE_LABEL,
  LEAD_SOURCE_ORDER,
  SITE_STATUS_META,
  type Client,
  type LeadSource,
  type SiteStatus,
} from "@/lib/types";
import type { SiteWithClient } from "@/lib/data/queries-sites";
import type { LatestJob } from "@/lib/validation/site";
import { formatDate } from "@/lib/format";
import type { SiteMapPin } from "@/components/sites/site-map";

const SiteMap = dynamic(() => import("@/components/sites/site-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      地図を読み込み中…
    </div>
  ),
});

const DEFAULT_CENTER: [number, number] = [35.6812, 139.7671]; // 東京駅

/** 座標が設定済みの現場（lat/lng が number であることを型で保証する述語） */
type PlacedSite = SiteWithClient & { lat: number; lng: number };

function isPlacedSite(s: SiteWithClient): s is PlacedSite {
  return s.lat != null && s.lng != null;
}

type Props = {
  clients: Client[];
  sites: SiteWithClient[];
  statusMap: Record<string, SiteStatus>;
  /** 現場ごとの前回施工(site_id → 最新1件) */
  latestJobs: Record<string, LatestJob>;
  /** 検索語(URL の ?q=)。空なら検索していない */
  query: string;
  /** 検索結果。null = 検索していない */
  matchedSites: SiteWithClient[] | null;
  /** 検索語が不正なときの案内(例: 50字までで検索できます) */
  searchNotice: string | null;
};

const CONTENT_HEAD_LENGTH = 20;

function contentHead(content: string | null | undefined): string | null {
  const text = content?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > CONTENT_HEAD_LENGTH ? `${text.slice(0, CONTENT_HEAD_LENGTH)}…` : text;
}

export function SiteMapView({
  clients,
  sites,
  statusMap,
  latestJobs,
  query,
  matchedSites,
  searchNotice,
}: Props) {
  const router = useRouter();
  const [newSiteCoords, setNewSiteCoords] = useState<{ lat: number; lng: number } | null>(null);

  const placedSites = useMemo(() => sites.filter(isPlacedSite), [sites]);

  const matchedIds = useMemo(() => new Set((matchedSites ?? []).map((s) => s.id)), [matchedSites]);

  const pins: SiteMapPin[] = useMemo(
    () =>
      placedSites.map((s) => ({
        id: s.id,
        buildingName: s.building_name,
        roomNo: s.room_no,
        clientName: s.client?.name ?? "発注元未設定",
        lat: s.lat,
        lng: s.lng,
        status: statusMap[s.id]?.status ?? "未請求",
        latestJobDate: statusMap[s.id]?.latest_job_date ?? null,
        latestWorkType: latestJobs[s.id]?.work_type ?? null,
        latestContentHead: contentHead(latestJobs[s.id]?.content),
        highlighted: matchedIds.has(s.id),
      })),
    [placedSites, statusMap, latestJobs, matchedIds]
  );

  // 検索で座標つきの現場が一致したときは、その現場の中心に寄せる。無ければ全ピンの中心
  const center = useMemo<[number, number]>(() => {
    const matchedPlaced = placedSites.filter((s) => matchedIds.has(s.id));
    const targets = matchedPlaced.length > 0 ? matchedPlaced : placedSites;
    if (targets.length === 0) return DEFAULT_CENTER;
    const lat = targets.reduce((sum, s) => sum + s.lat, 0) / targets.length;
    const lng = targets.reduce((sum, s) => sum + s.lng, 0) / targets.length;
    return [lat, lng];
  }, [placedSites, matchedIds]);

  return (
    <div className="flex flex-col">
      {/* 現場の検索(建物名・住所メモ・部屋番号)。検索はサーバー側で行い、URL の ?q= に持つ */}
      <form action="/" method="get" className="flex gap-2 px-4 pb-2" role="search">
        <Input
          name="q"
          type="search"
          defaultValue={query}
          maxLength={50}
          placeholder="建物名・住所・部屋番号で現場を探す"
          aria-label="現場の検索"
        />
        <Button type="submit" className="shrink-0 gap-1.5">
          <Search className="size-4" />
          探す
        </Button>
      </form>

      {searchNotice && <p className="px-4 pb-2 text-xs text-muted-foreground">{searchNotice}</p>}

      {matchedSites && <SearchResults query={query} sites={matchedSites} latestJobs={latestJobs} />}

      {/* 凡例 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 text-xs">
        <span className="font-bold text-muted-foreground">状態:</span>
        <LegendDot color={SITE_STATUS_META.未請求.color} label={SITE_STATUS_META.未請求.label} />
        <LegendDot
          color={SITE_STATUS_META.請求済_未入金.color}
          label={SITE_STATUS_META.請求済_未入金.label}
        />
        <LegendDot color={SITE_STATUS_META.入金済.color} label={SITE_STATUS_META.入金済.label} />
      </div>

      <div className="relative z-0 h-[calc(100dvh-18rem)] min-h-80 w-full overflow-hidden [isolation:isolate]">
        <SiteMap
          pins={pins}
          center={center}
          onMapClick={(lat, lng) => setNewSiteCoords({ lat, lng })}
          onPinClick={(id) => router.push(`/sites/${id}`)}
        />
      </div>

      <p className="px-4 pt-2 text-center text-xs text-muted-foreground">
        ピンをタップで前回施工の要約が開き、「詳細へ」で現場詳細に進めます。地図タップで新しい現場を登録できます。
      </p>

      <NewSiteDialog
        clients={clients}
        coords={newSiteCoords}
        onClose={() => setNewSiteCoords(null)}
      />
    </div>
  );
}

function SearchResults({
  query,
  sites,
  latestJobs,
}: {
  query: string;
  sites: SiteWithClient[];
  latestJobs: Record<string, LatestJob>;
}) {
  return (
    <section className="flex flex-col gap-2 px-4 pb-3" aria-label="検索結果">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <p>
          「{query}」に一致する現場: {sites.length}件
        </p>
        <Link href="/" className="underline">
          検索をクリア
        </Link>
      </div>
      {sites.length === 0 ? (
        <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
          一致する現場がありません
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sites.map((s) => {
            const job = latestJobs[s.id];
            return (
              <li key={s.id}>
                <Link
                  href={`/sites/${s.id}`}
                  className="flex flex-col gap-0.5 rounded-md border px-3 py-2 hover:bg-muted"
                >
                  <span className="font-bold">
                    {s.building_name}
                    {s.room_no ? ` ${s.room_no}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.client?.name ?? "発注元未設定"}
                    {s.address_memo ? ` / ${s.address_memo}` : ""}
                  </span>
                  <span className="text-sm">
                    {job
                      ? `前回施工: ${formatDate(job.job_date)}${job.work_type ? ` ${job.work_type}` : ""}`
                      : "施工記録なし"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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

function NewSiteDialog({
  clients,
  coords,
  onClose,
}: {
  clients: Client[];
  coords: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={coords !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>この地点に現場を登録</DialogTitle>
        </DialogHeader>
        {coords && <NewSiteBody clients={clients} initial={coords} />}
      </DialogContent>
    </Dialog>
  );
}

function NewSiteBody({
  clients,
  initial,
}: {
  clients: Client[];
  initial: { lat: number; lng: number };
}) {
  const [clientId, setClientId] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [roomNo, setRoomNo] = useState("");
  const [leadSource, setLeadSource] = useState<LeadSource>("その他");
  const [pos, setPos] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setError("");
    if (!clientId) {
      setError("発注元を選択してください");
      return;
    }
    if (!buildingName.trim()) {
      setError("建物名を入力してください");
      return;
    }
    startTransition(async () => {
      // 成功時は createSiteAction 内の redirect() が現場詳細へ遷移させるため、
      // ここに到達するのは失敗時のみ(ISSUE-004対応。詳細は actions-sites.ts 参照)。
      const result = await createSiteAction({
        clientId,
        buildingName,
        roomNo: roomNo || undefined,
        addressMemo: undefined,
        lat: pos.lat,
        lng: pos.lng,
        leadSource,
      });
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ns-client">発注元</Label>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger id="ns-client">
            <SelectValue placeholder="発注元を選択" />
          </SelectTrigger>
          <SelectContent>
            {clients.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                「発注元」タブで先に登録してください
              </div>
            ) : (
              clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ns-building">建物名</Label>
        <Input
          id="ns-building"
          placeholder="例: ○○マンション"
          value={buildingName}
          onChange={(e) => setBuildingName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ns-room">部屋番号（任意）</Label>
        <Input
          id="ns-room"
          placeholder="例: 203"
          value={roomNo}
          onChange={(e) => setRoomNo(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ns-lead">集客経路</Label>
        <Select value={leadSource} onValueChange={(v) => setLeadSource(v as LeadSource)}>
          <SelectTrigger id="ns-lead">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_SOURCE_ORDER.map((ls) => (
              <SelectItem key={ls} value={ls}>
                {LEAD_SOURCE_LABEL[ls]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        {pending ? "登録中…" : "この位置で現場を登録"}
      </Button>
    </>
  );
}
