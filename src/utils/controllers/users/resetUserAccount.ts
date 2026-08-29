import authConfig from '@/lib/configs/auth.config';
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants';
import prisma from '@/lib/prisma';
import { IUser } from '@/models/model';
import { CompleteOnboardingFirstStep } from '@/utils/controllers/users/completeOnboardingStep';

// Statuses that mean "this subscription is done, nothing left to cancel".
const TERMINAL_SUBSCRIPTION_STATUSES = [
    'Free',
    'Expired',
    'canceled',
    'incomplete_expired',
] as const;

/**
 * Wipes a user's account state back to a fresh-signup shape.
 *
 * Two modes:
 * - admin transfer (`newOwnerId` given): owned projects/teams/tasks move to that user.
 * - self-serve delete (`newOwnerId` omitted): there is no transferee, so owned
 *   projects are archived instead and tasks are left with the archived projects.
 *
 * Everything else (membership cleanup, onboarding reset, notification archiving)
 * is identical in both modes.
 */
export const resetUserAccount = async (
    userToResetId: number,
    newOwnerId?: number | string | null
) => {
    // A malformed transfer id must never fall through into archive mode.
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

        // Validate the users involved exist
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

        // Self-serve delete has no transferee, so a running subscription would be
        // orphaned on archived boards. Make the user cancel it first.
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

        // Start transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Get projects that will be transferred/archived (before the change)
            const projectsToTransfer = await tx.project.findMany({
                where: { ownerId: userToResetId },
                select: { id: true }
            });
            await tx.user.update({
                where: { id: userToResetId },
                data: {
                    joinedAt: new Date()
                }
            });

            // 2. Transfer project ownership (or archive when there is no transferee)
            const ownedProjects = isTransfer
                ? await tx.project.updateMany({
                    where: { ownerId: userToResetId },
                    data: { ownerId: ownerId! }
                })
                : await tx.project.updateMany({
                    where: { ownerId: userToResetId },
                    data: { status: 'Archive' }
                });

            // 3. Remove new owner from member lists of transferred projects
            // (they're now owners, don't need to be members)
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

            // 4. Handle GoogleAccount and Team ownership transfer
            const userGoogleAccount = await tx.googleAccount.findFirst({
                where: { userId: userToResetId }
            });

            let transferredTeams = 0;
            if (isTransfer && userGoogleAccount) {
                // Find teams owned by this GoogleAccount
                const teams = await tx.team.findMany({
                    where: { googleAccountId: userGoogleAccount.id },
                    select: { id: true }
                });

                if (teams.length > 0) {
                    // Check if new owner has a GoogleAccount
                    let newOwnerGoogleAccount = await tx.googleAccount.findFirst({
                        where: { userId: ownerId! }
                    });

                    if (!newOwnerGoogleAccount) {
                        // Transfer the existing GoogleAccount instead of creating new one
                        newOwnerGoogleAccount = await tx.googleAccount.update({
                            where: { id: userGoogleAccount.id },
                            data: { userId: ownerId! }
                        });
                    } else {
                        // If new owner already has GoogleAccount, transfer teams to their account
                        await tx.team.updateMany({
                            where: { googleAccountId: userGoogleAccount.id },
                            data: { googleAccountId: newOwnerGoogleAccount.id }
                        });

                        // Clean up the old GoogleAccount if it has no more teams
                        const remainingTeams = await tx.team.count({
                            where: { googleAccountId: userGoogleAccount.id }
                        });

                        if (remainingTeams === 0) {
                            // Transfer or handle subscription plans before deleting
                            await tx.subscriptionPlan.updateMany({
                                where: { ownerId: userGoogleAccount.id },
                                data: { ownerId: newOwnerGoogleAccount.id }
                            });
                        }
                    }

                    // Remove new owner from team memberships (they're now owners)
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

            // 5. Update user settings to reset state
            // (the fresh team/board is recreated after the transaction commits)
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
            // 6. Remove user from all project memberships
            const deletedMembers = await tx.member.deleteMany({
                where: { userId: userToResetId }
            });

            // 7. Remove user from all team memberships
            const deletedTeamMembers = await tx.member_Team.deleteMany({
                where: { userId: userToResetId }
            });

            // 8. Clean up related data
            await tx.assignees.deleteMany({
                where: { userId: userToResetId }
            });

            await tx.follower.deleteMany({
                where: { userId: userToResetId }
            });

            // 9. Transfer user's tasks to new owner (self-serve leaves them on the archived projects)
            const transferredTasks = isTransfer
                ? await tx.task.updateMany({
                    where: { userId: userToResetId },
                    data: { userId: ownerId! }
                })
                : { count: 0 };

            // 10. Handle notifications - mark as archived rather than delete
            await tx.notification.updateMany({
                where: {
                    OR: [
                        { userId: userToResetId },
                        { fromUserId: userToResetId }
                    ]
                },
                data: {
                    status: 'Archive', // Using your Status enum
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

        // Recreate the fresh team/board the user lands on next login. Runs on its
        // own prisma client, so it stays outside the transaction above.
        try {
            await CompleteOnboardingFirstStep(
                userToReset as unknown as IUser,
                "MyTeam",
                "MyBoard",
                companySizeOptions[0],
                companyRoleOptions[0]
            );
        } catch (onboardingError) {
            // The reset itself succeeded; onboarding can be completed on next login.
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
