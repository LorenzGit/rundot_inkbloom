# Inkbloom — monetization brief

Completed before the save schema, economy, or analytics contract were locked.
The typed form of every decision below lives in
`src/systems/monetizationConfig.ts`; this document is the reasoning.

## The constraint everything follows from

Inkbloom is a game about finding things out. Therefore **nothing may be sold
that makes finding things out easier to skip.** All twenty secrets, all ten
inks, the sandbox, and the daily page are free forever. What is sold is a
different *surface* to work on, a tool to work with, and patience — not
answers.

## Model

Hybrid: one durable purchase, one player-initiated rewarded placement.

**Non-payer promise.** Every one of the twenty secrets, all ten inks, the daily
prompt, and one free nudge each day are available without spending anything. No
ad is ever required to play, and none is shown unprompted.

**First exposure.** The Kit is offered only after four discoveries — the moment
the loop is legible and the shelf has already handed the player a new ink for
it. Before that, no monetization surface appears anywhere in the game.

## The product — The Illuminator's Kit

| | |
| --- | --- |
| Catalog item | `inkbloom_illuminators_kit` |
| Entitlement | `inkbloom_illuminators_kit` (non-consumable, quantity 1, unique) |
| Architecture | RUN Shop + Entitlements |
| Launch price | **400 RB** |
| Refund | Eligible, 24-hour window |

**Contents**

1. Three additional sheets — Vellum, Nocturne and Blueprint. This is the real
   draw: on the two dark sheets the ink layer *screens* instead of multiplying,
   so every ink stops being a stain and becomes a light. The same twenty
   secrets, in a completely different register.
2. The mirror nib — paint one side of the page, get both.
3. Nudges with no daily limit and no video.

**Why Shop + Entitlements rather than low-level RB.** The benefit is permanent
and cross-device, so it needs the server catalog, idempotent orders, an order
ledger to reconcile an interrupted checkout against, refund support, and
authoritative ownership that a reinstalled client cannot invent.

**Price rationale.** A launch hypothesis, not a fact. Evidence from durable
products shipped in this workspace: single cosmetic/starter tiers cluster at
300–500 RB; a permanent ad-free-plus-economy unlock sits at 1200 RB. The Kit is
a content-and-utility durable — heavier than one cosmetic, materially lighter
than an ad-free-forever unlock — so it launches in the middle of that band at
400 RB.

**Rollback signal.** If offer-view→purchase conversion sits under 1.0% after
2,000 eligible views, or refund rate exceeds 4%, re-test at 300 RB. Price is a
LiveOps-configurable catalog value; no build is required to change it.

## The placement — A Nudge from the Margin

| | |
| --- | --- |
| Placement id | `inkbloom_margin_nudge_rewarded` |
| Type | Rewarded video, always player-initiated |
| Reward | One nudge: a marginal note beside one specific unfound secret |
| Unlock | At least one discovery found |
| Cooldown | 45 s |
| Caps | 6 per session, 3 per day |
| Kit owners | Placement is hidden — they already have unlimited nudges |
| No fill | Disabled with an honest reason; never a free grant |

**Why only rewarded, and why only one.** A calm sandbox has no natural break
that an interstitial could occupy without damaging the thing people came for.
None is defined, and `interstitialAdsEnabled` ships `false`. The rewarded
placement is never surfaced during play — it exists only inside Field Notes,
next to a line the player chose to look at.

**Why a nudge is not an answer.** Each hint names the inks involved and leaves
the arrangement to the player: *"grit is thirsty. give it something to drink."*
The nudge economy has four sources in order of preference — one free every day,
one more for keeping the daily prompt, a rewarded video (capped), and the Kit's
unlimited supply. A player who never watches an ad and never pays still gets
two nudges a day on top of ordinary play.

## Safety posture

Enforced in `src/systems/monetization.ts`, and asserted by
`scripts/check-game.mjs`:

- Ownership is **read from host entitlements** and never inferred from a tap, a
  started checkout, or an analytics event.
- An unreachable host neither grants nor revokes: a `null` entitlement quantity
  keeps the last known state, so an offline player does not lose paid sheets,
  while a *new* grant is refused.
- A refund that takes the entitlement away also takes back its benefits — the
  sheet reverts to Rag and the mirror nib turns off.
- A rewarded nudge is granted only when the host reports the video completed.
- Idempotency keys come from Web Crypto; there is no weaker fallback.
- An interrupted checkout persists its intent in the versioned save and is
  reconciled against order history on the next boot. Background reconciliation
  never reopens checkout; only a fresh, explicit player tap retries — with the
  original idempotency key, so it cannot double-charge.
- Unconfigured platform ids, absent LiveOps, or a missing host capability leave
  every surface hidden or disabled with an honest message.

## Telemetry

Through `monetizationTelemetry`, which is fire-and-forget and never decides
ownership or rewards: `offer_viewed`, `purchase_tapped`, `checkout_started`,
`checkout_result`, `entitlement_synced`, `ad_requested`, `ad_result`,
`reward_granted`, plus the game's own `discovery_found`, `nudge_spent`,
`ink_unlocked`, `sheet_torn`, `sheet_selected` and `daily_prompt_kept`.

**Primary KPIs:** Kit offer conversion, rewarded-nudge completion rate, and D7
retention split by exposure cohort.

**Guardrails:** D1/D7 retention by whether the player was ever shown the offer;
session length and page-tear rate before versus after an offer or ad; the share
of discoveries that were hinted at all, and the free-to-rewarded nudge ratio;
checkout and rewarded-ad error rates excluding player cancellation.

## QA matrix

| Case | Expected |
| --- | --- |
| No RUN host (`npm run dev`) | Surfaces visible, disabled, honest reasons; nothing granted |
| Host without ads capability | Nudge control visible, disabled, "no video here — RUN only" |
| LiveOps absent or malformed | All monetization dark |
| LiveOps present, product disabled | Kit shown as unavailable |
| Rewarded ad cancelled early | Toast, no nudge, cap not consumed |
| Rewarded ad completed | Exactly one nudge, cap consumed, day recorded |
| Daily cap reached | Control visible, disabled, "no more nudges today" |
| Checkout cancelled | Intent cleared, nothing granted |
| Checkout interrupted | Intent persisted; reconciled on next boot |
| Entitlement present on a fresh install | Kit restored without a second purchase |
| Refund processed | Kit benefits removed, sheet reverts to Rag |
