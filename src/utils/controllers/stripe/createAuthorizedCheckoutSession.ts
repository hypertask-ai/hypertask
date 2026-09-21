import prisma from "@/lib/prisma";
import { resolveSeatQuantity } from "@/lib/resolveSeatQuantity";
import {
  createStripeCheckout,
  findActiveDuplicateSubscription,
  getStripeInstance,
  isLiveSubscription,
} from "@/lib/stripe";
import { storeSubscriptionPlans } from "@/lib/subscriptionPlans";
import type { CreateCheckoutParams } from "@/models/model";
import type Stripe from "stripe";
import {
  createCheckoutAttempt,
  withTeamCheckoutReservation,
  type CheckoutAttempt,
  type CheckoutAttemptDesired,
  type CheckoutMode,
} from "@/utils/controllers/stripe/checkoutReservation";

type CheckoutRequestBody = {
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

// The legacy trial surface uses one explicitly configured live monthly price.
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

function desiredMatches(
  left: CheckoutAttemptDesired,
  right: CheckoutAttemptDesired,
): boolean {
  return (
    left.cancelUrl === right.cancelUrl &&
    left.checkoutMode === right.checkoutMode &&
    left.customerId === right.customerId &&
    left.googleAccountId === right.googleAccountId &&
    left.priceId === right.priceId &&
    left.quantity === right.quantity &&
    left.returnUrl === right.returnUrl &&
    left.teamId === right.teamId
  );
}

function billingDesiredMatches(
  left: CheckoutAttemptDesired,
  right: CheckoutAttemptDesired,
): boolean {
  return (
    left.checkoutMode === right.checkoutMode &&
    left.customerId === right.customerId &&
    left.googleAccountId === right.googleAccountId &&
    left.priceId === right.priceId &&
    left.quantity === right.quantity &&
    left.teamId === right.teamId
  );
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
    },
  };
}

/**
 * Creates checkout only from a signed user's owned team and server-derived
 * billing data. Client fields are selectors/hints, never billing authority.
 */
export async function createAuthorizedCheckoutSession(
  userId: number,
  rawBody: unknown,
): Promise<CheckoutResult> {
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { status: 400, body: { message: "Invalid request" } };
  }

  const body = rawBody as CheckoutRequestBody;
  const teamId = nonEmptyString(body.teamId);
  const priceId = nonEmptyString(body.priceId);
  const returnUrl = nonEmptyString(body.returnUrl);
  const cancelUrl = nonEmptyString(body.cancelUrl);
  const mode = checkoutMode(body.mode);

  if (!teamId || !priceId || !returnUrl || !cancelUrl || !mode) {
    return { status: 400, body: { message: "Invalid checkout request" } };
  }

  const allowedPriceIds =
    mode === "Trial" ? trialCheckoutPriceIds : normalCheckoutPriceIds;
  if (!allowedPriceIds.has(priceId)) {
    return { status: 400, body: { message: "Unsupported checkout price" } };
  }

  const appOrigin = configuredAppOrigin();
  if (!appOrigin) {
    throw new Error("Missing or invalid application base URL");
  }
  if (
    !isAllowedCheckoutReturnUrl(returnUrl, appOrigin) ||
    !isAllowedCheckoutReturnUrl(cancelUrl, appOrigin)
  ) {
    return { status: 400, body: { message: "Invalid checkout return URL" } };
  }

  const suppliedCustomerId = nonEmptyString(body.stripe_customer_id);
  const suppliedAccountId = nonEmptyString(body.googleAccountId);
  const stripe = getStripeInstance();

  return withTeamCheckoutReservation(teamId, async (reservation) => {
    // Ownership and every billing field are loaded only after acquiring the
    // cross-instance checkout lock. Client hints never survive this recheck.
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

    const billedQuantity = await resolveSeatQuantity(team.id, team.totalSeats);
    const desired: CheckoutAttemptDesired = {
      cancelUrl,
      checkoutMode: mode,
      customerId,
      googleAccountId: team.googleAccountId,
      priceId,
      quantity: billedQuantity,
      returnUrl,
      teamId: team.id,
    };
    const subscriptions = await listAllCustomerSubscriptions(
      stripe,
      customerId,
    );
    const teamSessions = await listTeamCheckoutSessions(
      stripe,
      customerId,
      team.id,
    );
    const openSessions = teamSessions.filter(
      (session) => session.status === "open",
    );
    let remainingOpenSessions = openSessions;
    let attempt = await reservation.read();
    if (attempt && attempt.desired.teamId !== team.id) {
      await reservation.clear();
      attempt = null;
    }
    if (
      attempt?.state === "prepared" &&
      !desiredMatches(attempt.desired, desired)
    ) {
      // No Stripe call can precede the durable in-flight transition. A
      // prepared attempt abandoned before that transition is safe to rotate.
      await reservation.clear();
      attempt = null;
    }

    if (attempt?.state === "in_flight") {
      let recoveredSession = await reconcileAttemptSession(
        stripe,
        attempt,
        teamSessions,
      );
      if (!recoveredSession) {
        try {
          // The prior lease owner may still complete this call. Retrying its
          // exact parameters and key settles one Stripe operation safely.
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

    if (
      mode === "Trial" &&
      (team.team_activity?.hasCompletedTrial ||
        team.activeSubscriptionPlanId ||
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
      const duplicate = findActiveDuplicateSubscription(subscriptions, priceId);
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
            url: returnUrl,
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
        if (
          completedSubscriptionId &&
          billingDesiredMatches(attempt.desired, desired) &&
          sessionBillingMatchesDesired(attemptSession, desired)
        ) {
          // Preserve the matching terminal session until the reservation TTL
          // expires. A lost response then reconciles instead of creating anew.
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
              url: returnUrl,
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
      // Persist the unique attempt and idempotency key before Stripe. If the
      // process fails after Stripe succeeds, a retry reuses this exact key.
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
      // Network/API ambiguity keeps the attempt and stable key for safe retry.
      // A definitive rejection created no session, so rotate immediately.
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
