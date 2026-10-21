import { getSessionUser } from '@/lib/auth/getSessionUser';
import { isSubscriptionActive } from '@/lib/constants/constants';
import prisma from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

function isAdminCaller(request: NextRequest): boolean {
    const adminPassword = process.env.ADMIN_USER_RESET_PW;

    return Boolean(adminPassword) && request.headers.get('x-admin-password') === adminPassword;
}

async function resetUserTrialPeriod(
    userId: number,
    force: boolean = false
) {
    const now = new Date();

    const userTeams = await prisma.team.findMany({
        where: {
            OR: [
                { googleAccount: { userId } },
                { members: { some: { userId } } }
            ]
        },
        include: {
            subscriptionPlan: true,
            googleAccount: true
        }
    });

    const activeSubscriptions: Array<{
        teamId: string;
        teamTitle: string | null;
        subscriptionId: string;
        status: string;
    }> = [];

    for (const team of userTeams) {
        if (team.activeSubscriptionPlanId) {
            const matchingPlan = team.subscriptionPlan.find(plan =>
                plan.subscriptionId === team.activeSubscriptionPlanId
            );

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

    if (activeSubscriptions.length > 0 && !force) {
        return {
            error: "Cannot reset trial period: user has active subscription(s)",
            activeSubscriptions,
            suggestion: "Cancel the subscription(s) first, or use force=true to override"
        };
    }

    const userExists = await prisma.user.findUnique({
        where: { id: userId }
    });

    if (!userExists) {
        return {
            error: `User with id ${userId} not found`,
        };
    }

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

        if (!userId || typeof userId !== 'number') {
            return NextResponse.json(
                { error: 'userId (number) is required' },
                { status: 400 }
            );
        }

        if (!isAdminCaller(request)) {
            const session = await getSessionUser(request.headers);

            if (!session) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }

            if (session.userId !== userId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const result = await resetUserTrialPeriod(userId, force || false);

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
