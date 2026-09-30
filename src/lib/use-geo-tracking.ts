"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type TrackedPosition = { lat: number; lng: number; accuracy: number };

/**
 * 現在地トラッキング用フック。
 * - ON で watchPosition 開始（画面反映は 5 秒間隔に間引き）、OFF で clearWatch
 * - deviceorientation で方位（コンパス角）を取得（間引きあり）
 * - iOS は toggle（＝ユーザー操作）起点で DeviceOrientationEvent.requestPermission() を呼ぶ
 *   許可されない場合は heading=null（向きなし表示にフォールバック）
 */
export function useGeoTracking() {
  const [tracking, setTracking] = useState(false);
  const [position, setPosition] = useState<TrackedPosition | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastPosAtRef = useRef(0);
  const lastHeadAtRef = useRef(0);
  const orientHandlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (orientHandlerRef.current) {
      window.removeEventListener(
        "deviceorientationabsolute",
        orientHandlerRef.current as EventListener,
        true
      );
      window.removeEventListener(
        "deviceorientation",
        orientHandlerRef.current as EventListener,
        true
      );
      orientHandlerRef.current = null;
    }
    setTracking(false);
    setPosition(null);
    setHeading(null);
    setError(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("この端末では現在地を取得できません");
      return;
    }

    // iOS: 向きの利用許可（ユーザー操作起点で呼ぶ必要がある）
    let orientationAllowed = true;
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        orientationAllowed = (await DOE.requestPermission()) === "granted";
      } catch {
        orientationAllowed = false;
      }
    }

    if (orientationAllowed) {
      const handler = (e: DeviceOrientationEvent) => {
        const now = Date.now();
        if (now - lastHeadAtRef.current < 250) return; // 間引き
        const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
        let h: number | null = null;
        if (typeof ev.webkitCompassHeading === "number" && !Number.isNaN(ev.webkitCompassHeading)) {
          h = ev.webkitCompassHeading; // iOS: 既にコンパス角（北=0, 時計回り）
        } else if (e.absolute && typeof e.alpha === "number") {
          h = 360 - e.alpha; // 絶対方位が取れる端末
        }
        if (h != null) {
          lastHeadAtRef.current = now;
          setHeading(((h % 360) + 360) % 360);
        }
      };
      orientHandlerRef.current = handler;
      window.addEventListener("deviceorientationabsolute", handler as EventListener, true);
      window.addEventListener("deviceorientation", handler as EventListener, true);
    }

    lastPosAtRef.current = 0;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        // 画面反映は 5 秒間隔に間引き（初回は即時）
        if (lastPosAtRef.current !== 0 && now - lastPosAtRef.current < 5000) return;
        lastPosAtRef.current = now;
        setPosition({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError("位置情報が許可されていません。設定をご確認ください。");
        } else {
          setError("現在地を取得できませんでした。");
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );

    setTracking(true);
  }, []);

  const toggle = useCallback(() => {
    if (tracking) stop();
    else void start();
  }, [tracking, start, stop]);

  useEffect(() => () => stop(), [stop]);

  return { tracking, position, heading, error, toggle };
}
