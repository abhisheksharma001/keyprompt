/**
 * The card's buddy: a penguin who keeps keys in an ice vault. Inline SVG and
 * CSS only (invariant 5). Its pose comes from `data-mood` on the `.buddy`
 * element: each optional part names the moods that show it (`data-show`) or
 * hide it (`data-hide`), and buddyStyle() turns that into CSS.
 */

/**
 * Every mood with its caption, word for word from the buddy table in
 * docs/prd/card-v2.md. `{store}` is the store label. `oops` has no caption of
 * its own: the card shows the error message as it came.
 *
 * @type {{ id: string, caption: string | null }[]}
 */
export const MOODS = [
  { id: 'listening', caption: 'Paste it here. It goes to your {store}, not into the chat.' },
  { id: 'peek-proof', caption: 'Not looking.' },
  { id: 'watching', caption: 'This box is shown on screen.' },
  { id: 'stashing', caption: 'Putting it away…' },
  { id: 'locked', caption: 'Locked in your {store}.' },
  { id: 'one-run', caption: 'Handed to this one command. Not saved.' },
  { id: 'skipped', caption: 'Nothing was saved. The command gets no value from this card.' },
  { id: 'later', caption: 'Okay, later. Nothing was saved.' },
  { id: 'bye', caption: 'Cancelled. Nothing was saved.' },
  { id: 'asleep', caption: 'This card timed out. Nothing was saved.' },
  { id: 'oops', caption: null },
  { id: 'closed', caption: 'This card is no longer active. You can close this tab.' },
]

/** Caption by mood id. */
export const CAPTIONS = Object.fromEntries(MOODS.map((mood) => [mood.id, mood.caption]))

/**
 * Captions that replace a mood's own where it would not be true (invariant 9).
 * `oneRun`: "Remember on this computer" is unticked, so the value goes to one
 * command and not to the store. `demo`: a demo card has no store and saves
 * nothing.
 */
export const CAPTION_VARIANTS = {
  oneRun: {
    listening: 'Paste it here. It goes to this one command, not into the chat.',
    stashing: 'Handing it over…',
  },
  demo: {
    listening: 'Try it: type anything. Nothing is saved.',
    stashing: 'Pretending to put it away…',
    locked: 'Nothing was saved. This is how a real save looks.',
  },
}

/**
 * The creature and its vault, one inline SVG. No colour is written here: every
 * fill and stroke comes from a class that buddyStyle() maps to a CSS variable.
 *
 * @param {string} [mood]
 */
