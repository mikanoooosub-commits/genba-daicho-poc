"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  School as SchoolIcon,
  MapPin,
  MapPinOff,
  ChevronDown,
  ExternalLink,
  Pencil,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LocationPicker } from "@/components/map/location-picker";
import { addSchoolAction, deleteSchoolAction, updateSchoolAction } from "@/lib/data/actions";
import type { School } from "@/lib/types";

const DEFAULT_CENTER = { lat: 35.6812, lng: 139.7671 }; // 東京駅

export function SchoolManager({ schools }: { schools: School[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [editTarget, setEditTarget] = useState<School | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<School | null>(null);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return;
    startTransition(async () => {
      const result = await addSchoolAction(name, pos?.lat ?? null, pos?.lng ?? null, url);
      if (result.ok) {
        setName("");
        setUrl("");
        setPos(null);
        setShowPicker(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete(id: string) {
    setError("");
    startTransition(async () => {
      const result = await deleteSchoolAction(id);
      setDeleteTarget(null);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="school-name" className="text-sm font-bold">
                小学校を追加
              </label>
              <div className="flex items-end gap-2">
                <Input
                  id="school-name"
                  placeholder="例: 〇〇小学校"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={pending} aria-label="追加">
                  <Plus className="size-5" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="school-url" className="text-xs">
                ホームページURL（任意）
              </Label>
              <Input
                id="school-url"
                type="url"
                inputMode="url"
                placeholder="https://example.ed.jp/"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setShowPicker((v) => !v);
                if (!pos) setPos(DEFAULT_CENTER);
              }}
              className="flex items-center gap-1 self-start text-xs font-bold text-primary"
            >
              <ChevronDown className={`size-3.5 transition-transform ${showPicker ? "rotate-180" : ""}`} />
              地図で位置を指定（任意）
            </button>

            {showPicker && (
              <div className="flex flex-col gap-2">
                <LocationPicker
                  value={pos}
                  center={pos ?? DEFAULT_CENTER}
                  onChange={(lat, lng) => setPos({ lat, lng })}
                />
                {pos && (
                  <p className="text-xs text-muted-foreground">
                    緯度 {pos.lat.toFixed(5)} / 経度 {pos.lng.toFixed(5)}
                  </p>
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {error && <p className="px-1 text-sm text-destructive">{error}</p>}

      {schools.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            まだ小学校が登録されていません。上のフォームから追加してください。
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {schools.map((s) => {
            const hasCoords = s.lat != null && s.lng != null;
            return (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm"
              >
                <SchoolIcon className="size-4 shrink-0 text-primary" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.name}</span>
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      ホームページを開く
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">URL未登録</span>
                  )}
                </div>
                <span
                  className={`shrink-0 ${hasCoords ? "text-primary" : "text-muted-foreground"}`}
                  title={hasCoords ? "位置設定済み" : "位置未設定"}
                >
                  {hasCoords ? <MapPin className="size-4" /> : <MapPinOff className="size-4" />}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={() => setEditTarget(s)}
                >
                  <Pencil className="size-4" />
                  編集
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-destructive"
                  aria-label="削除"
                  disabled={pending}
                  onClick={() => setDeleteTarget(s)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        ※ 座標を設定すると、地図に青いピンで表示され、配布実績の登録時もその付近が中心表示されます。
        <br />
        ※ URLを登録すると、この一覧や地図の青ピンからホームページを別タブで開けます。
      </p>

      <SchoolEditDialog
        school={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          router.refresh();
        }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>小学校を削除しますか？</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            「<span className="font-bold">{deleteTarget?.name}</span>」を削除します。この操作は取り消せません。
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteTarget(null)}
              disabled={pending}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              disabled={pending}
            >
              {pending ? "削除中…" : "削除する"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SchoolEditDialog({
  school,
  onClose,
  onSaved,
}: {
  school: School | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={school !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>小学校の編集</DialogTitle>
        </DialogHeader>
        {school && <SchoolEditBody school={school} onSaved={onSaved} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SchoolEditBody({
  school,
  onSaved,
  onClose,
}: {
  school: School;
  onSaved: () => void;
  onClose: () => void;
}) {
  const initial =
    school.lat != null && school.lng != null
      ? { lat: school.lat, lng: school.lng }
      : DEFAULT_CENTER;
  const [name, setName] = useState(school.name);
  const [url, setUrl] = useState(school.url ?? "");
  const [pos, setPos] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError("");
    if (!name.trim()) {
      setError("小学校名を入力してください");
      return;
    }
    startTransition(async () => {
      const result = await updateSchoolAction(school.id, name, url, pos.lat, pos.lng);
      if (result.ok) onSaved();
      else setError(result.error);
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-name">小学校名</Label>
        <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-url">ホームページURL（任意）</Label>
        <Input
          id="edit-url"
          type="url"
          inputMode="url"
          placeholder="https://example.ed.jp/"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>位置（現在地・検索・タップ・ドラッグで指定）</Label>
        <LocationPicker value={pos} center={initial} onChange={(lat, lng) => setPos({ lat, lng })} />
        <p className="text-xs text-muted-foreground">
          緯度 {pos.lat.toFixed(5)} / 経度 {pos.lng.toFixed(5)}
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
          キャンセル
        </Button>
        <Button className="flex-1" onClick={handleSave} disabled={pending}>
          {pending ? "保存中…" : "保存する"}
        </Button>
      </div>
    </>
  );
}
