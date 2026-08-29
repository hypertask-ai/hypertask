import { getSessionUser } from '@/lib/auth/getSessionUser';
import { isSubscriptionActive } from '@/lib/constants/constants';
import prisma from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

// Support callers: the same server-only password the /reset tool gate checks.
function isAdminCaller(request: NextRequest): boolean {
    const adminPassword = process.env.ADMIN_USER_RESET_PW;

    return Boolean(adminPassword) && request.headers.get('x-admin-password') === adminPassword;
}

/**
 * Reset user's trial period by:
 * 1. Setting trialStatus to false (makes them eligible for trial again)
 * 2. Resetting joinedAt to current date (restarts the 14-day countdown)
 * 
 * Note: This only resets the freemium trial period (before subscription).
 * If the user has an active Stripe subscription, resetting the trial period
 * doesn't make sense since they've already moved past the freemium trial stage.
 * 
 * @param userId - The user ID to reset trial for
 * @param force - If true, resets even if user has active subscriptions. Default: false
 */
async function resetUserTrialPeriod(
    userId: number,
    force: boolean = false
) {
    const now = new Date();

    // Find all teams the user is associated with (as owner or member)
    const userTeams = await prisma.team.findMany({
        where: {
            OR: [
                { googleAccount: { userId } }, // User owns the team
                { members: { some: { userId } } } // User is a member
            ]
        },
        include: {
            subscriptionPlan: true, // Get all subscription plans, we'll filter in code
            googleAccount: true
        }
    });

    // Check for active subscriptions
    const activeSubscriptions: Array<{
        teamId: string;
        teamTitle: string | null;
        subscriptionId: string;
        status: string;
    }> = [];

    for (const team of userTeams) {
        // Check if team has an active subscription plan ID
        if (team.activeSubscriptionPlanId) {
            // Find the subscription plan that matches the active subscription ID
            const matchingPlan = team.subscriptionPlan.find(plan =>
                plan.subscriptionId === team.activeSubscriptionPlanId
            );

            // If we found a matching plan, check if it's active
            if (matchingPlan && isSubscriptionActive(matchingPlan.subscriptionStatus)) {
                activeSubscriptions.push({
                    teamId: team.id,
                    teamTitle: team.title,
                    subscriptionId: team.activeSubscriptionPlanId,
                    status: matchingPlan.subscriptionStatus
                });
            }
        }
    }
    
    console.log("🚀 ~ resetUserTrialPeriod ~ userTeams:", userTeams.length);
    console.log("🚀 ~ resetUserTrialPeriod ~ activeSubscriptions:", activeSubscriptions.length);

    // Prevent reset if user has active subscriptions (unless forced)
    if (activeSubscriptions.length > 0 && !force) {
        return {
            error: "Cannot reset trial period: user has active subscription(s)",
            activeSubscriptions,
            suggestion: "Cancel the subscription(s) first, or use force=true to override"
        };
    }

    // Check if user exists
    const userExists = await prisma.user.findUnique({
        where: { id: userId }
    });

    if (!userExists) {
        return {
            error: `User with id ${userId} not found`,
        };
    }

    // Ensure UserSetting exists, then update both UserSetting.trialStatus and User.joinedAt in a transaction
    const [userSetting, user] = await prisma.$transaction([
        prisma.userSetting.upsert({
            where: { userId },
            update: { trialStatus: false },
            create: {
                userId,
                trialStatus: false,
                onboardingTourStatus: false,
                onboardingTutorialStatus: false,
                notification: false,
            }
        }),
        prisma.user.update({
            where: { id: userId },
            data: { joinedAt: now }
        })
    ]);

    return {
        userSetting,
        user,
        activeSubscriptions: activeSubscriptions.length > 0 ? activeSubscriptions : undefined
    };
}

/**
 * API endpoint to reset a user's trial period
 * POST /api/users/reset-trial
 * 
 * Body:
 * - userId: number (required) - The user ID to reset trial for
 * - force?: boolean (optional) - If true, resets even if user has active subscriptions. Default: false
 */
export async function POST(request: NextRequest) {
    try {
        let body;
        try {
            body = await request.json();
        } catch (parseError) {
            return NextResponse.json(
                { error: 'Invalid JSON in request body' },
                { status: 400 }
            );
        }
        
        const { userId, force=false } = body;

        // Validate input
        if (!userId || typeof userId !== 'number') {
            return NextResponse.json(
                { error: 'userId (number) is required' },
                { status: 400 }
            );
        }

        // Auth: admins may reset anyone, everyone else only themselves (HTPR-4802).
        if (!isAdminCaller(request)) {
            const session = await getSessionUser(request.headers);

            if (!session) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }

            if (session.userId !== userId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        // Reset trial period
        const result = await resetUserTrialPeriod(userId, force || false);

        // Check if there was an error (e.g., active subscriptions)
        if ('error' in result) {
            return NextResponse.json(
                {
                    success: false,
                    error: result.error,
                    suggestion: result.suggestion,
                },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Trial period reset successfully',
            data: {
                userId: result.user.id,
                trialStatus: result.userSetting.trialStatus,
                joinedAt: result.user.joinedAt,
            },
        });
    } catch (error: any) {
        console.error('❌ Error resetting trial period:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to reset trial period',
            },
            { status: 500 }
        );
    }
}
