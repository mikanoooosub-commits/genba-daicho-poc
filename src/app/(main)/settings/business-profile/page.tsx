import { BusinessProfileForm } from "@/components/estimates/business-profile-form";
import { getBusinessProfile } from "@/lib/data/queries-estimates";

export const dynamic = "force-dynamic";

// 事業者情報の設定(WO-011 段階3・SPEC-v2 §3.11)。1行だけ。見積書(と、段階4 の請求書)に載る。
export default async function BusinessProfilePage() {
  const profile = await getBusinessProfile();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>事業者情報</h1>
          <p className="sub">見積書に載せる、自分の屋号・住所・電話・登録番号・お振込先です。研修では架空の値が入っています。</p>
        </div>
      </div>
      {profile ? (
        <section className="card card-pad">
          <BusinessProfileForm profile={profile} />
        </section>
      ) : (
        <div className="notice notice-warn" role="status">
          <div>事業者情報が見つかりません。管理者に連絡してください。</div>
        </div>
      )}
    </>
  );
}
