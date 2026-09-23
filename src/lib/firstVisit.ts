/**
 * Whether this browser has been here before, known before the first paint.
 *
 * The timer's welcome row is for somebody new. The server cannot tell who is
 * new — that lives in this browser's storage — so it sends the row to everyone,
 * and this script, run in the page head before anything is drawn, marks the
 * page for anybody who has been welcomed or has solved. CSS hides the row on a
 * marked page. The alternative, adding the row once the page is running,
 * pushed the whole timer down under a new visitor's eyes.
 */
export const WELCOMED_KEY = "cubeduel:welcomed";
export const HISTORY_KEY = "cubeduel.history.v1";

/** Set on <html> for a returning visitor. */
export const WELCOMED_ATTR = "data-welcomed";

export const welcomedScript = `(function(){try{var s=window.localStorage;var h=JSON.parse(s.getItem(${JSON.stringify(
  HISTORY_KEY,
)})||"null");if(s.getItem(${JSON.stringify(WELCOMED_KEY)})!==null||(h&&h.solves&&h.solves.length>0))document.documentElement.setAttribute(${JSON.stringify(
  WELCOMED_ATTR,
)},"")}catch(e){document.documentElement.setAttribute(${JSON.stringify(WELCOMED_ATTR)},"")}})()`;
