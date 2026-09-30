"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, RotateCcw, MapPin, MapPinOff, Clock, FileText } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VisitForm } from "@/components/visits/visit-form";
import { VisitLogDialog } from "@/components/visits/visit-log-dialog";
import {
  RATING_META,
  type School,
  type VisitInput,
  type VisitWithRelations,
} from "@/lib/types";
import { updateVisitAction, setVisitDeletedAction } from "@/lib/data/actions";
import type { LocationWithSchool } from "@/lib/data/queries";
import { formatDate, formatTimeRange } from "@/lib/format";

export function VisitRow({
  visit,
  schools,
  locations,
}: {
  visit: VisitWithRelations;
  schools: School[];
  locations: LocationWithSchool[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const schoolName = visit.location?.school?.name ?? "（小学校未設定）";
  const spot = visit.location?.spot?.trim();
  const hasCoords = visit.location?.lat != null && visit.location?.lng != null;
  const rating = RATING_META[visit.rating];
  const timeRange = formatTimeRange(visit.start_time, visit.end_time);

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

  if (editing) {
    return (
      <Card className={visit.is_deleted ? "opacity-70" : ""}>
        <CardContent>
          <VisitForm
            schools={schools}
            locations={locations}
            initial={initial}
            submitLabel="保存する"
            onSubmit={(input) => updateVisitAction(visit.id, input)}
            onSuccess={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={visit.is_deleted ? "opacity-60" : ""}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">{formatDate(visit.date)}</p>
            {timeRange && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                {timeRange}
              </p>
            )}
          </div>
          <Badge className={rating.badgeClass}>{rating.label}</Badge>
        </div>

        <div className="flex flex-col gap-0.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            {hasCoords ? (
              <MapPin className="size-4 shrink-0 text-primary" />
            ) : (
              <MapPinOff className="size-4 shrink-0 text-muted-foreground" />
            )}
            {schoolName}
          </p>
          {spot && <p className="pl-5.5 text-muted-foreground">{spot}</p>}
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="font-bold">{visit.count != null ? `${visit.count}枚` : "枚数未記入"}</span>
          {visit.is_deleted && (
            <Badge variant="outline" className="text-destructive">
              削除済み
            </Badge>
          )}
        </div>

        {visit.memo && (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 p-2.5 text-sm text-muted-foreground">
            <FileText className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">{visit.memo}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
          {!visit.is_deleted && (
            <>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                編集
              </Button>
              {!hasCoords && (
                <Button variant="ghost" size="sm" className="gap-1.5 text-primary" asChild>
                  <Link href={`/?place=${visit.location_id}`}>
                    <MapPin className="size-4" />
                    地図に配置
                  </Link>
                </Button>
              )}
            </>
          )}
          <VisitLogDialog visitId={visit.id} />
          <div className="ml-auto">
            {visit.is_deleted ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-primary"
                disabled={pending}
                onClick={() => toggleDeleted(false)}
              >
                <RotateCcw className="size-4" />
                復元
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive"
                disabled={pending}
                onClick={() => toggleDeleted(true)}
              >
                <Trash2 className="size-4" />
                削除
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
