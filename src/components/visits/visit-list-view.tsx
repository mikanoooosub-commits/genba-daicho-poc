"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Filter, X, MapPin, Pencil, Copy, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { VisitRow } from "@/components/visits/visit-row";
import { VisitTableRow } from "@/components/visits/visit-table-row";
import { VisitForm } from "@/components/visits/visit-form";
import { LocationPicker } from "@/components/map/location-picker";
import { RegisterDialog } from "@/components/register-dialog";
import { createVisitAction, setLocationCoordsAction } from "@/lib/data/actions";
import type { School, VisitWithRelations } from "@/lib/types";
import type { LocationWithSchool } from "@/lib/data/queries";
import { formatDatePadded, formatTimeRange } from "@/lib/format";

/** 一覧を「日時 対象 配布数 メモ」のタブ区切りテキストに整形（上司報告コピー用） */
function buildTsv(visits: VisitWithRelations[]): string {
  const header = ["日時", "対象", "配布数", "メモ"].join("\t");
  const rows = visits.map((v) => {
    const time = formatTimeRange(v.start_time, v.end_time);
    const dt = `${formatDatePadded(v.date)}${time ? ` ${time}` : ""}`;
    const school = v.location?.school?.name ?? "";
    const spot = v.location?.spot?.trim() ?? "";
    const target = spot ? `${school} ${spot}` : school;
    const count = v.count != null ? String(v.count) : "";
    const memo = (v.memo ?? "").replace(/[\t\r\n]+/g, " ");
    return [dt, target, count, memo].join("\t");
  });
  return [header, ...rows].join("\n");
}

type Props = {
  schools: School[];
  locations: LocationWithSchool[];
  visits: VisitWithRelations[];
  filters: {
    from: string;
    to: string;
    schoolId: string;
    locationId: string;
    includeDeleted: boolean;
    hideZero: boolean;
  };
  activeLocation: LocationWithSchool | null;
};

