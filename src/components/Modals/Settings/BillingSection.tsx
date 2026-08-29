"use client";

import axios from "axios";
import { ReactNode, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";
import { planKindFromStripePriceId } from "@/lib/planFromStripePriceId";
import { convertTimestampToFormattedDate } from "@/utils/helperFunctions/helperFunctions";
import {
  BillingActionRow,
  BillingRow,
  settingsActionButtonClass as actionButtonClass,
} from "./SettingsBillingRow";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { getSettingsPath } from "./settingsNavigation";
import { useSettingsTeam } from "./useSettingsTeam";

type SettingsBillingInvoice = {
  amountPaid: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  created: number;
  currency: string | null;
  hostedInvoiceUrl: string | null;
  id: string;
  paymentMethodType: string | null;
  status: string | null;
};

type SettingsBillingData = {
  customerEmail: string | null;
  invoices: SettingsBillingInvoice[];
  upcomingInvoice: {
    amountDue: number;
    subtotal: number;
    discountTotal: number;
    created: number;
    currency: string;
    nextPaymentAttempt: number | null;
    periodEnd: number | null;
  } | null;
};

const BillingSection = () => {
  const router = useRouter();
  const { ownerAndMembers, project, refetchTeam, team } = useSettingsTeam();
  const [confirmCancelSubscription, setConfirmCancelSubscription] =
    useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);
  const [billingData, setBillingData] = useState<SettingsBillingData | null>(
    null
  );
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);
  const [isEditingBillingEmail, setIsEditingBillingEmail] = useState(false);
  const [billingEmailDraft, setBillingEmailDraft] = useState("");
  const [savingBillingEmail, setSavingBillingEmail] = useState(false);

  const activeSubscription = team?.subscriptionPlan?.[0] ?? null;
  const plan = planKindFromStripePriceId(activeSubscription?.priceId);
  const planLabel = team?.activeSubscriptionPlanId ? plan.storePlanId : "Free";
  const billingCycle =
    activeSubscription?.interval ?? plan.billingInterval ?? "Free Plan";
  const usedSeats =
    (ownerAndMembers.owner ? 1 : 0) + ownerAndMembers.members.length;
  const hasPaidPlan = Boolean(team?.activeSubscriptionPlanId);
  const latestInvoice = billingData?.invoices[0] ?? null;
  const upcomingInvoice = billingData?.upcomingInvoice ?? null;
  const paymentMethod = formatPaymentMethod(latestInvoice);
  const nextInvoiceDate = hasPaidPlan
    ? billingLoading
      ? "Loading"
      : formatTimestamp(
          upcomingInvoice?.nextPaymentAttempt ?? upcomingInvoice?.created
        )
    : "Free Plan";
  const renewalDate = hasPaidPlan
    ? billingLoading
      ? "Loading"
      : formatTimestamp(
          upcomingInvoice?.periodEnd ??
            upcomingInvoice?.nextPaymentAttempt ??
            upcomingInvoice?.created
        )
    : "Free Plan";
  const invoiceTotal = hasPaidPlan
    ? billingLoading
      ? "Loading"
      : formatMoney(upcomingInvoice?.amountDue, upcomingInvoice?.currency)
    : "Free Plan";
  // Full list price (before any negotiated coupon). For normal teams this
  // equals the amount due; for a discounted team it's the real account size.
  const fullPrice = hasPaidPlan
    ? billingLoading
      ? "Loading"
      : formatMoney(upcomingInvoice?.subtotal, upcomingInvoice?.currency)
    : "Free Plan";
  const discountAmount = upcomingInvoice?.discountTotal ?? 0;
  const hasDiscount = discountAmount > 0;
  const perSeatAmount =
    upcomingInvoice && usedSeats > 0
      ? upcomingInvoice.subtotal / usedSeats
      : null;

  useEffect(() => {
    let cancelled = false;

    if (!team?.id || !team.stripe_customer_id) {
      setBillingData(null);
      setBillingError(null);
      setBillingLoading(false);
      return;
    }

    (async () => {
      setBillingLoading(true);
      setBillingError(null);
      try {
        const response = await axios.get<SettingsBillingData>(
          "/api/settings/billing",
          { params: { teamId: team.id, projectId: project?.id } }
        );
        if (!cancelled) setBillingData(response.data);
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setBillingData(null);
          setBillingError("Billing details unavailable");
        }
      } finally {
        if (!cancelled) setBillingLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [team?.id, team?.stripe_customer_id, project?.id]);

  const saveBillingEmail = async () => {
    const email = billingEmailDraft.trim();
    if (!team?.id || !email) return;

    setSavingBillingEmail(true);
    try {
      const response = await axios.post<{ billingEmail: string }>(
        "/api/settings/billing",
        { billingEmail: email, projectId: project?.id, teamId: team.id }
      );
      setBillingData((previous) =>
        previous ? { ...previous, customerEmail: response.data.billingEmail } : previous
      );
      setIsEditingBillingEmail(false);
      toast.success("Invoicing email updated");
    } catch (error) {
      console.error(error);
      const message = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : null;
      toast.error(message ?? "Could not update invoicing email");
    } finally {
      setSavingBillingEmail(false);
    }
  };

  const manageSubscription = () => {
    router.push(getSettingsPath("plans"));
  };

  const openBillingPortal = async () => {
    if (!team?.id) {
      toast.error("No billing account");
      return;
    }

    setOpeningPortal(true);
    try {
      const response = await axios.post<{ url: string }>(
        "/api/stripe/billing-portal",
        { teamId: team.id }
      );
      window.location.assign(response.data.url);
    } catch (error) {
      console.error(error);
      const message = axios.isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message
        : null;
      toast.error(message === "No billing account" ? message : "Could not open billing portal");
    } finally {
      setOpeningPortal(false);
    }
  };

  const confirmCancel = async () => {
    if (!team?.stripe_customer_id) return;

    setConfirmingCancel(true);
    try {
      const response = await axios.post("/api/stripe/cancelSubscription", {
        stripe_customer_id: team.stripe_customer_id,
      });
      setConfirmCancelSubscription(false);
      await refetchTeam();
      router.refresh();
      if (response.status === 200) toast("Successfully switched to Free Plan");
    } catch (error) {
      console.error(error);
      toast.error("Could not cancel subscription");
    } finally {
      setConfirmingCancel(false);
    }
  };

  return (
    <SettingsSectionShell title="Billing">
      <SettingsCard title="Plan">
        <BillingRow label="Plan" value={planLabel} />
        <BillingRow
          label="Seats"
          value={`${usedSeats} of ${team?.totalSeats ?? 0} seats used`}
        />
        <BillingRow label="Billing cycle" value={billingCycle} />
        {hasPaidPlan && (
          <BillingRow
            label="Price"
            value={
              billingLoading
                ? "Loading"
                : `${fullPrice}${
                    upcomingInvoice ? ` / ${billingCycle}` : ""
                  }`
            }
          />
        )}
        <BillingRow label="Renewal" value={renewalDate} />
        <BillingActionRow
          action={
            <button
              className={actionButtonClass}
              disabled={!team}
              onClick={manageSubscription}
              type="button"
            >
              Manage
            </button>
          }
          label="Manage subscription"
        />
        {team?.activeSubscriptionPlanId && (
          <BillingActionRow
            action={
              <button
                className={actionButtonClass}
                onClick={() => setConfirmCancelSubscription(true)}
                type="button"
              >
                Cancel
              </button>
            }
            label="Cancel plan"
          />
        )}
        {confirmCancelSubscription && (
          <div className="mt-2 flex flex-col gap-3 border-t border-border-light-gray-thin px-2 pt-4 text-dense text-white-black">
            {confirmingCancel ? (
              <p className="font-medium text-text-light-gray">
                Switching to the Free Plan. Please wait.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">Are you sure you want to cancel?</p>
                  <p className="font-medium text-text-light-gray">
                    This will cancel your current plan immediately and switch
                    this team to the Free Plan.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={actionButtonClass}
                    onClick={() => setConfirmCancelSubscription(false)}
                    type="button"
                  >
                    Keep plan
                  </button>
                  <button
                    className={actionButtonClass}
                    onClick={confirmCancel}
                    type="button"
                  >
                    Confirm
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard title="Payment">
        <BillingActionRow
          action={
            <button
              className={actionButtonClass}
              disabled={openingPortal}
              onClick={openBillingPortal}
              type="button"
            >
              {openingPortal ? "Opening" : "Update"}
            </button>
          }
          label={billingLoading ? "Loading payment method" : paymentMethod}
        />
        {isEditingBillingEmail ? (
          <div className="flex items-center justify-between gap-3 rounded-[5px] px-2 py-2 hover:bg-hover-active">
            <span className="shrink-0 text-dense font-semibold text-white-black">
              Invoicing email
            </span>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <input
                autoFocus
                className="h-8 min-w-0 flex-1 rounded-[8px] border border-border-light-gray-thin bg-modalBackground px-2 text-dense font-medium text-white-black outline-none placeholder:text-text-light-gray focus:bg-active-modal-element"
                onChange={(event) => setBillingEmailDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveBillingEmail();
                  if (event.key === "Escape") setIsEditingBillingEmail(false);
                }}
                placeholder="invoices@company.com"
                type="email"
                value={billingEmailDraft}
              />
              <button
                className={actionButtonClass}
                disabled={savingBillingEmail}
                onClick={saveBillingEmail}
                type="button"
              >
                Save
              </button>
              <button
                className={actionButtonClass}
                onClick={() => setIsEditingBillingEmail(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <BillingActionRow
            action={
              <div className="flex min-w-0 items-center justify-end gap-2">
                <span className="min-w-0 truncate text-right text-dense font-medium text-text-light-gray">
                  {billingData?.customerEmail ?? "Not set"}
                </span>
                <button
                  className={actionButtonClass}
                  disabled={!team?.stripe_customer_id}
                  onClick={() => {
                    setBillingEmailDraft(billingData?.customerEmail ?? "");
                    setIsEditingBillingEmail(true);
                  }}
                  type="button"
                >
                  Edit
                </button>
              </div>
            }
            label="Invoicing email"
          />
        )}
        {billingError && <EmptyState>{billingError}</EmptyState>}
      </SettingsCard>

      <SettingsCard title="Next Invoice">
        <BillingRow label="Next invoice" value={nextInvoiceDate} />
        <BillingRow label="Active seats today" value={String(usedSeats)} />
        {hasDiscount && (
          <>
            <BillingRow label="Full price" value={fullPrice} />
            <BillingRow
              label="Discount"
              value={`- ${formatMoney(discountAmount, upcomingInvoice?.currency)}`}
            />
          </>
        )}
        <BillingActionRow
          action={
            <div className="flex min-w-0 items-center justify-end gap-2">
              <span className="min-w-0 truncate text-right text-dense font-medium text-text-light-gray">
                {invoiceTotal}
              </span>
              {upcomingInvoice && (
                <button
                  className={actionButtonClass}
                  onClick={() => setShowCostBreakdown((previous) => !previous)}
                  type="button"
                >
                  {showCostBreakdown ? "Hide breakdown" : "Cost breakdown"}
                </button>
              )}
            </div>
          }
          label={hasDiscount ? "Amount due" : "Invoice total"}
        />
        {showCostBreakdown && upcomingInvoice && perSeatAmount !== null && (
          <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
            {formatMoney(perSeatAmount, upcomingInvoice.currency)} × {usedSeats} seats
          </p>
        )}
      </SettingsCard>

      <SettingsCard title="Invoices">
        {billingLoading ? (
          <EmptyState>Loading invoices</EmptyState>
        ) : billingData?.invoices.length ? (
          <InvoiceTable invoices={billingData.invoices} />
        ) : (
          <EmptyState>No invoices found</EmptyState>
        )}
      </SettingsCard>
    </SettingsSectionShell>
  );
};

const formatMoney = (
  amountCents: number | null | undefined,
  currency: string | null | undefined
) => {
  if (typeof amountCents !== "number" || !currency) return "—";
  return new Intl.NumberFormat("en-US", {
    currency: currency.toUpperCase(),
    style: "currency",
  }).format(amountCents / 100);
};

const formatPaymentMethod = (invoice: SettingsBillingInvoice | null) => {
  if (invoice?.cardBrand && invoice.cardLast4) {
    const brand =
      invoice.cardBrand.slice(0, 1).toUpperCase() + invoice.cardBrand.slice(1);
    return `${brand} ending in ${invoice.cardLast4}`;
  }
  return "Link by Stripe";
};

const formatTimestamp = (timestamp: number | null | undefined) =>
  timestamp ? convertTimestampToFormattedDate(timestamp) : "Free Plan";

const formatStatus = (status: string | null) =>
  status ? status.slice(0, 1).toUpperCase() + status.slice(1) : "—";

const InvoiceTable = ({ invoices }: { invoices: SettingsBillingInvoice[] }) => (
  <div className="min-w-0 overflow-x-auto">
    <table className="w-full min-w-[520px] border-collapse text-left text-dense">
      <thead>
        <tr className="border-b border-border-light-gray-thin text-text-light-gray">
          <th className="px-2 py-2 font-medium">Date</th>
          <th className="px-2 py-2 font-medium">Total</th>
          <th className="px-2 py-2 font-medium">Status</th>
          <th className="px-2 py-2 text-right font-medium">View</th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((invoice) => (
          <tr
            className="border-b border-border-light-gray-thin last:border-b-0 hover:bg-hover-active"
            key={invoice.id}
          >
            <td className="px-2 py-2 font-semibold text-white-black">
              {formatTimestamp(invoice.created)}
            </td>
            <td className="px-2 py-2 font-medium text-text-light-gray">
              {formatMoney(invoice.amountPaid, invoice.currency)}
            </td>
            <td className="px-2 py-2 font-medium text-text-light-gray">
              {formatStatus(invoice.status)}
            </td>
            <td className="px-2 py-2 text-right">
              {invoice.hostedInvoiceUrl ? (
                <a
                  className={actionButtonClass}
                  href={invoice.hostedInvoiceUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  View
                </a>
              ) : (
                <span className="font-medium text-text-light-gray">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const EmptyState = ({ children }: { children: ReactNode }) => (
  <p className="px-2 py-2 text-dense font-medium text-text-light-gray">
    {children}
  </p>
);

export default BillingSection;
