import Link from "next/link";

import { BuildingForm } from "@/components/buildings/building-form";
import { getClients } from "@/lib/data/queries-sites";

export const dynamic = "force-dynamic";

export default async function NewBuildingPage() {
  const clients = await getClients();
  return (
    <>
      <p className="breadcrumb">
        <Link href="/buildings">物件</Link> › 登録
      </p>
      <div className="page-head">
        <div>
          <h1>物件を登録</h1>
          <p className="sub">建物の名前と種類があれば登録できます。部屋や住所はあとから足せます。</p>
        </div>
      </div>
      <BuildingForm mode="create" clients={clients} />
    </>
  );
}
