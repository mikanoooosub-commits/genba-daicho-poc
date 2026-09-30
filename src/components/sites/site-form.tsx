"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocationPicker } from "@/components/map/location-picker";
import {
  LEAD_SOURCE_LABEL,
  LEAD_SOURCE_ORDER,
  type ActionResult,
  type Client,
  type LeadSource,
} from "@/lib/types";
import type { SiteInput } from "@/lib/validation/site";

const DEFAULT_CENTER = { lat: 35.6812, lng: 139.7671 }; // 東京駅

export type SiteFormValue = SiteInput;

type Props = {
  clients: Client[];
  initial?: Partial<SiteFormValue>;
  submitLabel: string;
  onSubmit: (input: SiteFormValue) => Promise<ActionResult>;
  /**
   * 保存成功時に、送信した入力値を渡す。呼び出し側はこれで表示を楽観的更新でき、
   * `router.refresh()`のサーバー往復を待たずに画面へ即時反映できる（ISSUE-005対応）。
   */
  onSuccess?: (input: SiteFormValue) => void;
  onCancel?: () => void;
};

/** 現場の作成・編集フォーム。入居者名・発注元担当者名の入力欄は作らない（SPEC.md §2・§7方針） */
export function SiteForm({ clients, initial, submitLabel, onSubmit, onSuccess, onCancel }: Props) {
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [buildingName, setBuildingName] = useState(initial?.buildingName ?? "");
  const [roomNo, setRoomNo] = useState(initial?.roomNo ?? "");
  const [addressMemo, setAddressMemo] = useState(initial?.addressMemo ?? "");
  const [leadSource, setLeadSource] = useState<LeadSource>(initial?.leadSource ?? "その他");
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(
    initial?.lat != null && initial?.lng != null ? { lat: initial.lat, lng: initial.lng } : null
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) {
      setError("発注元を選択してください");
      return;
    }
    if (!buildingName.trim()) {
      setError("建物名を入力してください");
      return;
    }

    const input: SiteFormValue = {
      clientId,
      buildingName,
      roomNo: roomNo || undefined,
      addressMemo: addressMemo || undefined,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      leadSource,
    };

    startTransition(async () => {
      const result = await onSubmit(input);
      if (result.ok) onSuccess?.(input);
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sf-client">発注元</Label>
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger id="sf-client">
            <SelectValue placeholder="発注元を選択" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sf-building">建物名</Label>
        <Input id="sf-building" value={buildingName} onChange={(e) => setBuildingName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sf-room">部屋番号（任意）</Label>
        <Input id="sf-room" value={roomNo} onChange={(e) => setRoomNo(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sf-lead">集客経路</Label>
        <Select value={leadSource} onValueChange={(v) => setLeadSource(v as LeadSource)}>
          <SelectTrigger id="sf-lead">
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
        <Label htmlFor="sf-address">住所メモ（任意・丁目レベルまで）</Label>
        <Textarea
          id="sf-address"
          placeholder="個人が特定できる情報（入居者名等）は入れない"
          value={addressMemo}
          onChange={(e) => setAddressMemo(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>位置（現在地・検索・タップ・ドラッグで指定）</Label>
        <LocationPicker value={pos} center={pos ?? DEFAULT_CENTER} onChange={(lat, lng) => setPos({ lat, lng })} />
        {pos && (
          <p className="text-xs text-muted-foreground">
            緯度 {pos.lat.toFixed(5)} / 経度 {pos.lng.toFixed(5)}
          </p>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={pending}>
            キャンセル
          </Button>
        )}
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? "保存中…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
