import prisma from "@/lib/prisma";
import { deriveTeamBilling } from "@/lib/deriveCurrentBoardBilling";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7551_START_PLAN_CHECKOUT_FLAG } from "@/lib/flags/definitions/htpr-7551-start-plan-checkout";
import { resolveSeatQuantity } from "@/lib/resolveSeatQuantity";
import {
  createStripeCheckout,
  findActiveDuplicateSubscription,
  getStripeInstance,
  isLiveSubscription,
} from "@/lib/stripe";
import { storeSubscriptionPlans } from "@/lib/subscriptionPlans";
import type { CreateCheckoutParams, ITeam } from "@/models/model";
import type Stripe from "stripe";
import {
  createCheckoutAttempt,
  effectiveTrialDays,
  desiredMatches,
  billingDesiredMatches,
  withTeamCheckoutReservation,
  readTeamCheckoutAttempt,
  type CheckoutAttempt,
  type CheckoutAttemptDesired,
  type CheckoutMode,
} from "@/utils/controllers/stripe/checkoutReservation";

type CheckoutRequestBody = {
  intent?: unknown;
  action?: unknown;
  boardUrl?: unknown;
  trialDays?: unknown;
  quantity?: unknown;
  cancelUrl?: unknown;
  googleAccountId?: unknown;
  mode?: unknown;
  priceId?: unknown;
  returnUrl?: unknown;
  stripe_customer_id?: unknown;
  teamId?: unknown;
};

export type CheckoutResult = {
  status: number;
  body: {
    canStartPlan?: boolean;
    trialDays?: number;
    finishing?: boolean;
    alreadySubscribed?: true;
    message?: string;
    subscriptionId?: string;
    url?: string | null;
  };
};

function validConfiguredPriceId(
  priceId: string | undefined,
): priceId is string {
  return Boolean(priceId && priceId !== "undefined" && priceId !== "null");
}

const normalCheckoutPriceIds = new Set(
  storeSubscriptionPlans
    .filter((plan) => plan.id === "BYOK" || plan.id === "Pro")
    .flatMap((plan) => plan.types.map((type) => type.stripePriceId))
    .filter(validConfiguredPriceId),
);

const trialCheckoutPriceIds = new Set(
  [process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID].filter(
    validConfiguredPriceId,
  ),
);

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function checkoutMode(value: unknown): CheckoutMode | null {
  return value === "Trial" || value === "Normal" ? value : null;
}

function configuredAppOrigin(): string | null {
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_BASEURL || process.env.NEXT_PUBLIC_APP_URL;
  if (!configuredBaseUrl) return null;

  try {
    return new URL(configuredBaseUrl).origin;
  } catch {
    return null;
  }
}

function isAllowedCheckoutReturnUrl(value: string, appOrigin: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === appOrigin && ["http:", "https:"].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

async function listAllCustomerSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription[]> {
  const subscriptions: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    subscriptions.push(...page.data);

    if (!page.has_more) break;
    const lastSubscription = page.data[page.data.length - 1];
    if (!lastSubscription) {
      throw new Error(
        "Stripe returned an empty subscription page with more results",
      );
    }
    startingAfter = lastSubscription.id;
  } while (startingAfter);

  return subscriptions;
}

function hasHistoricalTrial(subscriptions: Stripe.Subscription[]): boolean {
  return subscriptions.some(
    (subscription) =>
      subscription.status === "trialing" ||
      typeof subscription.trial_start === "number" ||
      typeof subscription.trial_end === "number",
  );
}

async function listTeamCheckoutSessions(
  stripe: Stripe,
  customerId: string,
  teamId: string,
): Promise<Stripe.Checkout.Session[]> {
  const sessions: Stripe.Checkout.Session[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    sessions.push(
      ...page.data.filter((session) => session.metadata?.teamId === teamId),
    );

    if (!page.has_more) break;
    const lastSession = page.data[page.data.length - 1];
    if (!lastSession) {
      throw new Error(
        "Stripe returned an empty checkout page with more results",
      );
    }
    startingAfter = lastSession.id;
  } while (startingAfter);

  return sessions;
}

