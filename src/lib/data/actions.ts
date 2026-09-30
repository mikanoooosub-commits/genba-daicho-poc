"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { VisitInput, ActionResult, VisitLog, VisitLogWithUser } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 学校＋立ち位置に一致する location を探し、無ければ作成して id を返す */
async function resolveLocationId(
  supabase: SupabaseClient,
  schoolId: string,
  spot: string
): Promise<string> {
  const trimmedSpot = spot.trim();

  const { data: existing } = await supabase
    .from("locations")
    .select("id")
    .eq("school_id", schoolId)
    .eq("spot", trimmedSpot)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from("locations")
    .insert({ school_id: schoolId, spot: trimmedSpot })
    .select("id")
    .single();
  if (error) throw error;
  return created.id as string;
}

// ── 配布履歴 ────────────────────────────────────────────────────────────────

/** 座標が指定されていれば location に反映する */
async function applyCoords(
  supabase: SupabaseClient,
  locationId: string,
  lat: number | null,
  lng: number | null
) {
  if (lat != null && lng != null) {
    await supabase.from("locations").update({ lat, lng }).eq("id", locationId);
  }
}

/** 既存location指定ならそれを使い、無ければ school+spot で解決して座標も反映 */
async function resolveVisitLocation(supabase: SupabaseClient, input: VisitInput): Promise<string> {
  if (input.locationId) return input.locationId;
  const locationId = await resolveLocationId(supabase, input.schoolId, input.spot);
  await applyCoords(supabase, locationId, input.lat, input.lng);
  return locationId;
}

export async function createVisitAction(input: VisitInput): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const locationId = await resolveVisitLocation(supabase, input);

    const { error } = await supabase.from("visits").insert({
      location_id: locationId,
      date: input.date,
      start_time: input.startTime,
      end_time: input.endTime,
      count: input.count,
      rating: input.rating,
      memo: input.memo,
    });
    if (error) throw error;

    revalidatePath("/");
    revalidatePath("/list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "登録に失敗しました" };
  }
}

export async function updateVisitAction(
  visitId: string,
  input: VisitInput
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const locationId = await resolveVisitLocation(supabase, input);

    const { error } = await supabase
      .from("visits")
      .update({
        location_id: locationId,
        date: input.date,
        start_time: input.startTime,
        end_time: input.endTime,
        count: input.count,
        rating: input.rating,
        memo: input.memo,
      })
      .eq("id", visitId);
    if (error) throw error;

    revalidatePath("/");
    revalidatePath("/list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新に失敗しました" };
  }
}

/** 論理削除／復元（トリガーが visit_logs に自動記録する） */
export async function setVisitDeletedAction(
  visitId: string,
  isDeleted: boolean
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("visits")
      .update({ is_deleted: isDeleted })
      .eq("id", visitId);
    if (error) throw error;

    revalidatePath("/");
    revalidatePath("/list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }
}

export async function getVisitLogsAction(visitId: string): Promise<VisitLogWithUser[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("visit_logs")
    .select("*")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const logs = (data ?? []) as VisitLog[];
  const ids = [...new Set(logs.map((l) => l.user_id).filter(Boolean))] as string[];

  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, email, display_name")
      .in("id", ids);
    for (const p of profs ?? []) {
      names[p.id as string] = (p.display_name as string) || (p.email as string) || "";
    }
  }

  return logs.map((l) => ({
    ...l,
    userName: l.user_id ? names[l.user_id] ?? null : null,
  }));
}

// ── 座標の紐付け（地図タブから利用） ────────────────────────────────────────

export async function setLocationCoordsAction(
  locationId: string,
  lat: number,
  lng: number
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("locations")
      .update({ lat, lng })
      .eq("id", locationId);
    if (error) throw error;

    revalidatePath("/");
    revalidatePath("/list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "紐付けに失敗しました" };
  }
}

/** 地図クリックで、座標付きの新規 location を作成する */
export async function createLocationAtAction(
  schoolId: string,
  spot: string,
  lat: number,
  lng: number
): Promise<ActionResult & { locationId?: string }> {
  try {
    if (!schoolId) return { ok: false, error: "小学校を選択してください" };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("locations")
      .insert({ school_id: schoolId, spot: spot.trim(), lat, lng })
      .select("id")
      .single();
    if (error) throw error;

    revalidatePath("/");
    revalidatePath("/list");
    return { ok: true, locationId: data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "作成に失敗しました" };
  }
}

// ── マップメモ ───────────────────────────────────────────────────────────────

export async function createMapNoteAction(
  lat: number,
  lng: number,
  color: string,
  label: string,
  memo: string
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("map_notes").insert({
      lat,
      lng,
      color,
      label: label.trim() || null,
      memo: memo.trim() || null,
    });
    if (error) throw error;

    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "メモの登録に失敗しました" };
  }
}

export async function updateMapNoteAction(
  id: string,
  color: string,
  label: string,
  memo: string,
  lat?: number,
  lng?: number
): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const patch: Record<string, unknown> = {
      color,
      label: label.trim() || null,
      memo: memo.trim() || null,
    };
    if (lat != null && lng != null) {
      patch.lat = lat;
      patch.lng = lng;
    }
    const { error } = await supabase.from("map_notes").update(patch).eq("id", id);
    if (error) throw error;

    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "メモの更新に失敗しました" };
  }
}

export async function deleteMapNoteAction(id: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("map_notes").delete().eq("id", id);
    if (error) throw error;

    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "メモの削除に失敗しました" };
  }
}

// ── 小学校マスタ（Phase 5 で利用） ──────────────────────────────────────────

/** URLを正規化（空なら null、スキーム無しなら https:// を付与） */
function normalizeUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export async function addSchoolAction(
  name: string,
  lat: number | null = null,
  lng: number | null = null,
  url: string = ""
): Promise<ActionResult> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "小学校名を入力してください" };
    const supabase = await createClient();
    const { error } = await supabase
      .from("schools")
      .insert({ name: trimmed, lat, lng, url: normalizeUrl(url) });
    if (error) throw error;

    revalidatePath("/schools");
    revalidatePath("/");
    revalidatePath("/list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "追加に失敗しました" };
  }
}

/** 小学校の名前・URL・座標を更新（座標は指定時のみ） */
export async function updateSchoolAction(
  schoolId: string,
  name: string,
  url: string,
  lat?: number | null,
  lng?: number | null
): Promise<ActionResult> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "小学校名を入力してください" };
    const supabase = await createClient();
    const patch: Record<string, unknown> = { name: trimmed, url: normalizeUrl(url) };
    if (lat != null && lng != null) {
      patch.lat = lat;
      patch.lng = lng;
    }
    const { error } = await supabase.from("schools").update(patch).eq("id", schoolId);
    if (error) throw error;

    revalidatePath("/schools");
    revalidatePath("/");
    revalidatePath("/list");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新に失敗しました" };
  }
}

export async function deleteSchoolAction(schoolId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient();

    // 紐づく location があるか確認（あれば削除を拒否）
    const { count, error: countError } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId);
    if (countError) throw countError;
    if ((count ?? 0) > 0) {
      return { ok: false, error: "この小学校に紐づく配布場所があるため削除できません" };
    }

    const { error } = await supabase.from("schools").delete().eq("id", schoolId);
    if (error) throw error;

    revalidatePath("/schools");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "削除に失敗しました" };
  }
}
