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
import { InvoiceForm } from "@/components/ledger/invoice-form";
import { createInvoiceAction } from "@/lib/data/actions-ledger";

/** 現場詳細画面から、この現場に紐づく請求を新規登録するボタン(現場は固定・選択UI無し) */
export function SiteInvoiceAddButton({ siteId, buildingName }: { siteId: string; buildingName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          請求を追加
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>請求を登録</DialogTitle>
        </DialogHeader>
        <InvoiceForm
          fixedSiteId={siteId}
          fixedSiteLabel={buildingName}
          submitLabel="登録する"
          onSubmit={createInvoiceAction}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