export function VisitListView({ schools, locations, visits, filters, activeLocation }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildTsv(visits));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボード権限が無い環境では何もしない
    }
  }

  const totalCount = visits.reduce((sum, v) => sum + (v.count ?? 0), 0);
  const unmappedCount = visits.filter(
    (v) => v.location?.lat == null || v.location?.lng == null
  ).length;

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    router.push(`/list?${params.toString()}`);
  }

  function clearFilters() {
    router.push("/list");
  }

  const hasActiveFilter =
    filters.from || filters.to || filters.schoolId || filters.includeDeleted;

  return (
    <div className="flex flex-col gap-4">
      {/* 地図から来た場合の、その場所のコンテキストバナー */}
      {activeLocation && (
        <LocationBanner
          location={activeLocation}
          schools={schools}
          locations={locations}
          onClear={() => router.push("/list")}
        />
      )}

      {/* 新規登録（配布実績 or マップメモ） */}
      <RegisterDialog schools={schools} locations={locations} />

      {/* フィルタ */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Filter className="size-4" />
              絞り込み
            </span>
            {hasActiveFilter && (
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="size-3.5" />
                クリア
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-from" className="text-xs">開始日</Label>
              <Input
                id="f-from"
                type="date"
                value={filters.from}
                onChange={(e) => updateParam("from", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-to" className="text-xs">終了日</Label>
              <Input
                id="f-to"
                type="date"
                value={filters.to}
                onChange={(e) => updateParam("to", e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-school" className="text-xs">対象小学校</Label>
            <Select
              value={filters.schoolId || "all"}
              onValueChange={(v) => updateParam("school", v === "all" ? null : v)}
            >
              <SelectTrigger id="f-school">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {schools.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={filters.hideZero}
              onChange={(e) => updateParam("hidezero", e.target.checked ? "1" : null)}
            />
            0件の履歴を非表示
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={filters.includeDeleted}
              onChange={(e) => updateParam("deleted", e.target.checked ? "1" : null)}
            />
            削除済みを表示
          </label>
        </CardContent>
      </Card>

      {/* サマリー */}
      <div className="grid grid-cols-3 gap-2">
        <SummaryCell label="表示件数" value={`${visits.length}件`} />
        <SummaryCell label="配布枚数合計" value={`${totalCount}枚`} />
        <SummaryCell label="地図未紐付け" value={`${unmappedCount}件`} />
      </div>

      {/* 履歴コピー */}
      {visits.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
            {copied ? <Check className="size-4 text-rating-good" /> : <Copy className="size-4" />}
            {copied ? "コピーしました" : "履歴をコピー"}
          </Button>
        </div>
      )}

      {/* 一覧 */}
      {visits.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {hasActiveFilter
              ? "条件に合う配布実績がありません"
              : "まだ配布実績がありません。「配布実績を登録」から追加しましょう。"}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* スマホ: カード表示 */}
          <div className="flex flex-col gap-3 md:hidden">
            {visits.map((v) => (
              <VisitRow key={v.id} visit={v} schools={schools} locations={locations} />
            ))}
          </div>

          {/* PC: テーブル表示 */}
          <div className="hidden overflow-x-auto rounded-xl border border-border/60 bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-bold">日時</th>
                  <th className="px-2 py-2 font-bold">対象</th>
                  <th className="px-2 py-2 text-right font-bold">配布数</th>
                  <th className="px-2 py-2 font-bold">評価</th>
                  <th className="px-2 py-2 font-bold">メモ</th>
                  <th className="px-2 py-2 font-bold">操作</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <VisitTableRow key={v.id} visit={v} schools={schools} locations={locations} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 text-center shadow-sm">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function LocationBanner({
  location,
  schools,
  locations,
  onClear,
}: {
  location: LocationWithSchool;
  schools: School[];
  locations: LocationWithSchool[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editPosOpen, setEditPosOpen] = useState(false);
  const hasCoords = location.lat != null && location.lng != null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <MapPin className="size-4 shrink-0 text-primary" />
            {location.school?.name ?? "小学校未設定"}
          </p>
          {location.spot?.trim() && (
            <p className="pl-5.5 text-xs text-muted-foreground">{location.spot}</p>
          )}
          <p className="pl-5.5 text-xs text-muted-foreground">この場所の配布履歴を表示中</p>
        </div>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={onClear}>
          <X className="size-3.5" />
          解除
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              この場所に追加
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>この場所に配布実績を追加</DialogTitle>
            </DialogHeader>
            <VisitForm
              schools={schools}
              locations={locations}
              initial={{
                locationId: location.id,
                schoolId: location.school_id ?? "",
                spot: location.spot ?? "",
                lat: location.lat,
                lng: location.lng,
              }}
              submitLabel="追加する"
              onSubmit={createVisitAction}
              onSuccess={() => {
                setAddOpen(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={editPosOpen} onOpenChange={setEditPosOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Pencil className="size-4" />
              {hasCoords ? "位置を修正" : "位置を設定"}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>配布場所の位置を修正</DialogTitle>
            </DialogHeader>
            <EditPositionBody
              location={location}
              onSaved={() => {
                setEditPosOpen(false);
                router.refresh();
              }}
              onCancel={() => setEditPosOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function EditPositionBody({
  location,
  onSaved,
  onCancel,
}: {
  location: LocationWithSchool;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const DEFAULT_CENTER = { lat: 35.6812, lng: 139.7671 };
  const initial =
    location.lat != null && location.lng != null
      ? { lat: location.lat, lng: location.lng }
      : DEFAULT_CENTER;
  const [pos, setPos] = useState(initial);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      await setLocationCoordsAction(location.id, pos.lat, pos.lng);
      onSaved();
    });
  }

  return (
    <>
      <LocationPicker value={pos} center={initial} onChange={(lat, lng) => setPos({ lat, lng })} />
      <p className="text-xs text-muted-foreground">
        緯度 {pos.lat.toFixed(5)} / 経度 {pos.lng.toFixed(5)}（検索・タップ・ドラッグで調整）
      </p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={pending}>
          キャンセル
        </Button>
        <Button className="flex-1" onClick={handleSave} disabled={pending}>
          {pending ? "保存中…" : "この位置で保存"}
        </Button>
      </div>
    </>
  );
}
