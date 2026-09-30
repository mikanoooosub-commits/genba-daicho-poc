"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { VisitForm } from "@/components/visits/visit-form";
import { NoteForm } from "@/components/map/note-form";
import { createVisitAction, createMapNoteAction } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { School } from "@/lib/types";
import type { LocationWithSchool } from "@/lib/data/queries";

/** 配布実績／マップメモの新規登録ダイアログ（地図・一覧の両方から使う） */
export function RegisterDialog({
  schools,
  locations,
  className,
}: {
  schools: School[];
  locations: LocationWithSchool[];
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [registerType, setRegisterType] = useState<"visit" | "note">("visit");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className={cn("w-full gap-2", className)}>
          <Plus className="size-5" />
          登録
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>登録</DialogTitle>
        </DialogHeader>

        {/* 種別トグル */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setRegisterType("visit")}
            className={cn(
              "flex-1 rounded-lg border-2 py-1.5 text-sm font-bold transition-colors",
              registerType === "visit"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground"
            )}
          >
            配布実績
          </button>
          <button
            type="button"
            onClick={() => setRegisterType("note")}
            className={cn(
              "flex-1 rounded-lg border-2 py-1.5 text-sm font-bold transition-colors",
              registerType === "note"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground"
            )}
          >
            マップメモ
          </button>
        </div>

        {registerType === "visit" ? (
          <VisitForm
            schools={schools}
            locations={locations}
            submitLabel="登録する"
            onSubmit={createVisitAction}
            onSuccess={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        ) : (
          <NoteForm
            submitLabel="メモを登録"
            onSubmit={(v) => createMapNoteAction(v.lat, v.lng, v.color, v.label, v.memo)}
            onSuccess={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
