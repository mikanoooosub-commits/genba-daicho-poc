"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisitForm } from "@/components/visits/visit-form";
import { VisitLogDialog } from "@/components/visits/visit-log-dialog";
import { updateVisitAction, setVisitDeletedAction } from "@/lib/data/actions";
import type { LocationWithSchool } from "@/lib/data/queries";
import {
  RATING_META,
  type School,
  type VisitInput,
  type VisitWithRelations,
} from "@/lib/types";
import { formatDatePadded, formatTimeRange } from "@/lib/format";

export function VisitTableRow({
  visit,
  schools,
  locations,
}: {
  visit: VisitWithRelations;
  schools: School[];
  locations: LocationWithSchool[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const schoolName = visit.location?.school?.name ?? "（小学校未設定）";
  const spot = visit.location?.spot?.trim();
  const target = spot ? `${schoolName} ${spot}` : schoolName;
  const rating = RATING_META[visit.rating];
  const timeRange = formatTimeRange(visit.start_time, visit.end_time);
  const dt = `${formatDatePadded(visit.date)}${timeRange ? ` ${timeRange}` : ""}`;

  const initial: Partial<VisitInput> = {
    locationId: visit.location_id,
    schoolId: visit.location?.school_id ?? "",
    spot: visit.location?.spot ?? "",
    date: visit.date,
    startTime: visit.start_time,
    endTime: visit.end_time,
    count: visit.count,
    rating: visit.rating,
    memo: visit.memo,
    lat: visit.location?.lat ?? null,
    lng: visit.location?.lng ?? null,
  };

  function toggleDeleted(isDeleted: boolean) {
    startTransition(async () => {
      await setVisitDeletedAction(visit.id, isDeleted);
      router.refresh();
    });
  }

  return (
    <tr className={`border-b border-border/50 ${visit.is_deleted ? "opacity-50" : ""}`}>
      <td className="whitespace-nowrap px-2 py-2 align-top">{dt}</td>
      <td className="px-2 py-2 align-top">{target}</td>
      <td className="px-2 py-2 text-right align-top tabular-nums">
        {visit.count != null ? visit.count : "—"}
      </td>
      <td className="px-2 py-2 align-top">
        <Badge className={rating.badgeClass}>{rating.label}</Badge>
      </td>
      <td className="max-w-[16rem] px-2 py-2 align-top">
        <span className="line-clamp-2 whitespace-pre-wrap">{visit.memo}</span>
        {visit.is_deleted && (
          <Badge variant="outline" className="ml-1 text-destructive">
            削除済み
          </Badge>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex items-center gap-0.5">
          {!visit.is_deleted && (
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="編集"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-4" />
              </Button>
              <DialogContent className="max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>配布実績を編集</DialogTitle>
                </DialogHeader>
                <VisitForm
                  schools={schools}
                  locations={locations}
                  initial={initial}
                  submitLabel="保存する"
                  onSubmit={(input) => updateVisitAction(visit.id, input)}
                  onSuccess={() => {
                    setEditOpen(false);
                    router.refresh();
                  }}
                  onCancel={() => setEditOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}
          <VisitLogDialog visitId={visit.id} />
          {visit.is_deleted ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-primary"
              aria-label="復元"
              disabled={pending}
              onClick={() => toggleDeleted(false)}
            >
              <RotateCcw className="size-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive"
              aria-label="削除"
              disabled={pending}
              onClick={() => toggleDeleted(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