export function buddySvg(mood = 'listening') {
  return `<svg class="buddy" data-mood="${mood}" viewBox="0 0 160 112" width="144" height="101" aria-hidden="true" focusable="false">
<ellipse class="f-shadow" cx="82" cy="106" rx="66" ry="3.5"/>
<g class="vault">
<rect class="f-ice s-edge" x="100" y="44" width="50" height="58" rx="9" stroke-width="2"/>
<path class="f-snow" d="M100 54C100 47 104 43 110 43H140C146 43 150 47 150 54C147 51 144 55 140 52C136 56 132 52 128 55C124 52 120 56 116 53C112 56 108 52 104 55C102 53 101 55 100 54Z"/>
<g class="door" data-hide="stashing">
<rect class="f-door s-edge" x="110" y="58" width="31" height="36" rx="5" stroke-width="1.5"/>
<circle class="f-edge" cx="113.5" cy="62.5" r="1.2"/><circle class="f-edge" cx="113.5" cy="89.5" r="1.2"/>
<path class="s-edge" d="M136.5 73v6" stroke-width="2.5"/>
<g class="dial"><circle class="f-paper s-ink" cx="125.5" cy="76" r="7" stroke-width="1.8"/><path class="s-ink" d="M125.5 76v-5" stroke-width="1.8"/><circle class="f-ink" cx="125.5" cy="76" r="1.3"/></g>
</g>
<g class="sparkle" data-show="locked">
<path class="f-gold" d="M146 31l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z"/>
<path class="f-gold" d="M154 41l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/>
</g>
<g class="door-open" data-show="stashing">
<rect class="f-deep" x="110" y="58" width="31" height="36" rx="5"/>
<path class="f-door s-edge" d="M141 58l8-4v44l-8-4z" stroke-width="1.5"/>
</g>
<g class="note" data-show="later"><g transform="rotate(-7 127 61)">
<rect class="f-note" x="114" y="51.5" width="26" height="19" rx="1.5"/>
<text class="t-ink" x="127" y="64" text-anchor="middle" font-size="7.5" font-weight="700">later</text>
</g></g>
<g class="sign" data-show="closed">
<path class="s-edge" d="M113.5 58l12-8.5 12 8.5" stroke-width="1.4"/>
<circle class="f-edge" cx="125.5" cy="49.5" r="1.5"/>
<rect class="f-paper s-ink" x="107.5" y="57" width="36" height="13" rx="2.5" stroke-width="1.4"/>
<text class="t-ink" x="125.5" y="66.2" text-anchor="middle" font-size="7" font-weight="700" letter-spacing=".6">CLOSED</text>
</g>
</g>
<g class="pg">
<ellipse class="f-gold" cx="45" cy="103" rx="8" ry="3.5"/><ellipse class="f-gold" cx="67" cy="103" rx="8" ry="3.5"/>
<g class="body">
<path class="s-body" d="M56 32V21M56 26h4.5" stroke-width="3.4"/>
<circle class="s-body" cx="56" cy="15.5" r="4.6" stroke-width="3.4"/>
<ellipse class="f-body" cx="56" cy="66" rx="30" ry="36"/>
<path class="f-belly" d="M56 43C50 35 36 37 36 50c0 9 8 15 20 15s20-6 20-15c0-13-14-15-20-7z"/>
<ellipse class="f-belly" cx="56" cy="81" rx="21" ry="20"/>
<circle class="f-cheek" cx="43.5" cy="57.5" r="2.6"/><circle class="f-cheek" cx="68.5" cy="57.5" r="2.6"/>
<path class="f-gold" d="M51.5 55q4.5-2.5 9 0-2.5 5-4.5 5.5-2-.5-4.5-5.5z"/>
<path class="f-scarf" d="M25 62q31 12 62 0v8q-31 12-62 0z"/>
<path class="f-scarf" d="M35 69l8 2-2 17-9-2z"/>
<path class="s-scarf" d="M34.5 77l7.5 1.5M33.5 82l7.5 1.5" stroke-width="1.6"/>
</g>
<g class="eyes" data-hide="peek-proof locked bye asleep">
<circle class="f-ink" cx="49" cy="50" r="3.4"/><circle class="f-ink" cx="63" cy="50" r="3.4"/>
<circle class="f-paper" cx="50.2" cy="48.8" r="1.1"/><circle class="f-paper" cx="64.2" cy="48.8" r="1.1"/>
</g>
<g class="happy" data-show="locked bye"><path class="s-ink" d="M45.5 51q3.5-4.5 7 0M59.5 51q3.5-4.5 7 0" stroke-width="2.2"/></g>
<g class="lids" data-show="asleep"><path class="s-ink" d="M45.5 50q3.5 3.5 7 0M59.5 50q3.5 3.5 7 0" stroke-width="2"/></g>
<g class="brows" data-show="oops"><path class="s-ink" d="M45 44l7-2.5M67 44l-7-2.5" stroke-width="1.8"/></g>
<g class="sweat" data-show="oops"><path class="f-edge" d="M84 32q4 6.5 0 9.5-4-3 0-9.5z"/></g>
<g class="arms">
<path class="f-wing" data-hide="peek-proof" d="M30 60C20 68 17 82 22 90c5-5 9-14 10-22z"/>
<path class="f-wing" data-hide="peek-proof stashing one-run bye" d="M82 60c10 8 13 22 8 30-5-5-9-14-10-22z"/>
<path class="f-wing" data-show="peek-proof" d="M29 66C30 54 40 45 50 46c5 .5 6 6 2 8-7 3-15 8-19 16z"/>
<path class="f-wing" data-show="peek-proof" d="M83 66C82 54 72 45 62 46c-5 .5-6 6-2 8 7 3 15 8 19 16z"/>
<path class="f-wing" data-show="stashing one-run" d="M82 61c10-2 19-1 23 3 2 3-1 6-6 6-7 1-13 2-17 2z"/>
<path class="f-wing" data-show="bye" d="M80 68c2-10 8-22 15-28 4-3 8 0 5 5-4 8-9 17-14 25z"/>
</g>
<g class="key" data-show="stashing">
<circle class="s-gold" cx="108.5" cy="66" r="3.6" stroke-width="2.2"/>
<path class="s-gold" d="M112 66h11M119 66v3.5M122 66v3" stroke-width="2.2"/>
</g>
<g class="envelope" data-show="one-run">
<rect class="f-paper s-ink" x="101" y="60" width="18" height="12.5" rx="1.6" stroke-width="1.4"/>
<path class="s-ink" d="M101.6 61l8.4 6.4 8.4-6.4" stroke-width="1.4"/>
</g>
</g>
<g class="zzz" data-show="asleep">
<text class="t-muted" x="80" y="31" font-size="8" font-weight="700">z</text>
<text class="t-muted" x="87" y="22" font-size="10" font-weight="700">z</text>
<text class="t-muted" x="95" y="12" font-size="12" font-weight="700">Z</text>
</g>
</svg>`
}

