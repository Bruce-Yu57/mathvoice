# 慢慢來｜數學小教室

給台灣國中七至九年級學生使用的繁體中文語音數學家教網站。支援題目文字或一張題目圖片，依序呈現 3–6 個黑板步驟，最後回顧數學重點。

## 模型與金鑰

題目辨識與解題使用 Google Gemini API 的 `gemini-3.8-flash`。後端金鑰名稱為 `GEMINI_API_KEY`，只在部署平台的伺服器端環境變數中設定。**不要把真實金鑰寫入前端、GitHub 檔案或提交紀錄。**

## 部署方式

GitHub repository 用來保存網站原始碼；GitHub Pages 只能提供靜態檔案，無法安全地保管 Gemini 金鑰或執行 `/api/solve`。要讓照片辨識、AI 解題及相機功能可供學生跨裝置使用，請將 GitHub repository 連接到支援 Node.js functions 的 HTTPS 託管服務，例如 Vercel，並設定：

1. 專案根目錄為 repository 根目錄，Node.js 20 或更新版本。
2. 在託管平台的伺服器端環境變數新增 `GEMINI_API_KEY`。
3. 部署後，使用部署網址測試手機照片、剪貼簿圖片及文字題目。

`api/solve.js` 會把圖片或文字送至 Google Gemini API。本站後端不會將題目圖片保存到磁碟或資料庫；題目會交由 Google Gemini 處理。圖片超過大小限制時，瀏覽器會先縮小圖片。

## 本機開發

安裝相依套件並執行 `npm run dev`。在本機 `.env` 設定 `GEMINI_API_KEY`（不要提交 `.env`）。`npm run check` 可檢查 JavaScript 語法。

