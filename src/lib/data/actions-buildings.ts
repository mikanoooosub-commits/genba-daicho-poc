"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { findSimilarBuildings, type SimilarBuilding } from "@/lib/data/queries-buildings";
import type { ActionResult } from "@/lib/types";
import {
  addUnitsInputSchema,
  buildingDeletedInputSchema,
  buildingInputSchema,
  unitDeletedInputSchema,
  updateBuildingInputSchema,
  type AddUnitsInput,
  type BuildingInput,
  type UpdateBuildingInput,
} from "@/lib/validation/building";

// 物件・部屋の Server Actions(WO-011 段階1)。
// クライアントから来る値は無条件に信用せず、必ず zod の safeParse を通してから DB に渡す。
// 物理 DELETE は行わない(論理削除のみ。段階1 では物件の削除操作は作っていない)。
// lat / lng / geo_source は書かない(入力欄が無い。D80)。

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力内容を確認してください";
}

function toNullableText(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** 登録の前に出す「名前が似ている物件」。同じ建物の二重登録を防ぐための案内で、一意にはしない */
export async function findSimilarBuildingsAction(name: string): Promise<SimilarBuilding[]> {
  const parsed = z.string().max(200).safeParse(name);
  if (!parsed.success) return [];
  try {
    return await findSimilarBuildings(parsed.data);
  } catch {
    return [];
  }
}

/**
 * 物件を作り、指定された部屋を足して、物件の詳細へ移る。
 * 部屋の登録に失敗したら、作った物件を論理削除して戻す(物理削除はしない)。
 * 遷移は redirect() で行う(try/catch の外で呼ぶ。catch の中だと通常のエラーとして握りつぶされる)。
 */
export async function createBuildingAction(input: BuildingInput): Promise<ActionResult> {
  const parsed = buildingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const rooms = [...new Set(parsed.data.rooms)];

  let buildingId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("buildings")
      .insert({
        name: parsed.data.name,
        kind: parsed.data.kind,
        address: toNullableText(parsed.data.address),
        default_client_id: parsed.data.defaultClientId ?? null,
        memo: toNullableText(parsed.data.memo),
      })
      .select("id")
      .single();
    if (error) throw error;
    buildingId = z.object({ id: z.string().uuid() }).parse(data).id;

    if (rooms.length > 0) {
      const { error: unitError } = await supabase
        .from("units")
        .insert(rooms.map((room) => ({ building_id: buildingId, room_no: room })));
      if (unitError) {
        await supabase.from("buildings").update({ is_deleted: true }).eq("id", buildingId);
        throw unitError;
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "物件の登録に失敗しました" };
  }

  revalidatePath("/buildings");
  redirect(`/buildings/${buildingId}`);
}

export async function updateBuildingAction(input: UpdateBuildingInput): Promise<ActionResult> {
  const parsed = updateBuildingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("buildings")
      .update({
        name: parsed.data.name,
        kind: parsed.data.kind,
        address: toNullableText(parsed.data.address),
        default_client_id: parsed.data.defaultClientId ?? null,
        memo: toNullableText(parsed.data.memo),
      })
      .eq("id", parsed.data.id);
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "物件の更新に失敗しました" };
  }

  revalidatePath("/buildings");
  redirect(`/buildings/${parsed.data.id}`);
}

/** 既にある物件に部屋を足す。同じ部屋番号は足さずに飛ばす */
export async function addUnitsAction(input: AddUnitsInput): Promise<ActionResult> {
  const parsed = addUnitsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from("units")
      .select("room_no")
      .eq("building_id", parsed.data.buildingId)
      .eq("is_deleted", false);
    if (readError) throw readError;
    const have = new Set(
      (existing ?? []).map((r) => z.object({ room_no: z.string().nullable() }).parse(r).room_no)
    );
    const fresh = [...new Set(parsed.data.rooms)].filter((room) => !have.has(room));
    if (fresh.length === 0) return { ok: false, error: "その部屋番号は、すべて登録済みです" };

    const { error } = await supabase
      .from("units")
      .insert(fresh.map((room) => ({ building_id: parsed.data.buildingId, room_no: room })));
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "部屋の登録に失敗しました" };
  }

  revalidatePath(`/buildings/${parsed.data.buildingId}`);
  revalidatePath("/buildings");
  return { ok: true };
}

/**
 * 物件の論理削除/復元。部屋や施工がぶらさがっていても取り消せる(元に戻せるため。監査ログに残る)。
 * 物件を取り消しても、部屋・施工・請求には触らない(物件の一覧と画面から見えなくなるだけ)。
 * 物理 DELETE はしない。
 */
export async function setBuildingDeletedAction(buildingId: string, isDeleted: boolean): Promise<ActionResult> {
  const parsed = buildingDeletedInputSchema.safeParse({ buildingId, isDeleted });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("buildings")
      .update({ is_deleted: parsed.data.isDeleted })
      .eq("id", parsed.data.buildingId);
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }

  revalidatePath("/buildings");
  revalidatePath(`/buildings/${parsed.data.buildingId}`);
  // 取り消したあとは、見えなくなる詳細ではなく一覧へ(redirect は try/catch の外で呼ぶ)
  if (parsed.data.isDeleted) redirect("/buildings");
  return { ok: true };
}

/** 部屋の論理削除/復元。同じ部屋番号の生きた部屋があると、復元は DB の一意制約で止まる */
export async function setUnitDeletedAction(unitId: string, isDeleted: boolean): Promise<ActionResult> {
  const parsed = unitDeletedInputSchema.safeParse({ unitId, isDeleted });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("units")
      .update({ is_deleted: parsed.data.isDeleted })
      .eq("id", parsed.data.unitId)
      .select("building_id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "同じ部屋番号の部屋が既にあるため、元に戻せません" };
      }
      throw error;
    }
    const buildingId = z.object({ building_id: z.string().uuid() }).parse(data).building_id;
    revalidatePath(`/buildings/${buildingId}`);
    revalidatePath("/buildings");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }
}