/**
 * How long the key takes to go into the vault, in ms. After a successful save
 * the card waits for what is left of it before the done screen, so it stays
 * under 1.2 s (S-13).
 */
export const STASH_MS = 600

/** Curves for the buddy's motion: arriving, swinging shut, travelling, breathing. */
const EASE = {
  out: 'cubic-bezier(.25,1,.5,1)',
  in: 'cubic-bezier(.5,0,.75,0)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  loop: 'cubic-bezier(.37,0,.63,1)',
}

/**
 * One keyframe set per mood. Only transform and opacity move, only listening
 * and asleep loop, and a part with a still transform ends on it. Reduced
 * motion turns all of it off, which leaves the still poses.
 */
function motionStyle() {
  return `.buddy .door { transform-box: fill-box; transform-origin: 100% 50%; }
  .buddy .key, .buddy .note, .buddy .sparkle { transform-box: fill-box; transform-origin: center; }
  .buddy .arms [data-show~="bye"] { transform-box: view-box; transform-origin: 82px 70px; }
  @keyframes b-bob { 0%, 100% { transform: none; } 50% { transform: scale(.99, 1.02); } }
  @keyframes b-arms-up { from { transform: translateY(10px); } }
  @keyframes b-key-in { 70% { transform: translate(10px, 9px) scale(.9); opacity: 1; } to { transform: translate(11px, 10px) scale(.6); opacity: 0; } }
  @keyframes b-door-shut { from { transform: scaleX(.2); } }
  @keyframes b-dial { from { transform: rotate(-135deg); } to { transform: rotate(135deg); } }
  @keyframes b-pop { from { transform: scale(.9); opacity: 0; } }
  @keyframes b-hand-over { 66% { transform: translate(3px, -10px); opacity: 1; } to { transform: translate(5px, -22px); opacity: 0; } }
  @keyframes b-land { from { transform: translateY(-6px) rotate(5deg); opacity: 0; } }
  @keyframes b-wave { 30% { transform: rotate(-14deg); } 70% { transform: rotate(9deg); } }
  @keyframes b-float { 0% { transform: translateY(3px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(3px, -5px); opacity: 0; } }
  @keyframes b-shake { 0%, 100% { transform: rotate(-5deg); } 25% { transform: rotate(-9deg); } 50% { transform: rotate(-2deg); } 75% { transform: rotate(-6.5deg); } }
  .buddy[data-mood="listening"] .pg { animation: b-bob 2.4s ${EASE.loop} infinite; }
  .buddy[data-mood="peek-proof"] .arms [data-show~="peek-proof"] { animation: b-arms-up 200ms ${EASE.out}; }
  .buddy[data-mood="stashing"] .key { animation: b-key-in ${STASH_MS}ms ${EASE.inOut} forwards; }
  .buddy[data-mood="locked"] .door { animation: b-door-shut 250ms ${EASE.in}; }
  .buddy[data-mood="locked"] .dial { animation: b-dial 400ms ${EASE.out} 250ms backwards; }
  .buddy[data-mood="locked"] .sparkle { animation: b-pop 250ms ${EASE.out} 650ms backwards; }
  .buddy[data-mood="one-run"] .envelope { animation: b-hand-over 900ms ${EASE.out} forwards; }
  .buddy[data-mood="later"] .note { animation: b-land 300ms ${EASE.out}; }
  .buddy[data-mood="bye"] .arms [data-show~="bye"] { animation: b-wave 500ms ${EASE.loop} 2; }
  .buddy[data-mood="asleep"] .zzz text { animation: b-float 3s ${EASE.loop} infinite backwards; }
  .buddy[data-mood="asleep"] .zzz text:nth-child(2) { animation-delay: 1s; }
  .buddy[data-mood="asleep"] .zzz text:nth-child(3) { animation-delay: 2s; }
  .buddy[data-mood="oops"] .pg { animation: b-shake 300ms ${EASE.out}; }
  @media (prefers-reduced-motion: reduce) { .buddy, .buddy * { animation: none !important; } }`
}

