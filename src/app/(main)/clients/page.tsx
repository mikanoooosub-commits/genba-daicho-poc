import { AppHeader } from "@/components/app-header";
import { ClientManager } from "@/components/clients/client-manager";
import { getClients } from "@/lib/data/queries-sites";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const clients = await getClients();

  return (
    <>
      <AppHeader title="発注元マスタ" subtitle="管理会社・FC本部などの管理" />
      <main className="px-4 py-4">
        <ClientManager clients={clients} />
      </main>
    </>
  );
}
