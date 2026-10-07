"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Building2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import {
  createClientAction,
  updateClientAction,
  setClientDeletedAction,
} from "@/lib/data/actions-sites";
import { CLIENT_TYPE_ORDER, type Client, type ClientType } from "@/lib/types";

/** 発注元マスタの追加・編集・論理削除（既存の SchoolManager と同じ構成） */
export function ClientManager({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<ClientType>(CLIENT_TYPE_ORDER[0]);
  const [formatMemo, setFormatMemo] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleteError, setDeleteError] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("発注元名を入力してください");
      return;
    }
    startTransition(async () => {
      const result = await createClientAction({ name, type, formatMemo });
      if (result.ok) {
        setName("");
        setType(CLIENT_TYPE_ORDER[0]);
        setFormatMemo("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleDelete(client: Client) {
    setDeleteError("");
    startTransition(async () => {
      const result = await setClientDeletedAction(client.id, true);
      if (result.ok) {
        setDeleteTarget(null);
        router.refresh();
      } else {
        setDeleteError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <form onSubmit={handleAdd} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-name">発注元を追加</Label>
              <Input
                id="client-name"
                placeholder="例: ○○管理"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-type" className="text-sm">
                種別
              </Label>
              <Select value={type} onValueChange={(v) => setType(v as ClientType)}>
                <SelectTrigger id="client-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="client-memo" className="text-sm">
                様式メモ（任意・請求書パターン・指定アプリ等）
              </Label>
              <Textarea
                id="client-memo"
                placeholder="例: 請求書は指定Excel雛形、月末締め翌月末払い"
                value={formatMemo}
                onChange={(e) => setFormatMemo(e.target.value)}
              />
            </div>

            <Button type="submit" disabled={pending} className="gap-2 self-start">
              <Plus className="size-4" />
              {pending ? "登録中…" : "追加する"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && <p className="px-1 text-sm text-destructive">{error}</p>}

      {clients.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            まだ発注元が登録されていません。上のフォームから追加してください。
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm"
            >
              <Building2 className="size-4 shrink-0 text-primary" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{c.name}</span>
                {c.format_memo && (
                  <span className="truncate text-sm text-muted-foreground">{c.format_memo}</span>
                )}
              </div>
              <Badge variant="outline" className="shrink-0">
                {c.type}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => setEditTarget(c)}
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
                onClick={() => {
                  setDeleteError("");
                  setDeleteTarget(c);
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ClientEditDialog
        client={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          router.refresh();
        }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>発注元を削除しますか？</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            「<span className="font-bold">{deleteTarget?.name}</span>」を削除します。
            この発注元に紐づく現場がある場合は削除できません。
          </p>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
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
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
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

function ClientEditDialog({
  client,
  onClose,
  onSaved,
}: {
  client: Client | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={client !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>発注元の編集</DialogTitle>
        </DialogHeader>
        {client && <ClientEditBody client={client} onSaved={onSaved} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ClientEditBody({
  client,
  onSaved,
  onClose,
}: {
  client: Client;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [type, setType] = useState<ClientType>(client.type);
  const [formatMemo, setFormatMemo] = useState(client.format_memo ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError("");
    if (!name.trim()) {
      setError("発注元名を入力してください");
      return;
    }
    startTransition(async () => {
      const result = await updateClientAction({ id: client.id, name, type, formatMemo });
      if (result.ok) onSaved();
      else setError(result.error);
    });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-client-name">発注元名</Label>
        <Input id="edit-client-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-client-type">種別</Label>
        <Select value={type} onValueChange={(v) => setType(v as ClientType)}>
          <SelectTrigger id="edit-client-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLIENT_TYPE_ORDER.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="edit-client-memo">様式メモ（任意）</Label>
        <Textarea
          id="edit-client-memo"
          value={formatMemo}
          onChange={(e) => setFormatMemo(e.target.value)}
        />
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
