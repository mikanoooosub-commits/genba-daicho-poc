"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SiteForm, type SiteFormValue } from "@/components/sites/site-form";
import { JobForm } from "@/components/sites/job-form";
import { JobRow } from "@/components/sites/job-row";
import { updateSiteAction, setSiteDeletedAction } from "@/lib/data/actions-sites";
import { JOB_RATING_META, LEAD_SOURCE_LABEL, type Client, type Job } from "@/lib/types";
import type { SiteWithClient } from "@/lib/data/queries-sites";
import type { LatestJob } from "@/lib/validation/site";
import { formatDate } from "@/lib/format";

type Props = {
  site: SiteWithClient;
  jobs: Job[];
  clients: Client[];
  includeDeleted: boolean;
  /** 同じ建物(建物名完全一致)の他の現場 */
  siblings: SiteWithClient[];
  /** 同じ建物の他の現場の前回施工(site_id → 最新1件) */
  siblingLatestJobs: Record<string, LatestJob>;
  /** 実装Bの請求・入金コンポーネント(Server Component)。ページ側で生成して渡してもらう */
  children?: React.ReactNode;
};

export function SiteDetailView({
  site,
  jobs,
  clients,
  includeDeleted,
  siblings,
  siblingLatestJobs,
  children,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editingSite, setEditingSite] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [deletePending, startDeleteTransition] = useTransition();
  const [restorePending, startRestoreTransition] = useTransition();

  // 現場情報の表示用ローカル状態。編集保存の成功時に楽観的更新でここを直接書き換えることで、
  // `router.refresh()`のサーバー往復(RSC再取得)を待たずに画面へ即時反映する(ISSUE-005対応)。
  // サーバーの再取得が完了すれば、新しい`site`propでここも上書きされ、最終的にサーバー値と一致する。
  const [siteState, setSiteState] = useState(site);
  useEffect(() => {
    setSiteState(site);
  }, [site]);

  // jobs は job_date desc・created_at desc で取得済みのため、先頭の未削除行が「前回施工」
  const latestJob = jobs.find((j) => !j.is_deleted) ?? null;

  function toggleIncludeDeleted(checked: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (checked) params.set("deleted", "1");
    else params.delete("deleted");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  /**
   * ISSUE-008対応: 現場自体の論理削除/復元。削除成功時は
   * `setSiteDeletedAction`内の`redirect("/")`が地図へ遷移させるため、
   * このハンドラに戻ってくるのは失敗時のみ(ISSUE-004/CHANGE-A-011と同じ理由。
   * `NewSiteBody`の`handleCreate`も参照)。
   */
  function handleDeleteSite() {
    setDeleteError("");
    startDeleteTransition(async () => {
      const result = await setSiteDeletedAction(site.id, true);
      if (!result.ok) setDeleteError(result.error);
    });
  }

  /** 復元は同じ現場詳細ページに留まりたいため、redirect()を経由せず router.refresh() で反映する */
  function handleRestoreSite() {
    setRestoreError("");
    startRestoreTransition(async () => {
      const result = await setSiteDeletedAction(site.id, false);
      if (result.ok) router.refresh();
      else setRestoreError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ISSUE-008対応: 削除済みの現場を開いたときのバナー。地図・履歴には出ないが、
          直接URLで開いた場合は404にせず、ここから復元できるようにする(PM指示)。 */}
      {siteState.is_deleted && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-destructive">この現場は削除済みです</p>
              <p className="text-xs text-muted-foreground">
                地図のピン・一覧には表示されません。復元すると元に戻ります。
              </p>
              {restoreError && <p className="mt-1 text-sm text-destructive">{restoreError}</p>}
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={restorePending}
              onClick={handleRestoreSite}
            >
              <RotateCcw className="size-4" />
              {restorePending ? "復元中…" : "復元する"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 現場情報 */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold">
                {siteState.building_name}
                {siteState.room_no ? ` ${siteState.room_no}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                {siteState.client?.name ?? "発注元未設定"}
              </p>
              <p className="text-xs text-muted-foreground">
                集客経路: {LEAD_SOURCE_LABEL[siteState.lead_source]}
              </p>
              {siteState.address_memo && (
                <p className="text-xs text-muted-foreground">{siteState.address_memo}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setEditingSite(true)}
            >
              <Pencil className="size-4" />
              編集
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 前回施工（照会にすぐ使える。SPEC.md §10②の受入条件） */}
      <Card>
        <CardContent className="flex flex-col gap-1">
          <p className="text-xs font-bold text-muted-foreground">前回施工</p>
          {latestJob ? (
            <>
              <p className="font-bold">{formatDate(latestJob.job_date)}</p>
              <p className="text-sm">
                {[latestJob.work_type, latestJob.content].filter(Boolean).join(" / ") || "(内容未記入)"}
              </p>
              <Badge className={`w-fit ${JOB_RATING_META[latestJob.rating].badgeClass}`}>
                {JOB_RATING_META[latestJob.rating].label}
              </Badge>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">まだ施工記録がありません</p>
          )}
        </CardContent>
      </Card>

      {/* 同じ建物の他の部屋(S1: 別の部屋で見積を出すとき、前回の施工を探す) */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs font-bold text-muted-foreground">同じ建物の他の部屋</p>
          {!siteState.building_name.trim() ? (
            <p className="text-sm text-muted-foreground">建物名が未登録です</p>
          ) : siblings.length === 0 ? (
            <p className="text-sm text-muted-foreground">同じ建物の他の現場はありません</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {siblings.map((s) => {
                const job = siblingLatestJobs[s.id];
                return (
                  <li key={s.id}>
                    <Link
                      href={`/sites/${s.id}`}
                      className="flex flex-col gap-0.5 rounded-md border px-3 py-2 hover:bg-muted"
                    >
                      <span className="font-bold">{s.room_no ? `${s.room_no}号室` : "部屋番号なし"}</span>
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
        </CardContent>
      </Card>

      {/*
        この現場の請求・入金一覧（実装Bの `SiteInvoicesPanel` をページ側から
        children として受け取って表示する。SPEC.md §11: 実装A/Bのファイルは互いに
        変更しない取り決めのため、データ取得はBのコンポーネント側で完結させている）。
      */}
      <div data-slot="site-billing-section">{children}</div>

      {/* 施工履歴 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">施工履歴</h2>
        <Dialog open={addJobOpen} onOpenChange={setAddJobOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              施工を登録
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>施工を登録</DialogTitle>
            </DialogHeader>
            <JobForm
              siteId={site.id}
              submitLabel="登録する"
              onSuccess={() => {
                setAddJobOpen(false);
                router.refresh();
              }}
              onCancel={() => setAddJobOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={includeDeleted}
          onChange={(e) => toggleIncludeDeleted(e.target.checked)}
        />
        削除済みを表示
      </label>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            まだ施工記録がありません。「施工を登録」から追加してください。
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </div>
      )}

      {/* ISSUE-008対応: 現場自体の削除。施工・請求とは重みが違う操作(地図から消え、
          遷移も伴う)ため、他の削除ボタンと分けてカード+確認ダイアログにした */}
      {!siteState.is_deleted && (
        <Card className="border-destructive/30">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">この現場を削除する</p>
              <p className="text-xs text-muted-foreground">
                論理削除のみ行われ、施工・請求・入金の記録は残ります(復元可能)。
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 text-destructive"
              onClick={() => {
                setDeleteError("");
                setDeleteConfirmOpen(true);
              }}
            >
              <Trash2 className="size-4" />
              削除する
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteConfirmOpen} onOpenChange={(o) => !o && setDeleteConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>この現場を削除しますか？</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            「
            <span className="font-bold">
              {siteState.building_name}
              {siteState.room_no ? ` ${siteState.room_no}` : ""}
            </span>
            」を削除します。地図のピン・一覧から表示されなくなりますが、後から復元できます
            (施工・請求・入金の記録は消えません)。
          </p>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deletePending}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleDeleteSite}
              disabled={deletePending}
            >
              {deletePending ? "削除中…" : "削除する"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SiteEditDialog
        site={editingSite ? siteState : null}
        clients={clients}
        onClose={() => setEditingSite(false)}
        onSaved={(updated) => {
          setSiteState(updated);
          setEditingSite(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function SiteEditDialog({
  site,
  clients,
  onClose,
  onSaved,
}: {
  site: SiteWithClient | null;
  clients: Client[];
  onClose: () => void;
  /** 保存成功時、送信済みの値から組み立てた最新の現場情報を渡す（楽観的更新用） */
  onSaved: (updated: SiteWithClient) => void;
}) {
  return (
    <Dialog open={site !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>現場情報の編集</DialogTitle>
        </DialogHeader>
        {site && (
          <SiteForm
            clients={clients}
            initial={{
              clientId: site.client_id,
              buildingName: site.building_name,
              roomNo: site.room_no ?? "",
              addressMemo: site.address_memo ?? "",
              leadSource: site.lead_source,
              lat: site.lat,
              lng: site.lng,
            }}
            submitLabel="保存する"
            onSubmit={(input) => updateSiteAction({ ...input, id: site.id })}
            onSuccess={(input: SiteFormValue) => {
              const client = clients.find((c) => c.id === input.clientId) ?? null;
              onSaved({
                ...site,
                client_id: input.clientId,
                building_name: input.buildingName,
                room_no: input.roomNo?.trim() ? input.roomNo.trim() : null,
                address_memo: input.addressMemo?.trim() ? input.addressMemo.trim() : null,
                lat: input.lat ?? null,
                lng: input.lng ?? null,
                lead_source: input.leadSource,
                client,
              });
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