async function expireCheckoutSessions(
  stripe: Stripe,
  sessions: Stripe.Checkout.Session[],
  assertHeld: () => void,
): Promise<void> {
  for (const session of sessions) {
    assertHeld();
    await stripe.checkout.sessions.expire(session.id);
  }
}

function sessionBillingMatchesDesired(
  session: Stripe.Checkout.Session,
  desired: CheckoutAttemptDesired,
): boolean {
  const sessionCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  return (
    sessionCustomerId === desired.customerId &&
    session.metadata?.teamId === desired.teamId &&
    session.metadata?.googleAccountId === desired.googleAccountId &&
    session.metadata?.priceId === desired.priceId &&
    session.metadata?.checkoutMode === desired.checkoutMode &&
    Number(session.metadata?.trialDays ?? (desired.checkoutMode === "Trial" ? 14 : 0)) === effectiveTrialDays(desired) &&
    session.metadata?.checkoutQuantity === String(desired.quantity)
  );
}

function sessionMatchesDesired(
  session: Stripe.Checkout.Session,
  desired: CheckoutAttemptDesired,
): boolean {
  return (
    Boolean(session.url) &&
    session.success_url === desired.returnUrl &&
    session.cancel_url === desired.cancelUrl &&
    (session.metadata?.checkoutIntent || undefined) === desired.checkoutIntent &&
    sessionBillingMatchesDesired(session, desired)
  );
}

function checkoutSubscriptionId(
  session: Stripe.Checkout.Session,
): string | undefined {
  if (typeof session.subscription === "string") return session.subscription;
  return session.subscription?.id;
}

function isDefinitiveStripeFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { statusCode?: unknown; type?: unknown };
  const statusCode =
    typeof candidate.statusCode === "number" ? candidate.statusCode : null;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    return statusCode !== 409 && statusCode !== 429;
  }
  return (
    candidate.type === "StripeInvalidRequestError" ||
    candidate.type === "StripeAuthenticationError" ||
    candidate.type === "StripePermissionError" ||
    candidate.type === "StripeCardError"
  );
}

async function reconcileAttemptSession(
  stripe: Stripe,
  attempt: CheckoutAttempt,
  openSessions: Stripe.Checkout.Session[],
): Promise<Stripe.Checkout.Session | null> {
  if (attempt.sessionId) {
    return stripe.checkout.sessions.retrieve(attempt.sessionId);
  }
  return (
    openSessions.find(
      (session) => session.metadata?.checkoutAttemptId === attempt.attemptId,
    ) ?? null
  );
}

function checkoutParams(
  attempt: CheckoutAttempt,
  teamTitle: string,
): CreateCheckoutParams {
  const { desired } = attempt;
  return {
    teamTitle,
    ...(desired.trialDays !== undefined ? { trialDays: desired.trialDays } : {}),
    ...(desired.checkoutIntent ? { checkoutIntent: desired.checkoutIntent } : {}),
    googleAccountId: desired.googleAccountId,
    returnUrl: desired.returnUrl,
    priceId: desired.priceId,
    stripe_customer_id: desired.customerId,
    quantity: desired.quantity,
    teamId: desired.teamId,
    mode: desired.checkoutMode,
    cancelUrl: desired.cancelUrl,
    metadata: {
      teamId: desired.teamId,
      googleAccountId: desired.googleAccountId,
      stripe_customer_id: desired.customerId,
      priceId: desired.priceId,
      checkoutMode: desired.checkoutMode,
      checkoutQuantity: String(desired.quantity),
      checkoutAttemptId: attempt.attemptId,
      ...(desired.trialDays !== undefined ? { trialDays: String(desired.trialDays) } : {}),
      ...(desired.checkoutIntent ? { checkoutIntent: desired.checkoutIntent } : {}),
    },
  };
}

