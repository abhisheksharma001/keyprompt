/** The card's stylesheet text. renderCard places it inside the page's <style> element. */
export function cardStyle() {
  return `  :root {
    --bg: #f4f4f5; --card: #ffffff; --text: #18181b; --muted: #71717a; --line: #e4e4e7;
    --field: #fafafa; --accent: #18181b; --accent-text: #ffffff; --err: #b91c1c;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #09090b; --card: #18181b; --text: #fafafa; --muted: #a1a1aa; --line: #27272a;
      --field: #0f0f11; --accent: #fafafa; --accent-text: #09090b; --err: #f87171;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
    background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, sans-serif;
  }
  .card {
    width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,.08);
  }
  .head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  .head-text { flex: 1; min-width: 0; }
  h1 { font-size: 16px; margin: 0 0 8px; font-weight: 600; }
  .caption {
    position: relative; margin: 0; padding: 8px 11px; border-radius: 12px; font-size: 13px; line-height: 1.4;
    background: var(--field); border: 1px solid var(--line);
  }
  .caption::before {
    content: ""; position: absolute; left: -5px; top: 13px; width: 8px; height: 8px; transform: rotate(45deg);
    background: var(--field); border-left: 1px solid var(--line); border-bottom: 1px solid var(--line);
  }
  .caption.err { color: var(--err); }
  .preview { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 14px; font-size: 12px; color: var(--muted); }
  .preview button { padding: 4px 8px; border-radius: 999px; font: 500 12px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  @media (max-width: 400px) { .buddy { width: 96px; } }
  .chip {
    display: inline-block; font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    padding: 6px 9px; border-radius: 8px; background: var(--field); border: 1px solid var(--line);
    word-break: break-all;
  }
  .reason { margin: 12px 0 0; }
  .meta, .hint, .note, footer { color: var(--muted); font-size: 13px; }
  .meta { margin: 6px 0 0; }
  .note { margin: 10px 0 0; }
  .rows { display: grid; gap: 14px; margin-top: 16px; }
  .label { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .tag { font-size: 12px; line-height: 1; color: var(--muted); padding: 4px 7px; border-radius: 999px; border: 1px solid var(--line); }
  .field { display: flex; gap: 8px; margin-top: 6px; }
  .field.stack { flex-direction: column; }
  input[type=password], input[type=text], textarea {
    flex: 1; min-width: 0; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
    background: var(--field); color: var(--text); font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  textarea { flex: none; width: 100%; min-height: 72px; resize: vertical; }
  .value[aria-invalid=true] { border-color: var(--err); }
  .pasted { display: flex; align-items: center; gap: 8px; }
  .count { flex: 1; font-size: 13px; color: var(--muted); }
  input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--card);
    color: var(--text); font: inherit; font-weight: 600; cursor: pointer;
  }
  button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  .check { display: flex; gap: 8px; align-items: center; margin-top: 14px; font-size: 14px; }
  .hint { margin: 4px 0 0 24px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .error { color: var(--err); font-size: 13px; margin: 10px 0 0; min-height: 1em; }
  footer { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; gap: 6px; align-items: center; }
  .done p { margin: 0; color: var(--muted); font-size: 14px; }
  [hidden] { display: none !important; }`
}
