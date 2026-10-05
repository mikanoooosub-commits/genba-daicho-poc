import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発用の丸いアイコン(左下の「N」)を出さない。開発時の表示だけで、アプリの動作には影響しない(画面をデッキに載せるため)
  devIndicators: false,
};

export default nextConfig;