export async function createAuthorizedCheckoutSession(
  userId: number,
  rawBody: unknown,
): Promise<CheckoutResult> {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { status: 400, body: { message: "Invalid request" } };
  }

  const body = rawBody as CheckoutRequestBody;
  const signupIntent = body.intent === "signup-straight-to-board";
  const preview = signupIntent && body.action === "preview";
  if (signupIntent && body.action !== undefined && body.action !== "preview") {
    return { status: 400, body: { message: "Unsupported checkout action" } };
  }
  if (body.intent !== undefined && !signupIntent) {
    return { status: 400, body: { message: "Unsupported checkout intent" } };
  }
  const teamId = nonEmptyString(body.teamId);
  let priceId = nonEmptyString(body.priceId);
  let returnUrl = nonEmptyString(body.returnUrl);
  let cancelUrl = nonEmptyString(body.cancelUrl);
  let mode = checkoutMode(body.mode);
  if (!teamId || (!signupIntent && (!priceId || !returnUrl || !cancelUrl || !mode))) {
    return { status: 400, body: { message: "Invalid checkout request" } };
  }
  if (signupIntent && [body.priceId, body.trialDays, body.quantity, body.stripe_customer_id,
    body.googleAccountId, body.mode, body.returnUrl, body.cancelUrl].some((value) => value !== undefined)) {
    return { status: 400, body: { message: "Checkout terms must be selected by the server" } };
  }
  if (!signupIntent) {
    const allowedPriceIds = mode === "Trial" ? trialCheckoutPriceIds : normalCheckoutPriceIds;
    if (!priceId || !allowedPriceIds.has(priceId)) {
      return { status: 400, body: { message: "Unsupported checkout price" } };
    }
  }

  const appOrigin = configuredAppOrigin();
  if (!appOrigin) throw new Error("Missing or invalid application base URL");
  if (signupIntent) {
    const boardUrl = nonEmptyString(body.boardUrl);
    if (!boardUrl || !isAllowedCheckoutReturnUrl(boardUrl, appOrigin)) {
      return { status: 400, body: { message: "Invalid checkout board URL" } };
    }
    const board = new URL(boardUrl);
    const projectId = Number(board.searchParams.get("id"));
    if (board.pathname !== "/project" || board.username || board.password ||
      !Number.isSafeInteger(projectId) || projectId <= 0 ||
      board.searchParams.getAll("id").length !== 1) {
      return { status: 400, body: { message: "Invalid checkout board URL" } };
    }
    const project = await prisma.project.findFirst({
      where: { id: projectId, teamId, status: "Normal" },
      select: { id: true },
    });
    if (!project) return { status: 404, body: { message: "Board not found" } };
    returnUrl = boardUrl;
    cancelUrl = boardUrl;
  } else if (!isAllowedCheckoutReturnUrl(returnUrl!, appOrigin) ||
    !isAllowedCheckoutReturnUrl(cancelUrl!, appOrigin)) {
    return { status: 400, body: { message: "Invalid checkout return URL" } };
  }

  const suppliedCustomerId = nonEmptyString(body.stripe_customer_id);
  const suppliedAccountId = nonEmptyString(body.googleAccountId);
  let enabled = false;
  try {
    enabled = await isFeatureEnabled(HTPR_7551_START_PLAN_CHECKOUT_FLAG, userId);
  } catch {
  }
  if (signupIntent && !enabled && !(await readTeamCheckoutAttempt(teamId))) {
    return { status: 403, body: { message: "Start plan is not available" } };
  }
  const stripe = getStripeInstance();

  return withTeamCheckoutReservation(teamId, async (reservation) => {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        title: true,
        totalSeats: true,
        googleAccountId: true,
        stripe_customer_id: true,
        activeSubscriptionPlanId: true,
        googleAccount: { select: { userId: true } },
        team_activity: { select: { hasCompletedTrial: true } },
        ...(signupIntent ? { compedUntil: true, compedPlan: true, subscriptionPlan: true } : {}),
      },
    });
    if (!team) {
      return { status: 404, body: { message: "Team not found" } };
    }
    if (team.googleAccount.userId !== userId) {
      return {
        status: 403,
        body: { message: "Only the team owner can update billing" },
      };
    }
    if (!team.stripe_customer_id) {
      return { status: 400, body: { message: "No billing account" } };
    }
    const customerId = team.stripe_customer_id;
    if (suppliedCustomerId && suppliedCustomerId !== customerId) {
      return { status: 400, body: { message: "Billing account mismatch" } };
    }
    if (suppliedAccountId && suppliedAccountId !== team.googleAccountId) {
      return { status: 400, body: { message: "Team account mismatch" } };
    }

    let attempt = await reservation.read();
    if (attempt && attempt.desired.teamId !== team.id) {
      await reservation.clear();
      attempt = null;
    }
    const ownerChanged = attempt?.desired.ownerUserId !== undefined && attempt.desired.ownerUserId !== userId;
    const identityChanged = attempt && (attempt.desired.customerId !== customerId ||
      attempt.desired.googleAccountId !== team.googleAccountId);
    if (attempt?.state === "in_flight" && ownerChanged) {
      return { status: 403, body: { message: "Checkout belongs to a different owner" } };
    }
    if (attempt?.state === "in_flight" && identityChanged) {
      return { status: 409, body: { message: "Billing identity changed; checkout needs reconciliation" } };
    }
    if (attempt && (ownerChanged || identityChanged)) {
      const oldSession = await reconcileAttemptSession(stripe, attempt, attempt.sessionId ? [] :
        await listTeamCheckoutSessions(stripe, attempt.desired.customerId, team.id));
      if (oldSession?.status === "open") {
        await expireCheckoutSessions(stripe, [oldSession], reservation.assertHeld);
      }
      await reservation.clear();
      attempt = null;
    }
    if (signupIntent && !enabled && !attempt) {
      return { status: 403, body: { message: "Start plan is not available" } };
    }
    const billedQuantity = await resolveSeatQuantity(team.id, team.totalSeats);
    const subscriptions = await listAllCustomerSubscriptions(
      stripe,
      customerId,
    );
    const teamSessions = await listTeamCheckoutSessions(
      stripe,
      customerId,
      team.id,
    );
    if (!enabled && attempt?.state === "in_flight" &&
      (effectiveTrialDays(attempt.desired) === 7 || attempt.desired.checkoutIntent === "signup-straight-to-board") &&
      Date.now() - Date.parse(attempt.createdAt) >= 24 * 60 * 60 * 1000) {
      const staleSession = await reconcileAttemptSession(stripe, attempt, teamSessions);
      if (staleSession && !teamSessions.some((session) => session.id === staleSession.id)) {
        teamSessions.push(staleSession);
      }
      await reservation.clear();
      attempt = null;
    }
    const openSessions = teamSessions.filter(
      (session) => session.status === "open",
    );
    let remainingOpenSessions = openSessions;
    if (!preview && attempt?.state === "in_flight") {
      let recoveredSession = await reconcileAttemptSession(
        stripe,
        attempt,
        teamSessions,
      );
      if (!recoveredSession) {
        try {
          reservation.assertHeld();
          recoveredSession = await createStripeCheckout(
            checkoutParams(attempt, team.title ?? "Hypertask team"),
            { idempotencyKey: attempt.idempotencyKey },
          );
        } catch (error) {
          if (isDefinitiveStripeFailure(error)) {
            await reservation.clear();
            attempt = null;
          } else {
            return {
              status: 409,
              body: {
                message: "Checkout is still being reconciled; retry shortly",
              },
            };
          }
        }
      }
      if (attempt && recoveredSession) {
        reservation.assertHeld();
        attempt = {
          ...attempt,
          sessionId: recoveredSession.id,
          sessionUrl: recoveredSession.url,
          state: "settled",
        };
        await reservation.write(attempt);
      }
    }

    const reservedSession = attempt && await reconcileAttemptSession(stripe, attempt, teamSessions);
    const knownSessions = reservedSession ? [...teamSessions, reservedSession] : teamSessions;
    const awaitingPlanSubscription = knownSessions.some((session) => {
      if (session.status !== "complete" ||
        (session.metadata?.checkoutIntent !== "signup-straight-to-board" && session.metadata?.trialDays !== "7")) return false;
      const subscriptionId = checkoutSubscriptionId(session);
      return !subscriptionId || !subscriptions.some((subscription) => subscription.id === subscriptionId);
    });
    if (awaitingPlanSubscription) {
      return { status: preview ? 200 : 409, body: {
        canStartPlan: false, finishing: true, message: "Finishing plan setup",
      } };
    }
    const hasCompletedTrialCheckout = knownSessions.some((session) =>
      session.status === "complete" && session.metadata?.checkoutMode === "Trial");
    if (mode === "Trial" && hasCompletedTrialCheckout) {
      return { status: 409, body: { message: "Trial already used" } };
    }
    const rolloutAttempt = attempt && (effectiveTrialDays(attempt.desired) === 7 ||
      attempt.desired.checkoutIntent === "signup-straight-to-board");
    const reservedSubscription = reservedSession && subscriptions.find((subscription) =>
      subscription.id === checkoutSubscriptionId(reservedSession));
    if (!enabled && attempt && rolloutAttempt &&
      (reservedSession?.status === "expired" || (attempt.state === "prepared" && !reservedSession) ||
        (reservedSession?.status === "complete" &&
          (reservedSubscription?.status === "canceled" || reservedSubscription?.status === "incomplete_expired")))) {
      await reservation.clear();
      attempt = null;
    }
    if (!enabled && attempt && rolloutAttempt) {
      const savedSession = reservedSession;
      if (signupIntent && deriveTeamBilling(team as unknown as ITeam)?.storePlanId !== "Free") {
        return { status: 409, body: { message: "Only Free teams can start a plan" } };
      }
      if (subscriptions.some((subscription) => signupIntent
        ? subscription.status !== "canceled" && subscription.status !== "incomplete_expired"
        : isLiveSubscription(subscription))) {
        return { status: 409, body: { message: "An existing subscription needs billing recovery" } };
      }
      const sameEntry = signupIntent
        ? attempt.desired.checkoutIntent === "signup-straight-to-board"
        : !attempt.desired.checkoutIntent && attempt.desired.checkoutMode === mode &&
          attempt.desired.priceId === priceId && attempt.desired.ownerUserId === userId;
      if (sameEntry && attempt.desired.returnUrl === returnUrl && attempt.desired.cancelUrl === cancelUrl &&
        savedSession?.status === "open" && sessionMatchesDesired(savedSession, attempt.desired)) {
        return { status: 200, body: preview
          ? { canStartPlan: true, trialDays: effectiveTrialDays(attempt.desired) }
          : { url: savedSession.url } };
      }
      return { status: 409, body: { message: "An existing checkout must be finished or cancelled before starting another" } };
    }
    if (!enabled && openSessions.some((session) => session.metadata?.trialDays === "7" ||
      session.metadata?.checkoutIntent === "signup-straight-to-board")) {
      return { status: 409, body: { message: "An existing checkout must be finished or cancelled before starting another" } };
    }
    if (signupIntent) {
      if (!enabled) return { status: 403, body: { message: "Start plan is not available" } };
      const awaitingSubscription = knownSessions.some((session) => {
        if (session.status !== "complete") return false;
        const subscriptionId = checkoutSubscriptionId(session);
        return !subscriptionId || !subscriptions.some((subscription) => subscription.id === subscriptionId);
      });
      const freeTeam = deriveTeamBilling(team as unknown as ITeam)?.storePlanId === "Free";
      const liveSubscription = subscriptions.some((subscription) =>
        subscription.status !== "canceled" && subscription.status !== "incomplete_expired");
      if (awaitingSubscription || (preview && (!freeTeam || subscriptions.some(isLiveSubscription)))) {
        return { status: preview ? 200 : 409, body: {
          canStartPlan: false, finishing: true, message: "Finishing plan setup",
        } };
      }
      if (!freeTeam) {
        return { status: 409, body: { message: "Only Free teams can start a plan" } };
      }
      if (liveSubscription) {
        return { status: 409, body: { message: "An existing subscription needs billing recovery" } };
      }
      priceId = storeSubscriptionPlans.find((plan) => plan.id === "Pro")
        ?.types.find((type) => type.title === "Monthly")?.stripePriceId ?? null;
      const expectedProduct = process.env.STRIPE_PRO_PRODUCT_ID;
      if (!validConfiguredPriceId(priceId ?? undefined) || !validConfiguredPriceId(expectedProduct)) {
        return { status: 503, body: { message: "Monthly Pro price configuration is unavailable" } };
      }
      let price: Stripe.Price;
      try {
        price = await stripe.prices.retrieve(priceId!);
      } catch {
        return { status: 503, body: { message: "Monthly Pro price configuration is unavailable" } };
      }
      const productId = typeof price.product === "string" ? price.product : price.product.id;
      if (!price.active || price.type !== "recurring" || price.recurring?.interval !== "month" ||
        price.recurring.interval_count !== 1 || price.currency !== "usd" ||
        price.unit_amount !== 2000 || price.billing_scheme !== "per_unit" ||
        price.recurring.usage_type !== "licensed" || price.transform_quantity || productId !== expectedProduct) {
        return { status: 503, body: { message: "Monthly Pro price configuration does not match $20 per user/month" } };
      }
      mode = team.team_activity?.hasCompletedTrial || hasHistoricalTrial(subscriptions) || hasCompletedTrialCheckout
        ? "Normal" : "Trial";
      if (preview) return { status: 200, body: { canStartPlan: true, trialDays: mode === "Trial" ? 7 : 0 } };
    }
    const desired: CheckoutAttemptDesired = {
      cancelUrl: cancelUrl!,
      checkoutMode: mode!,
      customerId,
      googleAccountId: team.googleAccountId,
      priceId: priceId!,
      quantity: billedQuantity,
      returnUrl: returnUrl!,
      teamId: team.id,
      ...(enabled ? { ownerUserId: userId, trialDays: mode === "Trial" ? 7 : 0 } : {}),
      ...(signupIntent ? { checkoutIntent: "signup-straight-to-board" as const } : {}),
    };
    if (attempt?.state === "prepared" && !desiredMatches(attempt.desired, desired)) {
      await reservation.clear();
      attempt = null;
    }

    if (
      mode === "Trial" &&
      (team.team_activity?.hasCompletedTrial ||
        (!signupIntent && team.activeSubscriptionPlanId) ||
        subscriptions.some(isLiveSubscription) ||
        hasHistoricalTrial(subscriptions))
    ) {
      if (attempt?.desired.checkoutMode === "Trial") {
        const rejectedAttemptSession = await reconcileAttemptSession(
          stripe,
          attempt,
          teamSessions,
        );
        if (rejectedAttemptSession?.status === "open") {
          await expireCheckoutSessions(
            stripe,
            [rejectedAttemptSession],
            reservation.assertHeld,
          );
        }
        await reservation.clear();
      }
      return { status: 409, body: { message: "Trial already used" } };
    }

    if (mode === "Normal") {
      const duplicate = findActiveDuplicateSubscription(subscriptions, priceId!);
      if (duplicate) {
        if (attempt && desiredMatches(attempt.desired, desired)) {
          const duplicateAttemptSession = await reconcileAttemptSession(
            stripe,
            attempt,
            teamSessions,
          );
          if (
            duplicateAttemptSession?.status === "open" &&
            sessionMatchesDesired(duplicateAttemptSession, desired)
          ) {
            await expireCheckoutSessions(
              stripe,
              [duplicateAttemptSession],
              reservation.assertHeld,
            );
          }
          await reservation.clear();
        }
        return {
          status: 200,
          body: {
            url: returnUrl!,
            alreadySubscribed: true,
            subscriptionId: duplicate.id,
          },
        };
      }
    }

    if (attempt) {
      const attemptSession = await reconcileAttemptSession(
        stripe,
        attempt,
        teamSessions,
      );
      if (attemptSession?.status === "complete") {
        const completedSubscriptionId = checkoutSubscriptionId(attemptSession);
        const completedSubscription = subscriptions.find((subscription) => subscription.id === completedSubscriptionId);
        if (
          completedSubscriptionId &&
          completedSubscription?.status !== "canceled" &&
          completedSubscription?.status !== "incomplete_expired" &&
          billingDesiredMatches(attempt.desired, desired) &&
          sessionBillingMatchesDesired(attemptSession, desired)
        ) {
          await reservation.write({
            ...attempt,
            sessionId: attemptSession.id,
            sessionUrl: attemptSession.url,
            state: "settled",
          });
          if (mode === "Trial") {
            return { status: 409, body: { message: "Trial already used" } };
          }
          return {
            status: 200,
            body: {
              url: returnUrl!,
              alreadySubscribed: true,
              subscriptionId: completedSubscriptionId,
            },
          };
        }
        await reservation.clear();
        attempt = null;
      } else {
        if (
          attemptSession?.status === "open" &&
          desiredMatches(attempt.desired, desired) &&
          sessionMatchesDesired(attemptSession, desired)
        ) {
          await expireCheckoutSessions(
            stripe,
            openSessions.filter((session) => session.id !== attemptSession.id),
            reservation.assertHeld,
          );
          await reservation.write({
            ...attempt,
            sessionId: attemptSession.id,
            sessionUrl: attemptSession.url,
            state: "settled",
          });
          return { status: 200, body: { url: attemptSession.url } };
        }

        if (attemptSession?.status === "open") {
          await expireCheckoutSessions(
            stripe,
            [attemptSession],
            reservation.assertHeld,
          );
          remainingOpenSessions = remainingOpenSessions.filter(
            (session) => session.id !== attemptSession.id,
          );
        }

        if (!desiredMatches(attempt.desired, desired) || attemptSession) {
          await reservation.clear();
          attempt = null;
        }
      }
    }

    const orphanCompatibleSession = remainingOpenSessions.find(
      (session) =>
        session.status === "open" && sessionMatchesDesired(session, desired),
    );
    if (!attempt && orphanCompatibleSession) {
      const adopted = createCheckoutAttempt(desired);
      await expireCheckoutSessions(
        stripe,
        remainingOpenSessions.filter(
          (session) => session.id !== orphanCompatibleSession.id,
        ),
        reservation.assertHeld,
      );
      await reservation.write({
        ...adopted,
        sessionId: orphanCompatibleSession.id,
        sessionUrl: orphanCompatibleSession.url,
        state: "settled",
      });
      return { status: 200, body: { url: orphanCompatibleSession.url } };
    }

    if (!attempt) {
      await expireCheckoutSessions(
        stripe,
        remainingOpenSessions,
        reservation.assertHeld,
      );
      attempt = createCheckoutAttempt(desired);
      await reservation.write(attempt);
    }

    if (attempt.state !== "in_flight") {
      attempt = { ...attempt, state: "in_flight" };
      await reservation.write(attempt);
    }
    reservation.assertHeld();
    let session: Stripe.Checkout.Session;
    try {
      session = await createStripeCheckout(
        checkoutParams(attempt, team.title ?? "Hypertask team"),
        { idempotencyKey: attempt.idempotencyKey },
      );
    } catch (error) {
      if (isDefinitiveStripeFailure(error)) {
        await reservation.clear();
        throw error;
      }
      return {
        status: 409,
        body: { message: "Checkout is still being reconciled; retry shortly" },
      };
    }
    reservation.assertHeld();
    await reservation.write({
      ...attempt,
      sessionId: session.id,
      sessionUrl: session.url,
      state: "settled",
    });

    return { status: 200, body: { url: session.url } };
  });
}
