import authConfig from '@/lib/configs/auth.config';
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants';
import prisma from '@/lib/prisma';
import { googleCalendarDisconnectData } from '@/lib/googleCalendar/connection';
import { IUser } from '@/models/model';
import { CompleteOnboardingFirstStep } from '@/utils/controllers/users/completeOnboardingStep';

const TERMINAL_SUBSCRIPTION_STATUSES = [
    'Free',
    'Expired',
    'canceled',
    'incomplete_expired',
] as const;

export const resetUserAccount = async (
    userToResetId: number,
    newOwnerId?: number | string | null
) => {
    const ownerId = newOwnerId == null ? undefined : Number(newOwnerId);
    const isTransfer = ownerId !== undefined;

    if (isTransfer && !Number.isFinite(ownerId)) {
        return {
            status: 400,
            json: { message: "Invalid newOwnerId" }
        };
    }

    try {
        if (isTransfer && userToResetId === ownerId) {
            return {
                status: 400,
                json: { message: "Cannot transfer ownership to the same user" }
            };
        }

        const [userToReset, newOwner] = await Promise.all([
            prisma.user.findUnique({ where: { id: userToResetId } }),
            isTransfer
                ? prisma.user.findUnique({ where: { id: ownerId } })
                : Promise.resolve(null)
        ]);

        if (!userToReset || (isTransfer && !newOwner)) {
            return {
                status: 400,
                json: { message: "One or both users not found" }
            };
        }

        if (!isTransfer) {
            const liveSubscriptions = await prisma.subscriptionPlan.count({
                where: {
                    owner: { userId: userToResetId },
                    subscriptionStatus: { notIn: [...TERMINAL_SUBSCRIPTION_STATUSES] }
                }
            });

            if (liveSubscriptions > 0) {
                return {
                    status: 400,
                    json: { message: "Cancel your subscription before deleting your account." }
                };
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            const projectsToTransfer = await tx.project.findMany({
                where: { ownerId: userToResetId },
                select: { id: true }
            });
            await tx.user.update({
                where: { id: userToResetId },
                data: {
                    googleCalendarGeneration: { increment: 1 },
                    joinedAt: new Date()
                }
            });
            await tx.googleCalendarConnection.updateMany({
                where: { userId: userToResetId },
                data: googleCalendarDisconnectData()
            });

            const ownedProjects = isTransfer
                ? await tx.project.updateMany({
                    where: { ownerId: userToResetId },
                    data: { ownerId: ownerId! }
                })
                : await tx.project.updateMany({
                    where: { ownerId: userToResetId },
                    data: { status: 'Archive' }
                });

            if (isTransfer) {
                for (const project of projectsToTransfer) {
                    await tx.member.deleteMany({
                        where: {
                            projectId: project.id,
                            userId: ownerId!
                        }
                    });
                }
            }

            const userGoogleAccount = await tx.googleAccount.findFirst({
                where: { userId: userToResetId }
            });

            let transferredTeams = 0;
            if (isTransfer && userGoogleAccount) {
                const teams = await tx.team.findMany({
                    where: { googleAccountId: userGoogleAccount.id },
                    select: { id: true }
                });

                if (teams.length > 0) {
                    let newOwnerGoogleAccount = await tx.googleAccount.findFirst({
                        where: { userId: ownerId! }
                    });

                    if (!newOwnerGoogleAccount) {
                        newOwnerGoogleAccount = await tx.googleAccount.update({
                            where: { id: userGoogleAccount.id },
                            data: { userId: ownerId! }
                        });
                    } else {
                        await tx.team.updateMany({
                            where: { googleAccountId: userGoogleAccount.id },
                            data: { googleAccountId: newOwnerGoogleAccount.id }
                        });

                        const remainingTeams = await tx.team.count({
                            where: { googleAccountId: userGoogleAccount.id }
                        });

                        if (remainingTeams === 0) {
                            await tx.subscriptionPlan.updateMany({
                                where: { ownerId: userGoogleAccount.id },
                                data: { ownerId: newOwnerGoogleAccount.id }
                            });
                        }
                    }

                    for (const team of teams) {
                        await tx.member_Team.deleteMany({
                            where: {
                                teamId: team.id,
                                userId: ownerId!
                            }
                        });
                    }

                    transferredTeams = teams.length;
                }
            }

            await tx.userSetting.upsert({
                where: { userId: userToResetId },
                update: {
                    onboardingTourStatus: authConfig.onboarding.skipOnboarding,
                    trialStatus: false,
                    onboardingTutorialStatus: authConfig.onboarding.shouldSkipInteractive,
                    notification: false
                },
                create: {
                    userId: userToResetId,
                    onboardingTourStatus: authConfig.onboarding.skipOnboarding,
                    trialStatus: false,
                    onboardingTutorialStatus: authConfig.onboarding.shouldSkipInteractive,
                    notification: false
                }
            });
            const deletedMembers = await tx.member.deleteMany({
                where: { userId: userToResetId }
            });

            const deletedTeamMembers = await tx.member_Team.deleteMany({
                where: { userId: userToResetId }
            });

            await tx.assignees.deleteMany({
                where: { userId: userToResetId }
            });

            await tx.follower.deleteMany({
                where: { userId: userToResetId }
            });

            const transferredTasks = isTransfer
                ? await tx.task.updateMany({
                    where: { userId: userToResetId },
                    data: { userId: ownerId! }
                })
                : { count: 0 };

            await tx.notification.updateMany({
                where: {
                    OR: [
                        { userId: userToResetId },
                        { fromUserId: userToResetId }
                    ]
                },
                data: {
                    status: 'Archive',
                    archivedAt: new Date()
                }
            });

            return {
                transferredProjects: ownedProjects.count,
                transferredTeams,
                deletedMembers: deletedMembers.count,
                deletedTeamMembers: deletedTeamMembers.count,
                transferredTasks: transferredTasks.count
            };
        });

        try {
            await CompleteOnboardingFirstStep(
                userToReset as unknown as IUser,
                "MyTeam",
                "MyBoard",
                companySizeOptions[0],
                companyRoleOptions[0]
            );
        } catch (onboardingError) {
            console.error("Failed to recreate onboarding state after reset:", onboardingError);
        }

        return {
            status: 200,
            json: {
                message: "User reset successfully",
                details: result
            }
        };

    } catch (error) {
        console.error("Error resetting user:", error);
        return {
            status: 500,
            json: isTransfer
                ? {
                    message: "Internal server error during user reset",
                    error: error
                }
                : { message: "Internal server error during user reset" }
        };
    }
};

export default resetUserAccount;
