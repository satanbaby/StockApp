# StockApp 即時台股（Tauri + Vue 3 + TypeScript）

Windows System Tray／macOS 選單列即時看盤小工具，資料來源 Fugle MarketData API v1.0。

## 開發

```bash
npm install
npm run tauri dev     # 開發模式
npm test              # 單元測試（均線、WebSocket Manager）
npm run tauri build   # 本機打包（一般改用 GitHub Actions 發布）
```

首次啟動會要求輸入 Fugle API Key（存在本機 `settings.json`，透過 tauri-plugin-store）。

## 發布新版本

安裝檔由 GitHub Actions（`.github/workflows/release.yml`）建置，不需要在本機打包：

```bash
npm version 0.1.1        # 更新版本號（tauri.conf.json 會讀取 package.json），自動 commit 並建立 tag v0.1.1
git push --follow-tags   # 推上 GitHub 後，Actions 自動建置 exe + msi 並發布到 Releases
```

下載：https://github.com/satanbaby/StockApp/releases

### 平台

| 平台 | 安裝檔 | 備註 |
|---|---|---|
| Windows 10/11 x64 | `StockApp_*_x64-setup.exe`、`StockApp_*_x64.msi` | 未簽章，SmartScreen 點「其他資訊 → 仍要執行」 |
| macOS 11+（Universal） | `StockApp_*_universal.dmg` | 未經 Apple 公證，安裝後執行一次 `xattr -dr com.apple.quarantine /Applications/StockApp.app` |

macOS 上面板會從選單列往下彈出、不顯示 Dock 圖示，預設快捷鍵為 `⌘⌥S`。

### 自動更新

- App 啟動 10 秒後與之後每 6 小時檢查 `releases/latest/download/latest.json`，有新版會在面板頂部顯示「立即更新」；設定畫面也可手動「檢查更新」。
- 更新包由 CI 用 GitHub Secrets 中的 `TAURI_SIGNING_PRIVATE_KEY` 簽章，App 以 `tauri.conf.json` 裡的 pubkey 驗證。
- 私鑰備份在本機 `%USERPROFILE%\.tauri\stockapp-updater.key`（不在 repo 中）。**遺失私鑰後，已安裝的 App 將無法再自動更新。**

## 架構

```
Vue UI (components/)
   ↓
Market Store (stores/market.ts, Pinia)
   ↓
Market Service (services/marketService.ts)   ← 不依賴 Vue
   ├─ REST  (services/fugle/restClient.ts)   quote / 今日 1 分 K / 日 K，節流 + 請求去重
   ├─ WebSocket Manager (services/fugle/wsManager.ts)
   └─ DailyCache (services/cache.ts)         日 K 每個交易日只抓一次
```

- **4+1**：最多 4 檔常駐 + 1 檔動態查詢；`WsManager` 以「想要的集合」對帳，
  先送 unsubscribe、等 ack 後才送新的 subscribe，伺服器端訂閱數永遠 ≤ 5。
- **一檔一個訂閱**：一般檢視訂閱 `trades`；切到「盤中籌碼」時該檔改訂 `aggregates`（含最佳五檔與累計內外盤量，
  同時更新價格與走勢），切回時再換回 `trades`，所以加了籌碼檢視訂閱數仍然 ≤ 5。
- 斷線指數退避重連（1s → 30s），重新驗證後自動恢復訂閱並以 REST 重新同步。
- 均線（MA5/10/20/60）由 `indicators/ma.ts` 依日 K 收盤價計算；抓約 200 日曆天（>120 交易日），預設顯示最近 30 根，底部附成交量（張，紅漲綠跌）；可拖曳瀏覽、Ctrl+滾輪縮放、雙擊回到最近 30 日，往左拖到底時自動再載入更早一年的資料（每段各自快取）。
- Tray 彈出面板（類似 OneDrive）：左鍵點 Tray 圖示開／關，面板出現在圖示上方；點面板外面或按 Esc 自動收起。
  「📌 釘住面板」會讓面板置頂且點外面不收起。右鍵選單有「離開程式」。

## 設定（⚙）

- **Fugle API Key**
- **叫出面板快捷鍵**：預設 `Ctrl+Alt+S`，點欄位後直接按下想要的組合鍵即可（需含 Ctrl / Alt / Shift / Win，F1～F12 除外）；被其他程式佔用時會顯示錯誤並保留舊設定。
- **主題**：跟隨系統 / 淺色 / 深色 / 毛玻璃（Windows Acrylic、macOS vibrancy，約 30% 不透明，深淺跟隨系統）/ 透明玻璃（不模糊，視窗底色 15% 白、桌布直接透出；卡片做成內凹的玻璃槽，黑字加白色光暈，K 線圖維持原配色）；標題列的主題按鈕依序輪流切換 ☀ 淺色 → 🌙 深色 → ◐ 毛玻璃 → ◌ 透明玻璃。

## 鍵盤操作

| 按鍵 | 動作 |
|------|------|
| 直接打英數字 | 自動輸入到股票代號框 |
| Enter（輸入框） | 查詢，焦點自動跳到該股票卡片 |
| ← / → | 依序切換「即時走勢」→「30 日 K 線」→「盤中籌碼」（最佳五檔＋內外盤比） |
| Tab / Shift+Tab | 在輸入框與各股票卡片間切換 |
| Enter（查詢卡片） | 釘選為常駐（滿 4 檔時用 ↑/↓ 選擇要取代的股票） |
| Delete（常駐卡片） | 取消釘選 |
| Esc | 輸入框有字時清空，否則收起面板 |
| Ctrl+Alt+S（可自訂） | 在任何程式中開啟／收起面板 |
