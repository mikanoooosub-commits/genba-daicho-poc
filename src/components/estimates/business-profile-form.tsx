"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateBusinessProfileAction } from "@/lib/data/actions-estimates";
import type { BusinessProfile } from "@/lib/types";

// 事業者情報の設定(1行だけ。見積書に載る)。登録番号は T + 数字13桁、または空(未登録・免税)。
// 研修では架空の値。実在の番号に見える値は入れない。
export function BusinessProfileForm({ profile }: { profile: BusinessProfile }) {
  const uid = useId();
  const router = useRouter();
  const [shopName, setShopName] = useState(profile.shop_name);
  const [address, setAddress] = useState(profile.address ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [invoiceRegNo, setInvoiceRegNo] = useState(profile.invoice_reg_no ?? "");
  const [bankInfo, setBankInfo] = useState(profile.bank_info ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    startTransition(async () => {
      const result = await updateBusinessProfileAction({ shopName, address, phone, invoiceRegNo, bankInfo });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "var(--sp-4)", maxWidth: 640 }}>
      <div className="field">
        <label htmlFor={`${uid}-shop`}>屋号</label>
        <input id={`${uid}-shop`} className="input" required maxLength={100} value={shopName} onChange={(e) => setShopName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-addr`}>住所<span className="muted"> 任意</span></label>
        <input id={`${uid}-addr`} className="input" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-tel`}>電話<span className="muted"> 任意</span></label>
        <input id={`${uid}-tel`} className="input" maxLength={30} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-reg`}>適格請求書発行事業者の登録番号<span className="muted"> 任意</span></label>
        <input
          id={`${uid}-reg`}
          className="input"
          maxLength={14}
          value={invoiceRegNo}
          onChange={(e) => setInvoiceRegNo(e.target.value)}
          placeholder="T と数字13桁"
          aria-describedby={`${uid}-reg-h`}
        />
        <p id={`${uid}-reg-h`} className="hint">登録していなければ空にします。空のときは、見積書に登録番号を載せません。</p>
      </div>
      <div className="field">
        <label htmlFor={`${uid}-bank`}>お振込先<span className="muted"> 任意</span></label>
        <textarea id={`${uid}-bank`} className="textarea" maxLength={300} value={bankInfo} onChange={(e) => setBankInfo(e.target.value)} />
        <p className="hint">見積書の下に載ります。</p>
      </div>
      {error && (
        <div className="notice notice-danger" role="alert">
          <div>{error}</div>
        </div>
      )}
      {saved && !error && (
        <p className="hint" role="status">
          保存しました。見積書に反映されます。
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "保存しています…" : "保存する"}
        </button>
      </div>
    </form>
  );
}
