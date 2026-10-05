import Link from "next/link";
import { notFound } from "next/navigation";

import { BuildingForm } from "@/components/buildings/building-form";
import { getBuildingById } from "@/lib/data/queries-buildings";
import { getClients } from "@/lib/data/queries-sites";

export const dynamic = "force-dynamic";

export default async function EditBuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [building, clients] = await Promise.all([getBuildingById(id), getClients()]);
  if (!building) notFound();

  return (
    <>
      <p className="breadcrumb">
        <Link href="/buildings">物件</Link> › <Link href={`/buildings/${building.id}`}>{building.name}</Link> › 編集
      </p>
      <div className="page-head">
        <h1>物件を編集</h1>
      </div>
      <BuildingForm
        mode="edit"
        clients={clients}
        buildingId={building.id}
        initial={{
          name: building.name,
          kind: building.kind,
          address: building.address ?? "",
          defaultClientId: building.default_client_id ?? "",
          memo: building.memo ?? "",
        }}
      />
    </>
  );
}
