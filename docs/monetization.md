# Inkbloom — monetization brief

Completed before the save schema, economy, or analytics contract were locked.
The typed form of every decision below lives in
`src/systems/monetizationConfig.ts`; this document is the reasoning.

## The constraint everything follows from

Inkbloom is a game about finding things out. Therefore **nothing may be sold
that makes finding things out easier to skip.** All sixty secrets, all eighteen
inks, the sandbox, and the daily page are free forever. What is sold is a
different *surface* to work on, a tool to work with, and patience — not
answers.

## Model

Hybrid. **Two Run Bits products** — a consumable entry tier and a durable —
and **two player-initiated rewarded placements**. No interstitials.

| Tier | Product | Price | Job |
| --- | --- | --- | --- |
| Entry | A Pot of Ink (consumable) | 120 RB | Does a small, clearly-valued first transaction reduce friction? |
| Core | The Illuminator's Kit (durable) | 400 RB | What do engaged players understand and want? |

**Why there is no third, larger pack.** The Kit already gives unlimited nudges
at 400 RB, so any nudge pack priced above roughly a third of it is dominated by
the Kit for exactly the player it would target. A dominated tier is a trap, not
a ladder. The upper tier stays empty until there is a good that is not a nudge
and not already in the Kit.

**Non-payer promise.** Every one of the sixty secrets, all eighteen inks, the daily
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
   so every ink stops being a stain and becomes a light. The same sixty
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

## The second product — A Pot of Ink

| | |
| --- | --- |
| Catalog item | `inkbloom_pot_of_ink` |
| Entitlement | `inkbloom_nudges` (**consumable**, quantity 10, repeatable) |
| Architecture | RUN Shop + Entitlements, with `consumeEntitlement` |
| Launch price | **120 RB** |
| Unlock | One discovery — before that a nudge means nothing |
| Kit owners | Hidden. The Kit already gives unlimited nudges; selling a pot on top would be selling nothing |

Ten nudges that never expire, spent one at a time. The item id and the
entitlement id are deliberately different strings: the item is one purchase of
a pot, the entitlement is the balance it pours into, and a second purchase adds
to the same balance rather than being refused as already owned.

**Spend order.** Free sources go first — the daily nudge, then a prompt nudge,
then the pot. A player who has both should never find that today's free nudge
went unused while their pot drained. The rewarded video stays a separate,
explicit button rather than a fallback, so watching one is always a choice.

**The charge happens before the reveal.** `spendPotNudge()` calls
`consumeEntitlement` and only reveals the note when the server confirms. A host
that cannot be reached returns `unavailable`, nothing is revealed, and the
player still has their pot. Revealing first and consuming after would hand out
a secret for free every time the network was down. The consume captures a
referenceId on the first attempt and reuses it on the retry, so a failure
between the charge and the grant cannot charge twice.

**Price rationale.** A launch hypothesis. It has to be well under a third of
the Kit or the Kit dominates it — at 120 RB, a player who wants ten nudges pays
30% of the Kit for roughly a sixth of the secrets' worth of help, and the Kit
stays the obvious choice for anyone who wants more. Rollback signal: if pot
buyers convert to the Kit at a *lower* rate than non-buyers after 1,000
purchases, the pot is cannibalising rather than laddering — re-test at 80 RB or
withdraw it.

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

## The second placement — Borrow an Ink

| | |
| --- | --- |
| Placement id | `inkbloom_borrow_ink_rewarded` |
| Type | Rewarded video, always player-initiated |
| Reward | The **next** locked bottle joins the shelf until the sheet is torn |
| Trigger | Tapping that locked bottle on the shelf |
| Unlock | At least one discovery found |
| Cooldown | 60 s. Caps: 4 per session, 6 per day, and one loan at a time |
| Kit owners | Same terms as everyone. The Kit sells sheets and tools, never inks |
| No fill | Disabled with an honest reason; never a free grant |

Tapping a bottle you cannot have is the clearest statement of intent in the
game, and until now it answered with a shake and a number — the game declining
a request the player had just made as clearly as they could. Now it answers
with the offer.

**Why this does not sell the finding out.** What is lent is the *material*, not
the answer. A borrowed ink still has to be poured into something to learn what
it does, and the loan ends with the sheet, so progression still comes only from
discoveries. Only ever the **next** locked bottle can be borrowed, so the shelf
still arrives in the order the game intends and the loan previews the reward
instead of replacing it. One loan at a time: two borrowed bottles would be a
shelf the player did not earn, which is the thing the gates exist to prevent.

The loan is deliberately **absent from the save**. A loan that survived a
reinstall would be an ink the player owns, which is not what was offered.

**Guardrail.** D1/D7 retention split by whether the player ever borrowed an
ink. A loan that raises play but lowers retention is a loan that replaced the
reward rather than previewing it — that is the signal to cut the daily cap or
withdraw the placement.

**Why still no interstitial.** A calm sandbox has no natural break that an
interstitial could occupy without damaging the thing people came for. None is
defined, and `interstitialAdsEnabled` ships `false`. Both rewarded placements
are reached by the player pressing something: one inside Field Notes next to a
line they chose to look at, one on a bottle they chose to tap.

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
- A rewarded nudge, and a borrowed ink, are granted only when the host reports
  the video completed.
- A bought nudge is charged through `consumeEntitlement` before anything is
  revealed, and an unreachable host spends nothing and reveals nothing.
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

**Primary KPIs:** Kit offer conversion, pot offer conversion, and rewarded
completion rate split by `placement_id`. (The plan validator caps primary KPIs
at three; retention by exposure cohort lives in the guardrails.)

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