/** Fill and stroke classes, each mapped to one of the buddy's colour variables. */
const PAINT = {
  f: { body: 'body', wing: 'wing', belly: 'belly', gold: 'gold', scarf: 'scarf', cheek: 'cheek', ice: 'ice', snow: 'snow', door: 'door', deep: 'deep', edge: 'edge', paper: 'paper', ink: 'ink', note: 'note' },
  s: { body: 'body', edge: 'edge', ink: 'ink', gold: 'gold', scarf: 'scarf-dark' },
}

/**
 * The buddy's stylesheet: its colours for light and dark, which parts each
 * mood shows, where it looks, and how it moves.
 */
export function buddyStyle() {
  const paint = [
    ...Object.entries(PAINT.f).map(([cls, v]) => `.buddy .f-${cls}{fill:var(--b-${v})}`),
    ...Object.entries(PAINT.s).map(([cls, v]) => `.buddy .s-${cls}{stroke:var(--b-${v})}`),
  ]
  const poses = MOODS.flatMap(({ id }) => [
    `.buddy[data-mood="${id}"] [data-show~="${id}"]{display:inline}`,
    `.buddy[data-mood="${id}"] [data-hide~="${id}"]{display:none}`,
  ])
  return `  .buddy {
    --b-body: oklch(0.43 0.075 248); --b-wing: oklch(0.36 0.07 250); --b-belly: oklch(0.985 0.008 85);
    --b-gold: oklch(0.84 0.14 88); --b-scarf: oklch(0.63 0.18 20); --b-scarf-dark: oklch(0.5 0.16 20);
    --b-cheek: oklch(0.82 0.08 12); --b-ice: oklch(0.95 0.03 230); --b-snow: oklch(0.995 0.004 230);
    --b-door: oklch(0.9 0.045 232); --b-deep: oklch(0.33 0.05 248); --b-edge: oklch(0.72 0.075 235);
    --b-paper: oklch(0.99 0.004 250); --b-ink: oklch(0.25 0.03 255); --b-note: oklch(0.92 0.13 98);
    flex: none; width: 144px; height: auto; overflow: visible;
  }
  @media (prefers-color-scheme: dark) {
    .buddy {
      --b-body: oklch(0.6 0.075 248); --b-wing: oklch(0.52 0.07 250); --b-belly: oklch(0.95 0.01 85);
      --b-gold: oklch(0.83 0.13 88); --b-scarf: oklch(0.67 0.17 20); --b-scarf-dark: oklch(0.55 0.15 20);
      --b-cheek: oklch(0.78 0.08 12); --b-ice: oklch(0.31 0.045 240); --b-snow: oklch(0.9 0.015 235);
      --b-door: oklch(0.38 0.055 240); --b-deep: oklch(0.19 0.03 248); --b-edge: oklch(0.58 0.08 238);
      --b-paper: oklch(0.96 0.005 250); --b-ink: oklch(0.22 0.03 255); --b-note: oklch(0.86 0.12 98);
    }
  }
  @media (max-width: 400px) { .buddy { width: 96px; } }
  .buddy * { fill: none; }
  .buddy [class*="s-"] { stroke-linecap: round; stroke-linejoin: round; }
  .buddy .t-ink { fill: var(--b-ink); }
  .buddy .t-muted { fill: var(--muted); }
  .buddy .f-shadow { fill: var(--line); }
  .buddy [data-show] { display: none; }
  .buddy .pg { transform-box: fill-box; transform-origin: 50% 100%; }
  .buddy .dial { transform-box: fill-box; transform-origin: center; }
  .buddy[data-mood="locked"] .dial { transform: rotate(135deg); }
  .buddy[data-mood="listening"] .eyes { transform: translate(1px, 1.5px); }
  .buddy[data-mood="watching"] .eyes { transform: translate(0, 2.6px); }
  .buddy[data-mood="stashing"] .eyes, .buddy[data-mood="one-run"] .eyes { transform: translate(2.2px, 0); }
  .buddy[data-mood="later"] .eyes, .buddy[data-mood="closed"] .eyes { transform: translate(2px, -0.8px); }
  .buddy[data-mood="oops"] .eyes { transform: translate(-1.6px, 0.4px); }
  .buddy[data-mood="oops"] .pg { transform: rotate(-5deg); }
  .buddy[data-mood="asleep"] .pg { transform: rotate(4deg); }
  ${paint.join('\n  ')}
  ${poses.join('\n  ')}
  ${motionStyle()}`
}
