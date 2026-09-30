import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発用の丸いアイコン(左下の「N」)を出さない。開発時の表示だけで、アプリの動作には影響しない(画面をデッキに載せるため)
  devIndicators: false,
  // チラトラ由来の /list・/schools は、この DB に対応するテーブルが無く開くとエラーになる。公開 URL では / に戻す
  async redirects() {
    return [
      { source: "/list", destination: "/", permanent: false },
      { source: "/schools", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
