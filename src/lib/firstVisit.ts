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

/**
 * Set on <html> when this browser has solves. The home page shows those
 * visitors their numbers instead of the pitch, and the numbers can only be read
 * once the page runs; this lets CSS hold the room for them before the first
 * paint, where swapping them in afterwards jumped the page by 0.10.
 */
export const RETURNING_ATTR = "data-returning";

export const welcomedScript = `(function(){var d=document.documentElement;try{var s=window.localStorage;var h=JSON.parse(s.getItem(${JSON.stringify(
  HISTORY_KEY,
)})||"null");var solved=!!(h&&h.solves&&h.solves.length>0);if(solved)d.setAttribute(${JSON.stringify(
  RETURNING_ATTR,
)},"");if(s.getItem(${JSON.stringify(WELCOMED_KEY)})!==null||solved)d.setAttribute(${JSON.stringify(
  WELCOMED_ATTR,
)},"")}catch(e){d.setAttribute(${JSON.stringify(WELCOMED_ATTR)},"")}})()`;
